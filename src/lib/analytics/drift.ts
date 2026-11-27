/**
 * Model drift detection.
 *
 * Strategic requirement (docs/ODDLY-STRATEGIC-ASSESSMENT.md §5): distinguish
 * variance from deterioration, and NEVER auto-change the model on small
 * samples. This module is detection + alerting only.
 *
 * Method: for each (model_version, market), compare settled predictions in a
 * recent 30-day window vs the prior 90-day window. A two-sample z-test on the
 * per-prediction Brier values ((p - y)^2) tests whether mean Brier changed.
 * A complementary check on accuracy deltas is reported as evidence.
 *
 * Statuses:
 *  - 'insufficient_data'  either window has < MIN_WINDOW_N settled predictions
 *  - 'drift_suspected'    p < 0.05 AND recent Brier is worse (delta > 0)
 *  - 'watch'              p < 0.10, or |deltaBrier| > 0.02, or accuracy drop > 5pp
 *  - 'stable'             otherwise
 *
 * Persistence: upserts into model_drift_status (latest per model_version+market)
 * and raises a cron_alerts 'DRIFT' alert (via log_cron_alert) for
 * drift_suspected — no automatic model changes are made anywhere.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftStatus = "stable" | "watch" | "drift_suspected" | "insufficient_data";

export interface DriftSample {
  modelVersion: string;
  market: string;
  /** Predicted probability of the selected outcome, 0-1. */
  probability: number;
  /** Whether the selection settled correct. */
  correct: boolean;
  /** ISO timestamp the prediction settled. */
  settledAt: string;
}

export interface WindowMetrics {
  n: number;
  accuracy: number | null;
  brier: number | null;
  /** Sample variance of per-prediction Brier values. */
  brierVariance: number | null;
  meanProbability: number | null;
}

export interface DriftResult {
  modelVersion: string;
  market: string;
  recentWindow: { start: string; end: string };
  priorWindow: { start: string; end: string };
  recent: WindowMetrics;
  prior: WindowMetrics;
  /** recent.brier - prior.brier (positive = worse). */
  brierDelta: number | null;
  accuracyDelta: number | null;
  /** Two-sample z statistic on Brier means. */
  zScore: number | null;
  /** Two-sided p-value from normal approximation. */
  pValue: number | null;
  driftStatus: DriftStatus;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const DRIFT_RECENT_DAYS = 30;
export const DRIFT_PRIOR_DAYS = 90; // window is [now-120d, now-30d)
export const DRIFT_MIN_WINDOW_N = 50;
export const DRIFT_P_WATCH = 0.1;
export const DRIFT_P_SUSPECTED = 0.05;
export const DRIFT_BRIER_DELTA_WATCH = 0.02;
export const DRIFT_ACCURACY_DROP_WATCH = 0.05;

// ---------------------------------------------------------------------------
// Pure statistics helpers
// ---------------------------------------------------------------------------

/** Abramowitz–Stegun erf approximation (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function windowMetrics(rows: DriftSample[]): WindowMetrics {
  const n = rows.length;
  if (n === 0) {
    return { n: 0, accuracy: null, brier: null, brierVariance: null, meanProbability: null };
  }
  let correct = 0;
  let brierSum = 0;
  let probSum = 0;
  const briers: number[] = [];
  for (const r of rows) {
    const y = r.correct ? 1 : 0;
    if (r.correct) correct++;
    const b = Math.pow(r.probability - y, 2);
    briers.push(b);
    brierSum += b;
    probSum += r.probability;
  }
  const mean = brierSum / n;
  const variance =
    n > 1 ? briers.reduce((s, b) => s + (b - mean) * (b - mean), 0) / (n - 1) : 0;
  return {
    n,
    accuracy: correct / n,
    brier: mean,
    brierVariance: variance,
    meanProbability: probSum / n,
  };
}

// ---------------------------------------------------------------------------
// Pure drift computation
// ---------------------------------------------------------------------------

export function computeDrift(
  samples: DriftSample[],
  now: Date = new Date()
): DriftResult {
  const recentStart = new Date(now.getTime() - DRIFT_RECENT_DAYS * 86400000);
  const priorStart = new Date(now.getTime() - (DRIFT_RECENT_DAYS + DRIFT_PRIOR_DAYS) * 86400000);

  const recentRows = samples.filter((s) => {
    const t = new Date(s.settledAt).getTime();
    return t >= recentStart.getTime();
  });
  const priorRows = samples.filter((s) => {
    const t = new Date(s.settledAt).getTime();
    return t >= priorStart.getTime() && t < recentStart.getTime();
  });

  const recent = windowMetrics(recentRows);
  const prior = windowMetrics(priorRows);

  const base = {
    modelVersion: samples[0]?.modelVersion ?? "unknown",
    market: samples[0]?.market ?? "unknown",
    recentWindow: { start: recentStart.toISOString(), end: now.toISOString() },
    priorWindow: { start: priorStart.toISOString(), end: recentStart.toISOString() },
    recent,
    prior,
  };

  const reasons: string[] = [];

  if (recent.n < DRIFT_MIN_WINDOW_N || prior.n < DRIFT_MIN_WINDOW_N) {
    reasons.push(
      `insufficient samples: recent n=${recent.n}, prior n=${prior.n} (min ${DRIFT_MIN_WINDOW_N}/window)`
    );
    return {
      ...base,
      brierDelta: null,
      accuracyDelta: null,
      zScore: null,
      pValue: null,
      driftStatus: "insufficient_data",
      reasons,
    };
  }

  const brierDelta = (recent.brier ?? 0) - (prior.brier ?? 0);
  const accuracyDelta =
    recent.accuracy !== null && prior.accuracy !== null
      ? recent.accuracy - prior.accuracy
      : null;

  // Two-sample z-test on per-prediction Brier values.
  const se = Math.sqrt(
    (recent.brierVariance ?? 0) / recent.n + (prior.brierVariance ?? 0) / prior.n
  );
  let zScore: number | null = null;
  let pValue: number | null = null;
  if (se > 0) {
    zScore = brierDelta / se;
    pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  } else if (brierDelta !== 0) {
    // Degenerate variance but means differ — treat as maximal evidence.
    zScore = brierDelta > 0 ? Infinity : -Infinity;
    pValue = 0;
  } else {
    zScore = 0;
    pValue = 1;
  }

  let driftStatus: DriftStatus = "stable";
  if (pValue !== null && pValue < DRIFT_P_SUSPECTED && brierDelta > 0) {
    driftStatus = "drift_suspected";
    reasons.push(
      `Brier worsened by ${brierDelta.toFixed(4)} (z=${zScore === Infinity ? "inf" : zScore?.toFixed(2)}, p=${pValue.toExponential(2)})`
    );
  } else {
    if (pValue !== null && pValue < DRIFT_P_WATCH) {
      driftStatus = "watch";
      reasons.push(`Brier change marginally significant (p=${pValue.toExponential(2)})`);
    }
    if (Math.abs(brierDelta) > DRIFT_BRIER_DELTA_WATCH) {
      if (driftStatus === "stable") driftStatus = "watch";
      reasons.push(`Brier delta ${brierDelta.toFixed(4)} exceeds ±${DRIFT_BRIER_DELTA_WATCH}`);
    }
    if (accuracyDelta !== null && accuracyDelta < -DRIFT_ACCURACY_DROP_WATCH) {
      if (driftStatus === "stable") driftStatus = "watch";
      reasons.push(
        `accuracy dropped ${(accuracyDelta * 100).toFixed(1)}pp (${((prior.accuracy ?? 0) * 100).toFixed(1)}% → ${((recent.accuracy ?? 0) * 100).toFixed(1)}%)`
      );
    }
    if (reasons.length === 0) reasons.push("no significant change between windows");
  }

  return {
    ...base,
    brierDelta,
    accuracyDelta,
    zScore: zScore === Infinity ? null : zScore === -Infinity ? null : zScore,
    pValue,
    driftStatus,
    reasons,
  };
}

/** Group raw settled predictions into per-(version, market) DriftSamples. */
export function groupDriftSamples(
  rows: Array<{
    model_version: string | null;
    market: string | null;
    model_probability: number | null;
    result: string | null;
    settled_at: string | null;
    created_at?: string | null;
  }>
): Map<string, DriftSample[]> {
  const groups = new Map<string, DriftSample[]>();
  for (const r of rows) {
    if (!r.model_probability || !r.settled_at) continue;
    if (r.result !== "correct" && r.result !== "wrong") continue;
    const modelVersion = r.model_version || "unknown";
    const market = r.market || "unknown";
    const key = `${modelVersion}::${market}`;
    const arr = groups.get(key) ?? [];
    arr.push({
      modelVersion,
      market,
      probability: Number(r.model_probability),
      correct: r.result === "correct",
      settledAt: r.settled_at,
    });
    groups.set(key, arr);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// DB collector + persistence
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export interface CollectDriftOptions {
  sinceDays?: number; // how far back to scan; must cover prior window (default 130)
  limit?: number;
}

/**
 * Scan settled predictions, compute drift per (model_version, market),
 * upsert model_drift_status, and raise cron_alerts for drift_suspected.
 * Detection + alerting ONLY — never mutates models or league gates.
 */
export async function collectAndPersistDrift(
  supabase: SupabaseLike,
  opts: CollectDriftOptions = {},
  now: Date = new Date()
): Promise<{ results: DriftResult[]; persisted: number; alerts: number }> {
  const sinceDays = opts.sinceDays ?? DRIFT_RECENT_DAYS + DRIFT_PRIOR_DAYS + 10;
  const limit = opts.limit ?? 100000;
  const cutoff = new Date(now.getTime() - sinceDays * 86400000).toISOString();

  const { data: preds, error } = await supabase
    .from("predictions")
    .select("model_version, market, model_probability, result, settled_at")
    .in("result", ["correct", "wrong"])
    .not("settled_at", "is", null)
    .gte("settled_at", cutoff)
    .limit(limit);
  if (error) throw new Error(`predictions query failed: ${error.message}`);
  if (!preds || preds.length === 0) return { results: [], persisted: 0, alerts: 0 };

  const groups = groupDriftSamples(preds);
  const results: DriftResult[] = [];
  for (const samples of groups.values()) {
    if (samples.length === 0) continue;
    results.push(computeDrift(samples, now));
  }

  const computedAt = now.toISOString();
  const rows = results.map((r) => ({
    model_version: r.modelVersion,
    market: r.market,
    recent_window_start: r.recentWindow.start,
    recent_window_end: r.recentWindow.end,
    prior_window_start: r.priorWindow.start,
    prior_window_end: r.priorWindow.end,
    recent_n: r.recent.n,
    prior_n: r.prior.n,
    recent_accuracy: r.recent.accuracy,
    prior_accuracy: r.prior.accuracy,
    recent_brier: r.recent.brier,
    prior_brier: r.prior.brier,
    brier_delta: r.brierDelta,
    accuracy_delta: r.accuracyDelta,
    z_score: r.zScore,
    p_value: r.pValue,
    drift_status: r.driftStatus,
    reasons: r.reasons,
    computed_at: computedAt,
  }));

  let persisted = 0;
  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("model_drift_status")
      .upsert(rows, { onConflict: "model_version,market" });
    if (upErr) throw new Error(`model_drift_status upsert failed: ${upErr.message}`);
    persisted = rows.length;
  }

  // Alerting only — cron_alerts dedupes OPEN alerts per job+type.
  let alerts = 0;
  for (const r of results) {
    if (r.driftStatus !== "drift_suspected") continue;
    try {
      await supabase.rpc("log_cron_alert", {
        p_job_name: "learn",
        p_alert_type: "DRIFT",
        p_severity: "WARNING",
        p_message: `Model drift suspected: ${r.modelVersion}/${r.market} — ${r.reasons.join("; ")}`,
        p_metric_value: r.brierDelta,
        p_threshold: 0,
      });
      alerts++;
    } catch {
      // alerting is best-effort
    }
  }

  return { results, persisted, alerts };
}
