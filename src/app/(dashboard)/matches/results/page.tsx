import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MatchesList } from "@/components/matches/MatchesList";
import { MatchesSkeleton } from "@/components/matches/MatchesSkeleton";

export const metadata: Metadata = {
  title: "Match Results",
  description: "View completed football match results and prediction accuracy.",
};

async function getResultFixtures() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select(`
      *,
      leagues (name, country, logo),
      home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo),
      predictions (id, market, selection, model_probability, confidence_lower, confidence_upper)
    `)
    .eq("status", "finished")
    .order("kickoff_time", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to fetch results:", error);
    return [];
  }

  return (fixtures || []).map((f: any) => ({
    ...f,
    home_team_name: f.home_team?.canonical_name || "TBD",
    away_team_name: f.away_team?.canonical_name || "TBD",
    home_team_logo: f.home_team?.logo || null,
    away_team_logo: f.away_team?.logo || null,
    league_logo: f.leagues?.logo || null,
  }));
}

async function ResultsContent() {
  const fixtures = await getResultFixtures();
  return <MatchesList fixtures={fixtures} />;
}

export default async function ResultsPage() {
  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Match Results
        </h1>
        <p className="text-[14px] text-gray-500">
          Completed fixtures and prediction accuracy tracking.
        </p>
      </div>
      <Suspense fallback={<MatchesSkeleton />}>
        <ResultsContent />
      </Suspense>
    </div>
  );
}
