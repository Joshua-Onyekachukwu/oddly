/**
 * Environment variable validation
 * Run once at startup to catch missing config before it causes runtime errors
 */

const requiredServerVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const optionalServerVars = [
  "THE_ODDS_API_KEY",
  "API_FOOTBALL_KEY",
  "VERCEL_CRON_SECRET",
  "INTERNAL_API_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_DEPLOY_KEY",
  ...Array.from({ length: 10 }, (_, i) => `NVIDIA_KEY_${i + 1}`),
] as const;

type EnvResult = {
  valid: boolean;
  missing: string[];
  warnings: string[];
};

export function validateEnv(): EnvResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const key of requiredServerVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Check optional but important vars
  const hasAnyNvidiaKey = Array.from({ length: 10 }, (_, i) =>
    process.env[`NVIDIA_KEY_${i + 1}`]
  ).some(Boolean);

  if (!hasAnyNvidiaKey) {
    warnings.push("No NVIDIA API keys configured — AI features will not work");
  }

  if (!process.env.THE_ODDS_API_KEY) {
    warnings.push("THE_ODDS_API_KEY not configured — odds sync will not work");
  }

  if (!process.env.API_FOOTBALL_KEY) {
    warnings.push("API_FOOTBALL_KEY not configured — fixture sync will not work");
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    warnings.push("NEXT_PUBLIC_CONVEX_URL not configured — real-time features disabled");
  }

  if (missing.length > 0) {
    console.error(`[ENV] Missing required environment variables: ${missing.join(", ")}`);
    console.error("[ENV] Set these in your .env.local file or Vercel dashboard");
  }

  if (warnings.length > 0) {
    console.warn(`[ENV] Warnings: ${warnings.join("; ")}`);
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Get NVIDIA API keys as an array
 */
export function getNvidiaKeys(): string[] {
  return Array.from({ length: 10 }, (_, i) => process.env[`NVIDIA_KEY_${i + 1}`] || "")
    .filter(Boolean);
}

/**
 * Check if a feature is available based on env config
 */
export function isFeatureAvailable(feature: "ai" | "odds" | "fixtures" | "convex"): boolean {
  switch (feature) {
    case "ai":
      return getNvidiaKeys().length > 0;
    case "odds":
      return !!process.env.THE_ODDS_API_KEY;
    case "fixtures":
      return !!process.env.API_FOOTBALL_KEY;
    case "convex":
      return !!process.env.NEXT_PUBLIC_CONVEX_URL;
  }
}
