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

// ── Fixture Schemas ─────────────────────────────────────────────────

export const fixtureQuerySchema = paginationSchema.merge(sortSchema).extend({
  league: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z
    .enum(["NS", "1H", "HT", "2H", "FT", "PST", "TBD"])
    .optional(),
  search: z.string().max(100).optional(),
});

export const fixtureParamsSchema = z.object({
  id: z.string().uuid("Invalid fixture ID"),
});

// ── Odds Schemas ────────────────────────────────────────────────────

export const oddsQuerySchema = z.object({
  fixture_id: z.string().uuid().optional(),
  market: z
    .enum(["h2h", "spreads", "totals"])
    .optional(),
  bookmaker: z.string().max(50).optional(),
});

// ── Prediction Schemas ──────────────────────────────────────────────

export const predictionQuerySchema = paginationSchema.extend({
  fixture_id: z.string().uuid().optional(),
  market: z.string().max(50).optional(),
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  recommended_only: z.coerce.boolean().optional(),
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

// ── Bet Tracking Schemas ────────────────────────────────────────────

export const userBetQuerySchema = paginationSchema.extend({
  status: z.enum(["pending", "won", "lost", "void"]).optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
});

export const userBetCreateSchema = z.object({
  fixture_id: z.string().uuid(),
  market: z.string().min(1).max(50),
  selection: z.string().min(1).max(50),
  odds: z.number().positive(),
  stake: z.number().positive(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().max(500).optional(),
});

// ── Admin Schemas ───────────────────────────────────────────────────

export const adminUserQuerySchema = paginationSchema.merge(sortSchema).extend({
  search: z.string().max(100).optional(),
  role: z.enum(["user", "admin"]).optional(),
  tier: z.enum(["free", "premium", "elite"]).optional(),
});

export const announcementCreateSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  body: z.string().min(1).max(2000).trim(),
  type: z.enum(["info", "warning", "update", "maintenance"]).default("info"),
  is_active: z.boolean().default(true),
});

export const leagueUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
  api_id: z.number().int().positive().optional(),
});

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
