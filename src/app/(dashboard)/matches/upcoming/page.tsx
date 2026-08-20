import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MatchesList } from "@/components/matches/MatchesList";
import { MatchesSkeleton } from "@/components/matches/MatchesSkeleton";

export const metadata: Metadata = {
  title: "Upcoming Matches",
  description: "View upcoming football matches with AI-powered predictions and value bet detection.",
};

async function getUpcomingFixtures() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const now = new Date().toISOString();

  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select(`
      *,
      leagues (name, country),
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      predictions (id, market, selection, model_probability, confidence_lower, confidence_upper)
    `)
    .gte("kickoff_time", now)
    .eq("status", "scheduled")
    .order("kickoff_time", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Failed to fetch upcoming fixtures:", error);
    return [];
  }

  return (fixtures || []).map((f: any) => ({
    ...f,
    home_team_name: f.home_team?.canonical_name || "TBD",
    away_team_name: f.away_team?.canonical_name || "TBD",
  }));
}

async function UpcomingContent() {
  const fixtures = await getUpcomingFixtures();
  return <MatchesList fixtures={fixtures} />;
}

export default async function UpcomingPage() {
  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Upcoming Matches
        </h1>
        <p className="text-[14px] text-gray-500">
          AI-powered predictions for upcoming fixtures across 100+ leagues.
        </p>
      </div>
      <Suspense fallback={<MatchesSkeleton />}>
        <UpcomingContent />
      </Suspense>
    </div>
  );
}
