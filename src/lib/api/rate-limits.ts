/**
 * ODDLY Rate Limit Configuration
 *
 * Central place for all API rate limits.
 * Prevents cost abuse on expensive AI/betting endpoints.
 */

export const RATE_LIMITS = {
  // AI Chat: questions per day by subscription tier
  aiChat: {
    free: 5,
    premium: 50,
    elite: -1, // unlimited
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Betting Agent: requests per minute (all tiers)
  bettingAgent: {
    recommendations: {
      limit: 10,
      windowMs: 60 * 1000, // 1 minute
    },
    betslip: {
      limit: 20,
      windowMs: 60 * 1000, // 1 minute
    },
    audit: {
      limit: 30,
      windowMs: 60 * 1000, // 1 minute
    },
  },

  // AI Monitor: requests per minute
  aiMonitor: {
    limit: 30,
    windowMs: 60 * 1000,
  },

  // General API: requests per minute per IP
  general: {
    limit: 120,
    windowMs: 60 * 1000,
  },
} as const;

/**
 * Get the user's IP address from request headers.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Build a rate limit key for a user-specific endpoint.
 */
export function userRateLimitKey(userId: string, endpoint: string): string {
  return `user:${userId}:${endpoint}`;
}

/**
 * Build a rate limit key for an IP-based endpoint.
 */
export function ipRateLimitKey(ip: string, endpoint: string): string {
  return `ip:${ip}:${endpoint}`;
}
