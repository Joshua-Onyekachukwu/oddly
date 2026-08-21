/**
 * Shared stats interface for landing page components.
 * All components that display stats should import this type.
 */
export interface LandingStats {
  totalLeagues: number;
  totalPredictions: number;
  totalRecommendations: number;
  avgAccuracy: number;
  totalFixturesToday: number;
  activeModels: number;
}

/**
 * Format a number for display on the landing page.
 * - 0 → "—"
 * - 1-999 → "N+"
 * - 1000+ → "Nk+"
 */
export function formatLandingNumber(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  return `${n}+`;
}

/**
 * Get the league count display string.
 * Returns "N+ leagues" or "—" if no data.
 */
export function leagueCount(stats: LandingStats): string {
  return stats.totalLeagues > 0 ? `${stats.totalLeagues}+` : "—";
}

/**
 * Get the accuracy display string.
 * Returns "N%" or "—" if no data.
 */
export function accuracyPercent(stats: LandingStats): string {
  return stats.avgAccuracy > 0 ? `${stats.avgAccuracy}%` : "—";
}
