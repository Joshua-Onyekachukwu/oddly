/**
 * Competition-specific model gating.
 *
 * Strategic requirement (docs/ODDLY-STRATEGIC-ASSESSMENT.md §2, §5):
 * don't force predictions where the model doesn't perform, and don't
 * auto-change anything on small samples.
 *
 * Two layers (same pattern as src/lib/prediction/data-quality.ts):
 *  - `computeLeagueGate`      — pure scorer over pre-aggregated per-league
 *                               settled predictions + coverage signals
 *  - `collectAndPersistGates` — batched PostgREST collector that joins
 *                               predictions → fixtures → leagues, computes
 *                               a global baseline, scores every league, and
 *                               upserts league_model_gates.
 *
 * Verdicts:
 *  - 'insufficient'  n < 10 settled predictions (too little evidence either way)
 *  - 'exclude'       n >= 30 AND (accuracy < baseline - 10pp OR calibration gap > 0.20)
 *  - 'trusted'       n >= 30 AND accuracy >= baseline - 5pp AND calibration gap <= 0.10
 *  - 'watch'         everything else (10 <= n < 30, or n >= 30 not trusted/exclude)
 *
 * IMPORTANT: this module only *detects and records* gate verdicts. It never
 * suppresses predictions — the predict route writes an immutable audit row
 * regardless; consumers may use the verdict to down-weight or abstain at the
 * recommendation layer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateVerdict = "trusted" | "watch" | "exclude" | "insufficient";

export interface SettledPredictionRow {
  market: string;
  modelProbability: number; // 0-1
  correct: boolean;
}

export interface LeagueCoverage {
  finishedFixtures: number;
  oddsCoveredFixtures: number;
  injuryCoveredFixtures: number;
}

export interface LeagueGateInput {
  leagueKey: string; // fixtures.league_id, or "unknown" when null
  leagueName?: string;
  modelVersion?: string;
  settled: SettledPredictionRow[];
  coverage?: LeagueCoverage;
  /** Global (all-league) settled accuracy, 0-1. Caller supplies this. */
  baselineAccuracy: number;
}

export interface MarketMetrics {
  n: number;
  accuracy: number | null;
  brier: number | null;
}

export interface LeagueGateResult {
  leagueKey: string;
  leagueName: string | null;
  modelVersion: string | null;
  verdict: GateVerdict;
  sampleSize: number;
  accuracy: number | null;
  baselineAccuracy: number;
  accuracyDelta: number | null; // accuracy - baselineAccuracy
  brier: number | null;
  /** Mean |bucket predicted - bucket observed| across decile buckets. */
  calibrationGap: number | null;
  perMarket: Record<string, MarketMetrics>;
  coverage: {
    finishedFixtures: number;
    oddsCoverage: number | null; // fraction 0-1
    injuryCoverage: number | null; // fraction 0-1
  };
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Thresholds (exported for tests / tuning)
// ---------------------------------------------------------------------------

export const GATE_MIN_SETTLED = 10;
export const GATE_MIN_SETTLED_STRONG = 30;
export const GATE_ACCURACY_TOLERANCE = 0.05; // trusted: within 5pp of baseline
export const GATE_EXCLUDE_ACCURACY_GAP = 0.10; // exclude: >10pp below baseline
export const GATE_CALIBRATION_OK = 0.10;
export const GATE_CALIBRATION_BAD = 0.20;
const CALIBRATION_BUCKETS = 10;

// ---------------------------------------------------------------------------
// Pure metrics
// ---------------------------------------------------------------------------

export function brierScore(rows: SettledPredictionRow[]): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce(
    (s, r) => s + Math.pow(r.modelProbability - (r.correct ? 1 : 0), 2),
    0
  );
  return sum / rows.length;
}

export function accuracy(rows: SettledPredictionRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.correct).length / rows.length;
}

/**
 * Calibration gap: split predictions into decile buckets by predicted
 * probability, compare mean predicted vs observed frequency per bucket,
 * return the sample-size-weighted mean absolute gap. Null when no bucket
 * has >= 2 samples (gap is meaningless on singleton buckets).
 */
export function calibrationGap(rows: SettledPredictionRow[]): number | null {
  const buckets = new Map<number, { pred: number[]; obs: number[] }>();
  for (const r of rows) {
    const b = Math.min(
      Math.floor(r.modelProbability * CALIBRATION_BUCKETS),
      CALIBRATION_BUCKETS - 1
    );
    let bucket = buckets.get(b);
    if (!bucket) {
      bucket = { pred: [], obs: [] };
      buckets.set(b, bucket);
    }
    bucket.pred.push(r.modelProbability);
    bucket.obs.push(r.correct ? 1 : 0);
  }

  let weighted = 0;
  let weight = 0;
  for (const { pred, obs } of buckets.values()) {
    if (obs.length < 2) continue;
    const avgPred = pred.reduce((a, b) => a + b, 0) / pred.length;
    const avgObs = obs.reduce((a, b) => a + b, 0) / obs.length;
    weighted += Math.abs(avgPred - avgObs) * obs.length;
    weight += obs.length;
  }
  return weight > 0 ? weighted / weight : null;
}

// ---------------------------------------------------------------------------
// Pure gate verdict
// ---------------------------------------------------------------------------

export function computeLeagueGate(input: LeagueGateInput): LeagueGateResult {
  const { settled, baselineAccuracy } = input;
  const n = settled.length;

  const acc = accuracy(settled);
  const brier = brierScore(settled);
  const calGap = calibrationGap(settled);

  const perMarket: Record<string, MarketMetrics> = {};
  const byMarket = new Map<string, SettledPredictionRow[]>();
  for (const r of settled) {
    const arr = byMarket.get(r.market) ?? [];
    arr.push(r);
    byMarket.set(r.market, arr);
  }
  for (const [market, rows] of byMarket) {
    perMarket[market] = {
      n: rows.length,
      accuracy: accuracy(rows),
      brier: brierScore(rows),
    };
  }

  const coverage = {
    finishedFixtures: input.coverage?.finishedFixtures ?? 0,
    oddsCoverage:
      input.coverage && input.coverage.finishedFixtures > 0
        ? input.coverage.oddsCoveredFixtures / input.coverage.finishedFixtures
        : null,
    injuryCoverage:
      input.coverage && input.coverage.finishedFixtures > 0
        ? input.coverage.injuryCoveredFixtures / input.coverage.finishedFixtures
        : null,
  };

  const reasons: string[] = [];
  let verdict: GateVerdict;

  if (n < GATE_MIN_SETTLED) {
    verdict = "insufficient";
    reasons.push(`only ${n} settled predictions (< ${GATE_MIN_SETTLED})`);
  } else {
    const accDelta = acc === null ? null : acc - baselineAccuracy;
    const significantlyWorse =
      (accDelta !== null && accDelta < -GATE_EXCLUDE_ACCURACY_GAP) ||
      (calGap !== null && calGap > GATE_CALIBRATION_BAD);
    const trusted =
      n >= GATE_MIN_SETTLED_STRONG &&
      accDelta !== null &&
      accDelta >= -GATE_ACCURACY_TOLERANCE &&
      calGap !== null &&
      calGap <= GATE_CALIBRATION_OK;

    if (n >= GATE_MIN_SETTLED_STRONG && significantlyWorse) {
      verdict = "exclude";
      if (accDelta !== null && accDelta < -GATE_EXCLUDE_ACCURACY_GAP) {
        reasons.push(
          `accuracy ${(acc! * 100).toFixed(1)}% is ${(-accDelta * 100).toFixed(1)}pp below baseline ${(baselineAccuracy * 100).toFixed(1)}%`
        );
      }
      if (calGap !== null && calGap > GATE_CALIBRATION_BAD) {
        reasons.push(`calibration gap ${(calGap * 100).toFixed(1)}pp > ${(GATE_CALIBRATION_BAD * 100).toFixed(0)}pp`);
      }
    } else if (trusted) {
      verdict = "trusted";
      reasons.push(
        `n=${n}, accuracy within ${(GATE_ACCURACY_TOLERANCE * 100).toFixed(0)}pp of baseline, calibration ok`
      );
    } else {
      verdict = "watch";
      if (n < GATE_MIN_SETTLED_STRONG) {
        reasons.push(`${n} settled predictions — below strong-evidence threshold of ${GATE_MIN_SETTLED_STRONG}`);
      }
      if (accDelta !== null && accDelta < -GATE_ACCURACY_TOLERANCE) {
        reasons.push(`accuracy ${(accDelta * 100).toFixed(1)}pp below baseline`);
      }
      if (calGap !== null && calGap > GATE_CALIBRATION_OK) {
        reasons.push(`calibration gap ${(calGap * 100).toFixed(1)}pp elevated`);
      }
      if (reasons.length === 0) reasons.push("insufficient evidence for trusted/exclude");
    }
  }

  return {
    leagueKey: input.leagueKey,
    leagueName: input.leagueName ?? null,
    modelVersion: input.modelVersion ?? null,
    verdict,
    sampleSize: n,
    accuracy: acc,
    baselineAccuracy,
    accuracyDelta: acc === null ? null : acc - baselineAccuracy,
    brier,
    calibrationGap: calGap,
    perMarket,
    coverage,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// DB collector
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export interface CollectGatesOptions {
  /** How far back to look for settled predictions. Default 180 days. */
  sinceDays?: number;
  /** Row cap for the settled-prediction scan. Default 50000. */
  limit?: number;
}

/**
 * Collect settled predictions joined to fixtures/leagues, score every league,
 * and upsert league_model_gates. Returns the computed results.
 * Non-fatal by design: callers (cron) should wrap in try/catch.
 */
export async function collectAndPersistGates(
  supabase: SupabaseLike,
  opts: CollectGatesOptions = {}
): Promise<{ results: LeagueGateResult[]; persisted: number }> {
  const sinceDays = opts.sinceDays ?? 180;
  const limit = opts.limit ?? 50000;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Settled predictions in window
  const { data: preds, error: predErr } = await supabase
    .from("predictions")
    .select("fixture_id, market, model_probability, result, model_version, settled_at")
    .in("result", ["correct", "wrong"])
    .gte("settled_at", cutoff)
    .limit(limit);
  if (predErr) throw new Error(`predictions query failed: ${predErr.message}`);
  if (!preds || preds.length === 0) return { results: [], persisted: 0 };

  // 2. Fixtures for those predictions (league + coverage signals)
  const fixtureIds = [...new Set(preds.map((p: any) => p.fixture_id))];
  const fixtureMap = new Map<string, any>();
  const CHUNK = 200;
  for (let i = 0; i < fixtureIds.length; i += CHUNK) {
    const { data: fx } = await supabase
      .from("fixtures")
      .select("id, league_id, status, home_score, away_score, home_team_id, away_team_id")
      .in("id", fixtureIds.slice(i, i + CHUNK));
    for (const f of fx || []) fixtureMap.set(f.id, f);
  }

  // 3. League names
  const leagueIds = [
    ...new Set(
      [...fixtureMap.values()]
        .map((f) => f.league_id)
        .filter((x): x is string => !!x)
    ),
  ];
  const leagueNames = new Map<string, string>();
  for (let i = 0; i < leagueIds.length; i += CHUNK) {
    const { data: lg } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", leagueIds.slice(i, i + CHUNK));
    for (const l of lg || []) leagueNames.set(l.id, l.name);
  }

  // 4. Global baseline accuracy across ALL settled predictions in window
  const totalCorrect = preds.filter((p: any) => p.result === "correct").length;
  const baselineAccuracy = preds.length > 0 ? totalCorrect / preds.length : 0;

  // 5. Per-league coverage: all fixtures for involved leagues (not just
  //    predicted ones) so coverage reflects data availability, not usage.
  const coverageByLeague = new Map<
    string,
    { finished: number; odds: number; injury: number }
  >();
  const leagueFixtures = new Map<string, any[]>();
  for (let i = 0; i < leagueIds.length; i += CHUNK) {
    const { data: fxs } = await supabase
      .from("fixtures")
      .select("id, league_id, status, home_score, away_score, home_team_id, away_team_id")
      .in("league_id", leagueIds.slice(i, i + CHUNK))
      .limit(20000);
    for (const f of fxs || []) {
      const arr = leagueFixtures.get(f.league_id) ?? [];
      arr.push(f);
      leagueFixtures.set(f.league_id, arr);
    }
  }

  // Odds coverage: which fixture_ids have any odds snapshot
  const allFxIds = [...leagueFixtures.values()].flat().map((f) => f.id);
  const oddsCovered = new Set<string>();
  for (let i = 0; i < allFxIds.length; i += CHUNK) {
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("fixture_id")
      .in("fixture_id", allFxIds.slice(i, i + CHUNK))
      .limit(50000);
    for (const o of odds || []) oddsCovered.add(o.fixture_id);
  }

  // Injury coverage: team names present in player_injury_data. Table may not
  // exist in every environment — degrade to null coverage on failure.
  const injuredTeams = new Set<string>();
  try {
    const { data: injuries } = await supabase
      .from("player_injury_data")
      .select("team_name")
      .limit(20000);
    for (const r of injuries || []) {
      if (r.team_name) injuredTeams.add(r.team_name.toLowerCase());
    }
  } catch {
    // table absent — injury coverage stays null
  }

  // Team id → name for injury matching
  const teamIds = new Set<string>();
  for (const fxs of leagueFixtures.values()) {
    for (const f of fxs) {
      if (f.home_team_id) teamIds.add(f.home_team_id);
      if (f.away_team_id) teamIds.add(f.away_team_id);
    }
  }
  const teamNames = new Map<string, string>();
  const teamIdArr = [...teamIds];
  for (let i = 0; i < teamIdArr.length; i += CHUNK) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIdArr.slice(i, i + CHUNK));
    for (const t of teams || []) teamNames.set(t.id, (t.name || "").toLowerCase());
  }

  for (const [leagueId, fxs] of leagueFixtures) {
    let finished = 0;
    let odds = 0;
    let injury = 0;
    for (const f of fxs) {
      const isFinished =
        f.status === "finished" || (f.home_score !== null && f.away_score !== null);
      if (!isFinished) continue;
      finished++;
      if (oddsCovered.has(f.id)) odds++;
      const homeHit = f.home_team_id && injuredTeams.has(teamNames.get(f.home_team_id) ?? "");
      const awayHit = f.away_team_id && injuredTeams.has(teamNames.get(f.away_team_id) ?? "");
      if (homeHit || awayHit) injury++;
    }
    coverageByLeague.set(leagueId, { finished, odds, injury });
  }

  // 6. Group settled predictions by league
  const byLeague = new Map<
    string,
    { name?: string; rows: SettledPredictionRow[]; versions: Map<string, number> }
  >();
  for (const p of preds) {
    const fx = fixtureMap.get(p.fixture_id);
    const leagueId = fx?.league_id ?? null;
    const key = leagueId ?? "unknown";
    let bucket = byLeague.get(key);
    if (!bucket) {
      bucket = { name: leagueId ? leagueNames.get(leagueId) : "Unknown", rows: [], versions: new Map() };
      byLeague.set(key, bucket);
    }
    if (p.model_probability == null) continue;
    bucket.rows.push({
      market: p.market || "unknown",
      modelProbability: Number(p.model_probability),
      correct: p.result === "correct",
    });
    const mv = p.model_version || "unknown";
    bucket.versions.set(mv, (bucket.versions.get(mv) ?? 0) + 1);
  }

  // 7. Score each league
  const results: LeagueGateResult[] = [];
  for (const [key, bucket] of byLeague) {
    const dominantVersion =
      [...bucket.versions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cov = key === "unknown" ? undefined : coverageByLeague.get(key);
    results.push(
      computeLeagueGate({
        leagueKey: key,
        leagueName: bucket.name,
        modelVersion: dominantVersion ?? undefined,
        settled: bucket.rows,
        coverage: cov
          ? {
              finishedFixtures: cov.finished,
              oddsCoveredFixtures: cov.odds,
              injuryCoveredFixtures: cov.injury,
            }
          : undefined,
        baselineAccuracy,
      })
    );
  }

  // 8. Persist (upsert on league_key + market + model_version)
  const computedAt = new Date().toISOString();
  const rows = results.map((r) => ({
    league_key: r.leagueKey,
    league_id: r.leagueKey === "unknown" ? null : r.leagueKey,
    league_name: r.leagueName,
    market: "ALL",
    model_version: r.modelVersion ?? "unknown",
    verdict: r.verdict,
    metrics: {
      sample_size: r.sampleSize,
      accuracy: r.accuracy,
      baseline_accuracy: r.baselineAccuracy,
      accuracy_delta: r.accuracyDelta,
      brier: r.brier,
      calibration_gap: r.calibrationGap,
      per_market: r.perMarket,
      coverage: r.coverage,
      reasons: r.reasons,
      model_versions_seen: r.modelVersion,
    },
    sample_size: r.sampleSize,
    computed_at: computedAt,
  }));

  let persisted = 0;
  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("league_model_gates")
      .upsert(rows, { onConflict: "league_key,market,model_version" });
    if (upErr) throw new Error(`league_model_gates upsert failed: ${upErr.message}`);
    persisted = rows.length;
  }

  return { results, persisted };
}

/**
 * Lightweight lookup for consumers (e.g. predict route input_snapshot
 * enrichment): league_key → latest verdict. Returns empty map on any error —
 * gating is advisory and must never break prediction recording.
 */
export async function getLeagueGateVerdicts(
  supabase: SupabaseLike
): Promise<Map<string, GateVerdict>> {
  const map = new Map<string, GateVerdict>();
  try {
    const { data } = await supabase
      .from("league_model_gates")
      .select("league_key, verdict, computed_at")
      .eq("market", "ALL")
      .order("computed_at", { ascending: false })
      .limit(1000);
    const seen = new Set<string>();
    for (const row of data || []) {
      if (seen.has(row.league_key)) continue; // rows already newest-first
      seen.add(row.league_key);
      map.set(row.league_key, row.verdict as GateVerdict);
    }
  } catch {
    // table may not exist yet — advisory only
  }
  return map;
}
