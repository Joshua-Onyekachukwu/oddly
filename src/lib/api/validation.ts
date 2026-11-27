import { z } from "zod";

// ── Common Schemas ──────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).optional(),
});

export const sortSchema = z.object({
  sortBy: z.string().default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const uuidParamsSchema = z.object({
  id: z.string().uuid("Invalid UUID"),
});

// ── Auth Schemas ────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(1, "Name is required").max(100),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ── Fixture Schemas ─────────────────────────────────────────────────

export const fixtureQuerySchema = paginationSchema.merge(sortSchema).extend({
  league: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z
    .enum(["scheduled", "live", "halftime", "finished", "postponed", "cancelled"])
    .optional(),
  search: z.string().max(100).optional(),
});

// ── Odds Schemas ────────────────────────────────────────────────────

export const oddsQuerySchema = z.object({
  fixture_id: z.string().uuid().optional(),
  market: z.enum(["h2h", "spreads", "totals"]).optional(),
  bookmaker: z.string().max(50).optional(),
});

// ── Prediction Schemas ──────────────────────────────────────────────

export const predictionQuerySchema = paginationSchema.extend({
  fixture_id: z.string().uuid().optional(),
  market: z.string().max(50).optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  recommended_only: z.coerce.boolean().optional(),
});

export const predictionCreateSchema = z.object({
  fixtureId: z.string().uuid("Invalid fixture ID"),
  forceRegenerate: z.boolean().default(false),
});

// ── AI Chat Schemas ─────────────────────────────────────────────────

export const aiChatSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(2000, "Message too long (max 2000 characters)")
    .trim(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      })
    )
    .max(20, "History too long (max 20 messages)")
    .default([]),
});

// ── Notification Schemas ────────────────────────────────────────────

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  unreadOnly: z.coerce.boolean().default(false),
});

export const notificationPostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_all_read") }),
  z.object({ action: z.literal("mark_read"), id: z.string().uuid() }),
  z.object({
    action: z.literal("create"),
    userId: z.string().uuid(),
    type: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(1000),
    data: z.record(z.unknown()).optional(),
  }),
]);

// ── Accumulator Schemas ─────────────────────────────────────────────

export const accumulatorQuerySchema = paginationSchema.extend({
  status: z.enum(["active", "won", "lost", "void"]).optional(),
});

export const accumulatorCreateSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  picks: z
    .array(
      z.object({
        fixture_id: z.string().uuid(),
        market: z.string().min(1).max(50),
        selection: z.string().min(1).max(50),
        odds: z.number().positive(),
      })
    )
    .min(2, "Accumulator needs at least 2 picks")
    .max(10, "Accumulator cannot exceed 10 picks"),
  stake: z.number().positive().optional(),
});

export const accumulatorUpdateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  status: z.enum(["active", "won", "lost", "void"]).optional(),
  stake: z.number().positive().optional(),
  strategy: z.enum(["conservative", "balanced", "aggressive", "longshot"]).optional(),
});

// ── User Bet Schemas ────────────────────────────────────────────────

export const userBetQuerySchema = paginationSchema.extend({
  status: z.enum(["pending", "won", "lost", "void"]).optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
});

export const userBetCreateSchema = z.object({
  recommendationId: z.string().uuid("Invalid recommendation ID"),
  market: z.string().min(1).max(50).trim(),
  selection: z.string().min(1).max(50).trim(),
  stake: z.number().positive("Stake must be positive"),
  odds: z.number().min(1, "Odds must be at least 1.0"),
  bookmaker: z.string().max(50).trim().optional(),
});

export const userBetUpdateSchema = z.object({
  status: z.enum(["won", "lost", "void"]),
});

// ── Favourites Schemas ──────────────────────────────────────────────

export const favouriteEntityTypeSchema = z.enum(["team", "league", "player"]);

export const favouriteCreateSchema = z.object({
  entity_type: favouriteEntityTypeSchema,
  entity_id: z.string().trim().min(1).max(200),
  entity_name: z.string().trim().max(200).optional(),
});

export const favouriteQuerySchema = z.object({
  entity_type: favouriteEntityTypeSchema.optional(),
  entity_id: z.string().trim().min(1).max(200).optional(),
});

export const favouriteDeleteSchema = favouriteQuerySchema.refine(
  (data) => data.entity_type !== undefined && data.entity_id !== undefined,
  { message: "Both entity_type and entity_id are required" }
);

// ── Admin Schemas ───────────────────────────────────────────────────

export const adminUserQuerySchema = paginationSchema.merge(sortSchema).extend({
  search: z.string().max(100).optional(),
  role: z.enum(["user", "admin"]).optional(),
  tier: z.enum(["free", "premium", "elite"]).optional(),
});

export const adminUserUpdateSchema = z
  .object({
    role: z.enum(["user", "admin"]).optional(),
    subscription_tier: z.enum(["free", "premium", "elite"]).optional(),
  })
  .refine((data) => data.role !== undefined || data.subscription_tier !== undefined, {
    message: "At least one field (role or subscription_tier) must be provided",
  });

export const announcementCreateSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  body: z.string().min(1).max(2000).trim(),
  target: z.enum(["all", "free", "premium", "elite"]).default("all"),
  is_active: z.boolean().default(true),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const announcementUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    body: z.string().min(1).max(2000).trim().optional(),
    target: z.enum(["all", "free", "premium", "elite"]).optional(),
    is_active: z.boolean().optional(),
    scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
    expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const leagueCreateSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  country: z.string().min(1).max(100).trim().optional(),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).optional(),
});

export const leagueUpdateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  country: z.string().min(1).max(100).trim().optional(),
  is_active: z.boolean().optional(),
  api_id: z.number().int().positive().optional(),
});

/**
 * Editable league_model_params fields. These are the tunable model
 * coefficients consumed by src/lib/models/ensemble.ts — everything else
 * on the row (accuracies, data_points, last_trained) is derived by the
 * training pipeline and must not be hand-edited.
 */
export const leagueModelParamsSchema = z
  .object({
    home_advantage: z.number().min(0).max(500).optional(),
    goal_expectancy: z.number().min(0).max(10).optional(),
    avg_goals: z.number().min(0).max(10).optional(),
    home_win_pct: z.number().min(0).max(100).optional(),
    draw_pct: z.number().min(0).max(100).optional(),
    avg_yellow: z.number().min(0).max(20).optional(),
    avg_corners: z.number().min(0).max(30).optional(),
    poisson_weight: z.number().min(0).max(10).optional(),
    elo_weight: z.number().min(0).max(10).optional(),
    regression_weight: z.number().min(0).max(10).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one model param must be provided",
  });

export type LeagueModelParamsUpdate = z.infer<typeof leagueModelParamsSchema>;

export const leagueAdminUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    country: z.string().min(1).max(100).trim().nullable().optional(),
    is_active: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    model_params: leagueModelParamsSchema.optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.country !== undefined ||
      data.is_active !== undefined ||
      data.priority !== undefined ||
      data.model_params !== undefined,
    { message: "At least one field must be provided" }
  );

// ── Scoring Config Schemas ──────────────────────────────────────────

export const scoringConfigUpdateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.number(),
  description: z.string().max(500).optional(),
});

// ── Prediction Accuracy Schema ──────────────────────────────────────

export const predictionAccuracySchema = z.object({
  fixture_id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  market: z.string().min(1).max(50),
  predicted_probability: z.number().min(0).max(1),
  actual_outcome: z.boolean(),
  confidence_tier: z.enum(["very_high", "high", "medium", "low"]),
  edge_at_capture: z.number(),
  odds_at_capture: z.number().positive(),
});

// ── Rollover Schemas ────────────────────────────────────────────────

export const rolloverCreateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  starting_stake: z.number().positive().default(10),
  target_days: z.number().int().min(7).max(365).default(30),
});

// ── Helper: Validate and return friendly errors ─────────────────────

export function validateQuery<T extends z.ZodType>(
  schema: T,
  searchParams: URLSearchParams
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  const result = schema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return { success: false, error: issues };
}

export function validateBody<T extends z.ZodType>(
  schema: T,
  body: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(body);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return { success: false, error: issues };
}
