import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { MatchDetail } from "@/components/matches/MatchDetail";
import { MatchDetailSkeleton } from "@/components/matches/MatchDetailSkeleton";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: fixture } = await supabase
    .from("fixtures")
    .select("kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), league:leagues(name)")
    .eq("id", id)
    .single();

  if (!fixture) return { title: "Match Not Found" };

  const homeTeam = (fixture.home_team as unknown as { canonical_name: string })?.canonical_name || "Home";
  const awayTeam = (fixture.away_team as unknown as { canonical_name: string })?.canonical_name || "Away";

  return {
    title: `${homeTeam} vs ${awayTeam}`,
    description: `Prediction details for ${homeTeam} vs ${awayTeam} on ${new Date(fixture.kickoff_time).toLocaleDateString()}`,
  };
}

async function MatchContent({ id }: { id: string }) {
  const supabase = await createClient();

  const { data: rawFixture, error } = await supabase
    .from("fixtures")
    .select(
      `
      *,
      leagues (id, name, country, logo),
      home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo),
      predictions (
        id, market, selection, model_probability, confidence_lower, confidence_upper,
        model_version, features_used, sub_model_probabilities, model_disagreement,
        result, created_at
      ),
      recommendations (
        id, market, selection, bookmaker_odds, model_probability, edge,
        opportunity_score, risk_tier, confidence_tier, kelly_fraction,
        is_recommended, is_avoid, explanation
      )
    `
    )
    .eq("id", id)
    .single();

  if (error || !rawFixture) {
    notFound();
  }

  // Transform to match MatchDetail expected interface
  const fixture = {
    ...rawFixture,
    home_team_name: (rawFixture.home_team as any)?.canonical_name || "TBD",
    away_team_name: (rawFixture.away_team as any)?.canonical_name || "TBD",
    home_team_logo: (rawFixture.home_team as any)?.logo || null,
    away_team_logo: (rawFixture.away_team as any)?.logo || null,
    league_logo: (rawFixture.leagues as any)?.logo || null,
  } as any;

  // Fetch odds for this fixture
  const { data: odds } = await supabase
    .from("odds_snapshots")
    .select("*")
    .eq("fixture_id", id)
    .order("snapshot_time", { ascending: false })
    .limit(50);

  return <MatchDetail fixture={fixture} odds={odds || []} />;
}

export default async function MatchDetailPage({ params }: Props) {
  const { id } = await params;

  return (
    <div>
      <div className="mb-[24px]">
        <a
          href="/matches"
          className="inline-flex items-center gap-[6px] text-[13px] text-gray-400 hover:text-[#1B2A4A] transition-colors mb-[8px]"
        >
          <i className="ri-arrow-left-line text-[14px]"></i>
          Back to matches
        </a>
      </div>

      <Suspense fallback={<MatchDetailSkeleton />}>
        <MatchContent id={id} />
      </Suspense>
    </div>
  );
}
