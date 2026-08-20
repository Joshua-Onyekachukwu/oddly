import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MatchesList } from "@/components/matches/MatchesList";
import { MatchesSkeleton } from "@/components/matches/MatchesSkeleton";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Today's Matches",
  description:
    "View today's football matches with AI-powered predictions, value bet detection, and live odds across 100+ leagues.",
};

async function getTodayFixtures() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const today = new Date().toISOString().split("T")[0];

  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select(
      `
      *,
      leagues (name, country),
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      predictions (id, market, selection, model_probability, confidence_lower, confidence_upper)
    `
    )
    .gte("kickoff_time", `${today}T00:00:00Z`)
    .lte("kickoff_time", `${today}T23:59:59Z`)
    .order("kickoff_time", { ascending: true });

  if (error) {
    console.error("Failed to fetch fixtures:", error);
    return [];
  }

  // Transform to match the expected Fixture interface
  return (fixtures || []).map((f: any) => ({
    ...f,
    home_team_name: (f.home_team as any)?.canonical_name || "TBD",
    away_team_name: (f.away_team as any)?.canonical_name || "TBD",
  }));
}

async function MatchesContent() {
  const fixtures = await getTodayFixtures();

  return <MatchesList fixtures={fixtures} />;
}

export default async function MatchesPage() {
  return (
    <div>
      <PageHeader
        title="Today's Matches"
        description="AI-powered predictions for today's fixtures across 100+ leagues."
      />

      <Suspense fallback={<MatchesSkeleton />}>
        <MatchesContent />
      </Suspense>
    </div>
  );
}
