/**
 * StatsBomb Open Data — Player Appearances / Lineups Ingester
 *
 * Downloads every competition/season listed in the StatsBomb open-data repo
 * (https://github.com/statsbomb/open-data), fetches each match's lineup file
 * (data/lineups/{match_id}.json), and upserts player appearance rows into
 * Supabase `player_appearances` using the denormalized text columns added by
 * migration 20261223000000_player_appearance_sources.sql.
 *
 * Team/player normalization reuses the production TS helpers so the stored
 * `team_name_normalized` / `player_name_normalized` keys match what
 * `buildPredictedLineup` computes at read time.
 *
 * Run:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' scripts/ingest-lineups-statsbomb.ts
 *   (optionally: -- --min-date 2021-01-01 --delay 120)
 *
 * Progress is checkpointed to data/statsbomb-open/progress.json so the script
 * can be re-run/resumed safely. Inserts are idempotent via the partial unique
 * index idx_pa_source_dedupe (source, external_match_id, external_player_id,
 * team_name_normalized) — duplicate-key violations are skipped.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "../src/lib/football/team-normalizer";
import { personKey } from "../src/lib/players/importance";

// ─── Config ────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "..", "data", "statsbomb-open");
const COMPETITIONS_CACHE = path.join(DATA_DIR, "competitions.json");
const MATCH_DIRS_CACHE = path.join(DATA_DIR, "match-dirs.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");
const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";
const SOURCE = "statsbomb-open-data";

const args = process.argv.slice(2);
function argVal(flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const MIN_DATE = argVal("--min-date", "0000-00-00"); // skip matches older than this
const DELAY_MS = parseInt(argVal("--delay", "120"), 10);
const FLUSH_EVERY = 400; // rows per insert batch

// ─── Env / Supabase ────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── HTTP ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ODDLY-lineup-ingest/1.0" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

// ─── StatsBomb lineup parsing ──────────────────────────────────────────────

interface SbPosition {
  position_id?: number;
  position?: string;
  from?: string | null;
  to?: string | null;
  start_reason?: string | null;
  end_reason?: string | null;
}

interface SbPlayer {
  player_id?: number | null;
  player_name?: string | null;
  jersey_number?: number | null;
  positions?: SbPosition[];
}

interface SbTeamEntry {
  team_id?: number;
  team_name?: string;
  lineup?: SbPlayer[];
}

/** "MM:SS" (or "HH:MM:SS") → seconds. */
function timeToSec(t?: string | null): number | null {
  if (!t) return null;
  const parts = String(t).split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Estimate total match length in seconds from all position segments in the
 * match file. Used to close open-ended (to=null, "Final Whistle") segments.
 */
function estimateMatchLenSec(lineupJson: SbTeamEntry[]): number {
  let maxEnd = 0;
  for (const team of lineupJson) {
    for (const p of team.lineup || []) {
      for (const pos of p.positions || []) {
        const to = timeToSec(pos.to);
        if (to != null && to > maxEnd) maxEnd = to;
      }
    }
  }
  // Stoppage time usually pushes past the last recorded substitution/segment
  // end; add ~5 min buffer, floor at 90 min.
  return Math.max(maxEnd + 300, 90 * 60);
}

/**
 * Derive is_starter / minutes_played / position for one player from their
 * position segments. Players with no segments did not appear — returns null.
 */
function deriveAppearance(
  player: SbPlayer,
  matchLenSec: number
): { isStarter: boolean; minutes: number | null; position: string | null } | null {
  const segs = (player.positions || []).filter((p) => p && (timeToSec(p.from) != null || p.position));
  if (segs.length === 0) return null;

  const isStarter = segs.some((p) => p.start_reason === "Starting XI");

  // Earliest segment determines the listed position.
  const sorted = [...segs].sort(
    (a, b) => (timeToSec(a.from) ?? Infinity) - (timeToSec(b.from) ?? Infinity)
  );
  const position = sorted[0]?.position || segs[0]?.position || null;

  // Sum segment durations; open-ended final segments run to match end.
  let totalSec = 0;
  let computable = false;
  for (const seg of segs) {
    const from = timeToSec(seg.from);
    const to = timeToSec(seg.to);
    if (from == null) continue;
    const end = to != null ? to : matchLenSec;
    if (end > from) {
      totalSec += end - from;
      computable = true;
    }
  }
  const minutes = computable ? Math.max(0, Math.round(totalSec / 60)) : null;

  return { isStarter, minutes, position };
}

// ─── Fixture / team join maps ──────────────────────────────────────────────

interface TeamRow {
  id: string;
  canonical_name: string | null;
}

interface FixtureRow {
  id: string;
  kickoff_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
}

/** date (YYYY-MM-DD) of an ISO timestamp in UTC. */
function utcDate(ts?: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface Progress {
  doneMatchIds: string[];
  stats: Record<
    string,
    { matches: number; lineupFiles: number; rows: number; errors: number; competition?: string }
  >;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
      return {
        doneMatchIds: p.doneMatchIds || [],
        stats: p.stats || {},
      };
    } catch {
      /* fall through */
    }
  }
  return { doneMatchIds: [], stats: {} };
}

function saveProgress(p: Progress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function main() {
  console.log("=== StatsBomb lineup ingest → player_appearances ===");
  console.log(`source='${SOURCE}'  min-date=${MIN_DATE}  delay=${DELAY_MS}ms`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Load competition/season list ──────────────────────────────────────
  if (!fs.existsSync(COMPETITIONS_CACHE)) {
    console.log("Downloading competitions.json ...");
    // competitions.json lives at data/competitions.json
    const comps2 = await fetchJSON(`${BASE}/competitions.json`);
    fs.writeFileSync(COMPETITIONS_CACHE, JSON.stringify(comps2));
  }
  const competitions = JSON.parse(fs.readFileSync(COMPETITIONS_CACHE, "utf8"));

  // Discover actual matches/{comp}/{season} files via cached GitHub listing.
  let matchDirs: Record<string, string[]> = {};
  if (fs.existsSync(MATCH_DIRS_CACHE)) {
    matchDirs = JSON.parse(fs.readFileSync(MATCH_DIRS_CACHE, "utf8"));
  } else {
    console.log("Discovering matches directories (GitHub API) ...");
    const compIds = [...new Set(competitions.map((c: any) => c.competition_id))];
    for (const id of compIds) {
      const r = await fetch(
        `https://api.github.com/repositories/136174015/contents/data/matches/${id}`,
        { headers: { "User-Agent": "oddly-ingest" } }
      );
      if (r.ok) {
        const j: any = await r.json();
        matchDirs[String(id)] = j.map((f: any) => f.name.replace(".json", ""));
      } else {
        matchDirs[String(id)] = [];
      }
      await sleep(60);
    }
    fs.writeFileSync(MATCH_DIRS_CACHE, JSON.stringify(matchDirs));
  }

  // comp name lookup
  const compName = new Map<number, string>();
  for (const c of competitions) {
    if (!compName.has(c.competition_id)) compName.set(c.competition_id, c.competition_name);
  }

  // ── Build fixture/team join maps ──────────────────────────────────────
  console.log("Loading teams + fixtures for best-effort joins ...");
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, canonical_name")
    .limit(5000);

  // fixtures is large (~27k rows) and PostgREST caps page size — paginate.
  const fixtureRows: FixtureRow[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("fixtures")
        .select("id, kickoff_time, home_team_id, away_team_id")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      fixtureRows.push(...(data as FixtureRow[]));
      if (data.length < PAGE) break;
    }
  }
  console.log(`  ${fixtureRows.length} fixtures loaded`);

  const teamByNorm = new Map<string, string>();
  const teamNameById = new Map<string, string>();
  for (const t of (teamRows || []) as TeamRow[]) {
    const key = normalizeTeamName(t.canonical_name || "");
    if (key && !teamByNorm.has(key)) teamByNorm.set(key, t.id);
    if (t.id) teamNameById.set(t.id, t.canonical_name || "");
  }

  // fixture map: `${normHome}|${normAway}|${date}` → fixture_id
  const fixtureByKey = new Map<string, string>();
  const fixtures = (fixtureRows || []) as FixtureRow[];
  for (const f of fixtures) {
    const hn = normalizeTeamName(teamNameById.get(f.home_team_id || "") || "");
    const an = normalizeTeamName(teamNameById.get(f.away_team_id || "") || "");
    if (!hn || !an || !f.id) continue;
    const d = utcDate(f.kickoff_time);
    fixtureByKey.set(`${hn}|${an}|${d}`, f.id);
    fixtureByKey.set(`${hn}|${an}|${shiftDate(d, -1)}`, f.id); // tz slack
    fixtureByKey.set(`${hn}|${an}|${shiftDate(d, 1)}`, f.id);
  }

  function resolveFixture(
    homeName: string,
    awayName: string,
    matchDate: string
  ): { fixture_id: string | null; home_team_id: string | null; away_team_id: string | null } {
    const hn = normalizeTeamName(homeName);
    const an = normalizeTeamName(awayName);
    const fixture_id =
      fixtureByKey.get(`${hn}|${an}|${matchDate}`) ||
      fixtureByKey.get(`${hn}|${an}|${shiftDate(matchDate, -1)}`) ||
      fixtureByKey.get(`${hn}|${an}|${shiftDate(matchDate, 1)}`) ||
      null;
    return {
      fixture_id,
      home_team_id: teamByNorm.get(hn) || null,
      away_team_id: teamByNorm.get(an) || null,
    };
  }

  // ── Resume state ──────────────────────────────────────────────────────
  const progress = loadProgress();
  const done = new Set(progress.doneMatchIds);
  // Also skip matches already present in DB (in case progress file lost).
  {
    const { data: existing } = await supabase
      .from("player_appearances")
      .select("external_match_id")
      .eq("source", SOURCE)
      .limit(200000);
    for (const r of existing || []) {
      if (r.external_match_id) done.add(String(r.external_match_id));
    }
    console.log(`Resuming: ${done.size} matches already ingested.`);
  }

  // ── Collect work items: (compId, seasonId) → matches ──────────────────
  const work: Array<{ compId: number; seasonId: string; compName: string }> = [];
  for (const [cid, seasons] of Object.entries(matchDirs)) {
    const name = compName.get(Number(cid)) || `comp-${cid}`;
    for (const sid of seasons) work.push({ compId: Number(cid), seasonId: sid, compName: name });
  }
  console.log(`${work.length} competition/season files to scan.`);

  let buffer: any[] = [];
  let bufferMatches: string[] = [];
  let totalRows = 0;
  let totalMatches = 0;
  let totalLineups = 0;
  let totalErrors = 0;
  let fixturesLinked = 0;

  async function flush() {
    if (buffer.length === 0) return;
    // Try batch insert; on failure fall back to per-match chunks.
    const { error } = await supabase.from("player_appearances").insert(buffer);
    if (!error) {
      totalRows += buffer.length;
      for (const id of bufferMatches) done.add(id);
      bufferMatches = [];
      buffer = [];
      progress.doneMatchIds = [...done];
      saveProgress(progress);
      return;
    }
    // Batch failed (likely dup key) — insert row-by-row in small chunks.
    const chunkSize = 50;
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, i + chunkSize);
      const { error: e2 } = await supabase.from("player_appearances").insert(chunk);
      if (!e2) {
        totalRows += chunk.length;
        continue;
      }
      // Last resort: single rows, skip duplicates.
      for (const row of chunk) {
        const { error: e3 } = await supabase.from("player_appearances").insert(row);
        if (!e3) totalRows += 1;
        else if (e3.code !== "23505") totalErrors += 1;
      }
    }
    for (const id of bufferMatches) done.add(id);
    bufferMatches = [];
    buffer = [];
    progress.doneMatchIds = [...done];
    saveProgress(progress);
  }

  function ensureStat(key: string) {
    if (!progress.stats[key]) progress.stats[key] = { matches: 0, lineupFiles: 0, rows: 0, errors: 0 };
    return progress.stats[key];
  }

  for (const { compId, seasonId, compName: cname } of work) {
    const statKey = `${compId}:${seasonId}`;
    const stat = ensureStat(statKey);
    stat.competition = cname;

    const matches = await fetchJSON(`${BASE}/matches/${compId}/${seasonId}.json`);
    if (!Array.isArray(matches)) {
      console.log(`  [${cname} ${seasonId}] no matches file`);
      continue;
    }
    stat.matches = matches.length;
    console.log(`\n[${cname} / season ${seasonId}] ${matches.length} matches`);

    for (const m of matches) {
      const matchId = String(m.match_id);
      if (done.has(matchId)) continue;
      const matchDate = String(m.match_date || "").slice(0, 10);
      if (MIN_DATE !== "0000-00-00" && matchDate && matchDate < MIN_DATE) {
        continue; // not marked done — cheap re-check on future runs
      }
      const homeName = m.home_team?.home_team_name || "";
      const awayName = m.away_team?.away_team_name || "";

      await sleep(DELAY_MS);
      let lineupJson: SbTeamEntry[] | null = null;
      try {
        lineupJson = await fetchJSON(`${BASE}/lineups/${matchId}.json`);
      } catch (e) {
        stat.errors += 1;
        totalErrors += 1;
      }
      if (!Array.isArray(lineupJson) || lineupJson.length === 0) {
        done.add(matchId); // no lineup published — mark done, don't retry
        continue;
      }
      totalLineups += 1;
      stat.lineupFiles += 1;

      const matchLenSec = estimateMatchLenSec(lineupJson);
      const { fixture_id, home_team_id, away_team_id } = resolveFixture(
        homeName,
        awayName,
        matchDate
      );
      if (fixture_id) fixturesLinked += 1;

      let rowsThisMatch = 0;
      for (const teamEntry of lineupJson) {
        const teamName = teamEntry.team_name || "";
        const teamNorm = normalizeTeamName(teamName);
        const teamId = teamByNorm.get(teamNorm) || null;
        for (const player of teamEntry.lineup || []) {
          const derived = deriveAppearance(player, matchLenSec);
          if (!derived) continue; // did not appear
          const playerName = (player.player_name || "").trim();
          if (!playerName) continue;
          buffer.push({
            team_name: teamName,
            team_name_normalized: teamNorm || null,
            team_id: teamId,
            player_name: playerName,
            player_name_normalized: personKey(playerName) || null,
            player_id: null,
            fixture_id,
            is_starter: derived.isStarter,
            is_substitute: !derived.isStarter,
            minutes_played: derived.minutes,
            position: derived.position,
            match_date: matchDate || null,
            source: SOURCE,
            external_match_id: matchId,
            external_player_id: player.player_id ?? null,
            raw_json: {
              competition_id: compId,
              competition: cname,
              season_id: Number(seasonId) || seasonId,
              jersey_number: player.jersey_number ?? null,
            },
          });
          rowsThisMatch += 1;
        }
      }
      stat.rows += rowsThisMatch;
      bufferMatches.push(matchId);
      totalMatches += 1;

      if (buffer.length >= FLUSH_EVERY) await flush();
    }
    saveProgress(progress);
  }

  await flush();

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n=== DONE ===");
  console.log(`matches processed: ${totalMatches} (lineups found: ${totalLineups})`);
  console.log(`appearance rows inserted: ${totalRows}  errors: ${totalErrors}`);
  console.log(`fixtures linked: ${fixturesLinked}`);
  console.log("\nPer competition/season:");
  const byComp: Record<string, { matches: number; lineupFiles: number; rows: number }> = {};
  for (const [k, s] of Object.entries(progress.stats)) {
    const comp = (s as any).competition || k;
    if (!byComp[comp]) byComp[comp] = { matches: 0, lineupFiles: 0, rows: 0 };
    byComp[comp].matches += s.matches;
    byComp[comp].lineupFiles += s.lineupFiles;
    byComp[comp].rows += s.rows;
  }
  for (const [comp, s] of Object.entries(byComp).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${comp.padEnd(28)} matches=${String(s.matches).padStart(5)} lineups=${String(s.lineupFiles).padStart(5)} rows=${s.rows}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
