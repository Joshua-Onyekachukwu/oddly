import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TeamInjuryData {
  team_name: string;
  player_name: string;
  status: string;
  injury_type?: string;
  reason?: string;
  is_key_player?: boolean;
  updated_at: string;
}

interface TeamInjuryFeatures {
  team_name: string;
  total_unavailable: number;
  injured_count: number;
  suspended_count: number;
  doubtful_count: number;
  out_count: number;
  availability_pct: number;
  missing_starters: number;
  missing_key_players: number;
  missing_goalkeeper: boolean;
  missing_defenders: number;
  missing_midfielders: number;
  missing_attackers: number;
  injury_impact_score: number;
  key_player_impact: number;
  data_freshness_hours: number;
  source_count: number;
  confidence_score: number;
}

interface FixtureInjuryFeatures {
  fixture_id: string;
  home_team: string;
  away_team: string;
  home_features: TeamInjuryFeatures;
  away_features: TeamInjuryFeatures;
  injury_difference: number;
  availability_difference: number;
  key_player_absence_difference: number;
  attacking_absence_difference: number;
  defensive_absence_difference: number;
}

/**
 * Get current injury data for a team
 */
async function getTeamInjuries(teamName: string): Promise<TeamInjuryData[]> {
  const { data, error } = await supabaseAdmin
    .from("player_availability" as any)
    .select("*")
    .eq("team_name", teamName)
    .in("status", ["injured", "suspended", "doubtful", "out"])
    .gt("updated_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error(`Error fetching injuries for ${teamName}:`, error);
    return [];
  }

  return (data || []) as unknown as TeamInjuryData[];
}

/**
 * Determine if a player is a key player based on name and position
 */
function isKeyPlayer(playerName: string, injuryType?: string): boolean {
  // This is a simplified heuristic - in production, you'd use squad data
  const keyPlayerPatterns = [
    /goalkeeper/i,
    /captain/i,
    /striker/i,
    /forward/i,
    /defender/i,
    /midfielder/i,
  ];

  // Check if injury type suggests key position
  if (injuryType?.match(/goalkeeper|keeper|gk/i)) {
    return true;
  }

  return false;
}

/**
 * Determine player position from injury type or name (simplified)
 */
function getPlayerPosition(playerName: string, injuryType?: string): string {
  // Simplified position detection - in production, use squad API data
  if (injuryType?.match(/goalkeeper|keeper|gk/i)) return "goalkeeper";
  if (injuryType?.match(/defender|back|center-back|full-back/i)) return "defender";
  if (injuryType?.match(/midfielder|midfield|winger/i)) return "midfielder";
  if (injuryType?.match(/striker|forward|attacker/i)) return "attacker";
  
  // Default assumption based on common naming patterns
  if (playerName.match(/ keeper| gk/i)) return "goalkeeper";
  
  return "unknown";
}

/**
 * Calculate injury impact score based on status and type
 */
function calculateInjuryImpact(status: string, injuryType?: string, isKey?: boolean): number {
  let baseImpact = 0;
  
  switch (status) {
    case "injured":
    case "out":
      baseImpact = 1.5;
      break;
    case "suspended":
      baseImpact = 2.0;
      break;
    case "doubtful":
      baseImpact = 0.5;
      break;
    default:
      baseImpact = 0.3;
  }

  // Increase impact for serious injuries
  if (injuryType?.match(/acl|rupture|torn|surgery|fracture/i)) {
    baseImpact *= 2.0;
  } else if (injuryType?.match(/hamstring|groin|muscle/i)) {
    baseImpact *= 1.5;
  }

  // Increase impact for key players
  if (isKey) {
    baseImpact *= 1.8;
  }

  return baseImpact;
}

/**
 * Compute team-level injury features
 */
export async function computeTeamInjuryFeatures(
  teamName: string,
  fixtureId?: string,
  snapshotDate: Date = new Date()
): Promise<TeamInjuryFeatures> {
  const injuries = await getTeamInjuries(teamName);
  
  // Count by status
  const injuredCount = injuries.filter(i => i.status === "injured").length;
  const suspendedCount = injuries.filter(i => i.status === "suspended").length;
  const doubtfulCount = injuries.filter(i => i.status === "doubtful").length;
  const outCount = injuries.filter(i => i.status === "out").length;
  const totalUnavailable = injuredCount + suspendedCount + doubtfulCount + outCount;

  // Assume ~25 player squad for availability percentage
  const squadSize = 25;
  const availabilityPct = Math.max(0, ((squadSize - totalUnavailable) / squadSize) * 100);

  // Count by position (simplified)
  let missingGoalkeeper = false;
  let missingDefenders = 0;
  let missingMidfielders = 0;
  let missingAttackers = 0;
  let missingStarters = 0;
  let missingKeyPlayers = 0;

  for (const injury of injuries) {
    const position = getPlayerPosition(injury.player_name, injury.injury_type);
    const isKey = injury.is_key_player || isKeyPlayer(injury.player_name, injury.injury_type);

    switch (position) {
      case "goalkeeper":
        missingGoalkeeper = true;
        missingStarters++;
        break;
      case "defender":
        missingDefenders++;
        if (isKey) missingStarters++;
        break;
      case "midfielder":
        missingMidfielders++;
        if (isKey) missingStarters++;
        break;
      case "attacker":
        missingAttackers++;
        if (isKey) missingStarters++;
        break;
    }

    if (isKey) missingKeyPlayers++;
  }

  // Calculate impact scores
  let injuryImpactScore = 0;
  let keyPlayerImpact = 0;

  for (const injury of injuries) {
    const isKey = injury.is_key_player || isKeyPlayer(injury.player_name, injury.injury_type);
    const impact = calculateInjuryImpact(injury.status, injury.injury_type, isKey);
    
    injuryImpactScore += impact;
    if (isKey) keyPlayerImpact += impact;
  }

  // Calculate data freshness
  const mostRecentUpdate = injuries.length > 0
    ? Math.max(...injuries.map(i => new Date(i.updated_at).getTime()))
    : 0;
  const dataFreshnessHours = mostRecentUpdate > 0
    ? (Date.now() - mostRecentUpdate) / (1000 * 60 * 60)
    : 999;

  // Count unique sources
  const sources = new Set(injuries.map(i => "player_availability"));

  // Calculate confidence based on freshness and source count
  let confidenceScore = 0.8;
  if (dataFreshnessHours > 72) confidenceScore -= 0.2;
  if (dataFreshnessHours > 168) confidenceScore -= 0.2;
  if (sources.size < 2) confidenceScore -= 0.1;

  return {
    team_name: teamName,
    total_unavailable: totalUnavailable,
    injured_count: injuredCount,
    suspended_count: suspendedCount,
    doubtful_count: doubtfulCount,
    out_count: outCount,
    availability_pct: availabilityPct,
    missing_starters: missingStarters,
    missing_key_players: missingKeyPlayers,
    missing_goalkeeper: missingGoalkeeper,
    missing_defenders: missingDefenders,
    missing_midfielders: missingMidfielders,
    missing_attackers: missingAttackers,
    injury_impact_score: injuryImpactScore,
    key_player_impact: keyPlayerImpact,
    data_freshness_hours: dataFreshnessHours,
    source_count: sources.size,
    confidence_score: Math.max(0, Math.min(1, confidenceScore)),
  };
}

/**
 * Compute fixture-level injury features (home vs away)
 */
export async function computeFixtureInjuryFeatures(
  fixtureId: string,
  homeTeam: string,
  awayTeam: string,
  snapshotDate: Date = new Date()
): Promise<FixtureInjuryFeatures> {
  const [homeFeatures, awayFeatures] = await Promise.all([
    computeTeamInjuryFeatures(homeTeam, fixtureId, snapshotDate),
    computeTeamInjuryFeatures(awayTeam, fixtureId, snapshotDate),
  ]);

  return {
    fixture_id: fixtureId,
    home_team: homeTeam,
    away_team: awayTeam,
    home_features: homeFeatures,
    away_features: awayFeatures,
    injury_difference: homeFeatures.injury_impact_score - awayFeatures.injury_impact_score,
    availability_difference: homeFeatures.availability_pct - awayFeatures.availability_pct,
    key_player_absence_difference: homeFeatures.missing_key_players - awayFeatures.missing_key_players,
    attacking_absence_difference: homeFeatures.missing_attackers - awayFeatures.missing_attackers,
    defensive_absence_difference: 
      (homeFeatures.missing_defenders + (homeFeatures.missing_goalkeeper ? 1 : 0)) -
      (awayFeatures.missing_defenders + (awayFeatures.missing_goalkeeper ? 1 : 0)),
  };
}

/**
 * Save team injury features to database
 */
export async function saveTeamInjuryFeatures(
  features: TeamInjuryFeatures,
  fixtureId?: string,
  fixtureDate?: Date
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("team_injury_features" as any)
    .upsert({
      team_name: features.team_name,
      fixture_id: fixtureId || null,
      fixture_date: fixtureDate?.toISOString() || null,
      snapshot_date: new Date().toISOString(),
      total_unavailable: features.total_unavailable,
      injured_count: features.injured_count,
      suspended_count: features.suspended_count,
      doubtful_count: features.doubtful_count,
      out_count: features.out_count,
      availability_pct: features.availability_pct,
      missing_starters: features.missing_starters,
      missing_key_players: features.missing_key_players,
      missing_goalkeeper: features.missing_goalkeeper,
      missing_defenders: features.missing_defenders,
      missing_midfielders: features.missing_midfielders,
      missing_attackers: features.missing_attackers,
      injury_impact_score: features.injury_impact_score,
      key_player_impact: features.key_player_impact,
      data_freshness_hours: features.data_freshness_hours,
      source_count: features.source_count,
      confidence_score: features.confidence_score,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "team_name,fixture_id,snapshot_date",
    });

  if (error) {
    console.error(`Error saving team injury features for ${features.team_name}:`, error);
  }
}

/**
 * Save fixture injury features to database
 */
export async function saveFixtureInjuryFeatures(
  features: FixtureInjuryFeatures
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("fixture_injury_features" as any)
    .upsert({
      fixture_id: features.fixture_id,
      snapshot_date: new Date().toISOString(),
      
      // Home team features
      home_unavailable: features.home_features.total_unavailable,
      home_injured: features.home_features.injured_count,
      home_suspended: features.home_features.suspended_count,
      home_doubtful: features.home_features.doubtful_count,
      home_availability_pct: features.home_features.availability_pct,
      home_missing_starters: features.home_features.missing_starters,
      home_missing_key_players: features.home_features.missing_key_players,
      home_missing_goalkeeper: features.home_features.missing_goalkeeper,
      home_missing_defenders: features.home_features.missing_defenders,
      home_missing_midfielders: features.home_features.missing_midfielders,
      home_missing_attackers: features.home_features.missing_attackers,
      home_injury_impact: features.home_features.injury_impact_score,
      
      // Away team features
      away_unavailable: features.away_features.total_unavailable,
      away_injured: features.away_features.injured_count,
      away_suspended: features.away_features.suspended_count,
      away_doubtful: features.away_features.doubtful_count,
      away_availability_pct: features.away_features.availability_pct,
      away_missing_starters: features.away_features.missing_starters,
      away_missing_key_players: features.away_features.missing_key_players,
      away_missing_goalkeeper: features.away_features.missing_goalkeeper,
      away_missing_defenders: features.away_features.missing_defenders,
      away_missing_midfielders: features.away_features.missing_midfielders,
      away_missing_attackers: features.away_features.missing_attackers,
      away_injury_impact: features.away_features.injury_impact_score,
      
      // Relative features
      injury_difference: features.injury_difference,
      availability_difference: features.availability_difference,
      key_player_absence_difference: features.key_player_absence_difference,
      attacking_absence_difference: features.attacking_absence_difference,
      defensive_absence_difference: features.defensive_absence_difference,
      
      // Metadata
      data_freshness_hours: Math.max(
        features.home_features.data_freshness_hours,
        features.away_features.data_freshness_hours
      ),
      confidence_score: Math.min(
        features.home_features.confidence_score,
        features.away_features.confidence_score
      ),
    }, {
      onConflict: "fixture_id,snapshot_date",
    });

  if (error) {
    console.error(`Error saving fixture injury features for ${features.fixture_id}:`, error);
  }
}

/**
 * Create historical injury snapshot for a fixture
 */
export async function createInjurySnapshot(
  fixtureId: string,
  fixtureDate: Date,
  homeTeam: string,
  awayTeam: string
): Promise<void> {
  const snapshotDate = new Date();
  
  // Get injuries for both teams
  const [homeInjuries, awayInjuries] = await Promise.all([
    getTeamInjuries(homeTeam),
    getTeamInjuries(awayTeam),
  ]);

  // Create snapshots for home team
  for (const injury of homeInjuries) {
    await supabaseAdmin.from("injury_snapshots" as any).upsert({
      snapshot_date: snapshotDate.toISOString(),
      player_name: injury.player_name,
      team_name: injury.team_name,
      fixture_id: fixtureId,
      fixture_date: fixtureDate.toISOString(),
      status: injury.status as any,
      injury_type: injury.injury_type,
      reason: injury.reason,
      source: "player_availability",
      publication_timestamp: injury.updated_at,
      collection_timestamp: snapshotDate.toISOString(),
      is_historical: true,
    }, {
      onConflict: "player_name,team_name,fixture_id,snapshot_date",
    });
  }

  // Create snapshots for away team
  for (const injury of awayInjuries) {
    await supabaseAdmin.from("injury_snapshots" as any).upsert({
      snapshot_date: snapshotDate.toISOString(),
      player_name: injury.player_name,
      team_name: injury.team_name,
      fixture_id: fixtureId,
      fixture_date: fixtureDate.toISOString(),
      status: injury.status as any,
      injury_type: injury.injury_type,
      reason: injury.reason,
      source: "player_availability",
      publication_timestamp: injury.updated_at,
      collection_timestamp: snapshotDate.toISOString(),
      is_historical: true,
    }, {
      onConflict: "player_name,team_name,fixture_id,snapshot_date",
    });
  }
}

/**
 * Process all scheduled fixtures and compute injury features
 */
export async function processAllFixtures(): Promise<{
  processed: number;
  errors: number;
}> {
  // Get upcoming fixtures (next 7 days)
  const { data: fixtures, error } = await supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name)
    `)
    .gte("kickoff_time", new Date().toISOString())
    .lte("kickoff_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
    .in("status", ["scheduled"]);

  if (error || !fixtures) {
    console.error("Error fetching fixtures:", error);
    return { processed: 0, errors: 1 };
  }

  let processed = 0;
  let errors = 0;

  for (const fixture of fixtures) {
    try {
      const homeTeam = (fixture.home_team as unknown as { canonical_name: string })?.canonical_name;
      const awayTeam = (fixture.away_team as unknown as { canonical_name: string })?.canonical_name;

      if (!homeTeam || !awayTeam) {
        console.warn(`Missing team names for fixture ${fixture.id}`);
        errors++;
        continue;
      }

      // Compute and save team features
      const [homeFeatures, awayFeatures] = await Promise.all([
        computeTeamInjuryFeatures(homeTeam, fixture.id, new Date(fixture.kickoff_time)),
        computeTeamInjuryFeatures(awayTeam, fixture.id, new Date(fixture.kickoff_time)),
      ]);

      await Promise.all([
        saveTeamInjuryFeatures(homeFeatures, fixture.id, new Date(fixture.kickoff_time)),
        saveTeamInjuryFeatures(awayFeatures, fixture.id, new Date(fixture.kickoff_time)),
      ]);

      // Compute and save fixture features
      const fixtureFeatures = await computeFixtureInjuryFeatures(
        fixture.id,
        homeTeam,
        awayTeam,
        new Date(fixture.kickoff_time)
      );

      await saveFixtureInjuryFeatures(fixtureFeatures);

      // Create historical snapshot
      await createInjurySnapshot(
        fixture.id,
        new Date(fixture.kickoff_time),
        homeTeam,
        awayTeam
      );

      processed++;
    } catch (err) {
      console.error(`Error processing fixture ${fixture.id}:`, err);
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Get injury features for prediction (with leakage prevention)
 */
export async function getInjuryFeaturesForPrediction(
  fixtureId: string,
  predictionTime: Date
): Promise<FixtureInjuryFeatures | null> {
  // Get fixture details
  const { data: fixture, error } = await supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name)
    `)
    .eq("id", fixtureId)
    .single();

  if (error || !fixture) {
    return null;
  }

  const homeTeam = (fixture.home_team as unknown as { canonical_name: string })?.canonical_name;
  const awayTeam = (fixture.away_team as unknown as { canonical_name: string })?.canonical_name;

  if (!homeTeam || !awayTeam) {
    return null;
  }

  // Get features computed BEFORE prediction time (leakage prevention)
  const { data: homeFeature } = await supabaseAdmin
    .from("team_injury_features" as any)
    .select("*")
    .eq("team_name", homeTeam)
    .eq("fixture_id", fixtureId)
    .lte("snapshot_date", predictionTime.toISOString())
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  const { data: awayFeature } = await supabaseAdmin
    .from("team_injury_features" as any)
    .select("*")
    .eq("team_name", awayTeam)
    .eq("fixture_id", fixtureId)
    .lte("snapshot_date", predictionTime.toISOString())
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  if (!homeFeature || !awayFeature) {
    return null;
  }

  // Convert database rows to feature objects
  const hf = homeFeature as any;
  const af = awayFeature as any;
  const homeFeatures: TeamInjuryFeatures = {
    team_name: hf.team_name,
    total_unavailable: hf.total_unavailable,
    injured_count: hf.injured_count,
    suspended_count: hf.suspended_count,
    doubtful_count: hf.doubtful_count,
    out_count: hf.out_count,
    availability_pct: hf.availability_pct,
    missing_starters: hf.missing_starters,
    missing_key_players: hf.missing_key_players,
    missing_goalkeeper: hf.missing_goalkeeper,
    missing_defenders: hf.missing_defenders,
    missing_midfielders: hf.missing_midfielders,
    missing_attackers: hf.missing_attackers,
    injury_impact_score: hf.injury_impact_score,
    key_player_impact: hf.key_player_impact,
    data_freshness_hours: hf.data_freshness_hours,
    source_count: hf.source_count,
    confidence_score: hf.confidence_score,
  };

  const awayFeatures: TeamInjuryFeatures = {
    team_name: af.team_name,
    total_unavailable: af.total_unavailable,
    injured_count: af.injured_count,
    suspended_count: af.suspended_count,
    doubtful_count: af.doubtful_count,
    out_count: af.out_count,
    availability_pct: af.availability_pct,
    missing_starters: af.missing_starters,
    missing_key_players: af.missing_key_players,
    missing_goalkeeper: af.missing_goalkeeper,
    missing_defenders: af.missing_defenders,
    missing_midfielders: af.missing_midfielders,
    missing_attackers: af.missing_attackers,
    injury_impact_score: af.injury_impact_score,
    key_player_impact: af.key_player_impact,
    data_freshness_hours: af.data_freshness_hours,
    source_count: af.source_count,
    confidence_score: af.confidence_score,
  };

  return {
    fixture_id: fixtureId,
    home_team: homeTeam,
    away_team: awayTeam,
    home_features: homeFeatures,
    away_features: awayFeatures,
    injury_difference: homeFeatures.injury_impact_score - awayFeatures.injury_impact_score,
    availability_difference: homeFeatures.availability_pct - awayFeatures.availability_pct,
    key_player_absence_difference: homeFeatures.missing_key_players - awayFeatures.missing_key_players,
    attacking_absence_difference: homeFeatures.missing_attackers - awayFeatures.missing_attackers,
    defensive_absence_difference:
      (homeFeatures.missing_defenders + (homeFeatures.missing_goalkeeper ? 1 : 0)) -
      (awayFeatures.missing_defenders + (awayFeatures.missing_goalkeeper ? 1 : 0)),
  };
}
