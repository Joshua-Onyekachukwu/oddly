/**
 * ODDLY API Utilities
 * 
 * Shared helpers for all API routes:
 * - Consistent error responses
 * - Pagination helpers
 * - Auth middleware
 * - Rate limiting
 * - Request validation
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedSupabaseClient = SupabaseClient<Database>;

// ==========================================
// Response Types
// ==========================================

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: string;
  path: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

// ==========================================
// Response Builders
// ==========================================

/**
 * Build a successful response with data.
 */
export function successResponse<T>(
  data: T,
  meta?: PaginationMeta,
  status: number = 200
): NextResponse<ApiSuccessResponse<T>> {
  const body: ApiSuccessResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status });
}

/**
 * Build a created response (201).
 */
export function createdResponse<T>(data: T): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, undefined, 201);
}

/**
 * Build a no-content response (204).
 */
export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Build an error response.
 */
export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: Record<string, unknown>,
  path: string = ""
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, details },
      timestamp: new Date().toISOString(),
      path,
    },
    { status }
  );
}

// ==========================================
// Standard Error Responses
// ==========================================

export function badRequest(message: string, details?: Record<string, unknown>) {
  return errorResponse("BAD_REQUEST", message, 400, details);
}

export function unauthorized(message = "Authentication required") {
  return errorResponse("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "Insufficient permissions") {
  return errorResponse("FORBIDDEN", message, 403);
}

export function notFound(resource = "Resource") {
  return errorResponse("NOT_FOUND", `${resource} not found`, 404);
}

export function conflict(message: string) {
  return errorResponse("CONFLICT", message, 409);
}

export function unprocessable(message: string, details?: Record<string, unknown>) {
  return errorResponse("UNPROCESSABLE_ENTITY", message, 422, details);
}

export function tooManyRequests(message = "Rate limit exceeded, please try again later") {
  return errorResponse("RATE_LIMITED", message, 429);
}

export function internalError(message = "Internal server error") {
  return errorResponse("INTERNAL_ERROR", message, 500);
}

// ==========================================
// Pagination
// ==========================================

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Parse pagination parameters from URL search params.
 */
export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10))
  );
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
}

/**
 * Build pagination metadata.
 */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ==========================================
// Auth Middleware
// ==========================================

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

/**
 * Extract and verify the Supabase JWT from the Authorization header.
 * Returns the authenticated user or throws an appropriate error response.
 */
export async function authenticate(
  request: NextRequest
): Promise<{ user: AuthenticatedUser; supabase: TypedSupabaseClient }> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null as unknown as AuthenticatedUser, supabase: null as unknown as TypedSupabaseClient };
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null as unknown as AuthenticatedUser, supabase: null as unknown as TypedSupabaseClient };
  }

  // Fetch profile for role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return {
    user: {
      id: user.id,
      email: user.email || "",
      role: profile?.role || "user",
    },
    supabase,
  };
}

/**
 * Require authentication — returns user or sends 401.
 */
export async function requireAuth(request: NextRequest) {
  const { user, supabase } = await authenticate(request);
  if (!user) {
    throw new AuthError("UNAUTHORIZED", "Authentication required", 401);
  }
  return { user, supabase };
}

/**
 * Require admin role — returns user or sends 403.
 */
export async function requireAdmin(request: NextRequest) {
  const { user, supabase } = await requireAuth(request);
  if (user.role !== "admin") {
    throw new AuthError("FORBIDDEN", "Admin access required", 403);
  }
  return { user, supabase };
}

export class AuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ==========================================
// Rate Limiting (sliding window, per-IP)
// ==========================================

/**
 * Extract client IP from standard proxy headers.
 * Works with Vercel, Cloudflare, nginx, and direct connections.
 */
function getClientIp(request: NextRequest): string {
  // x-forwarded-for: first IP is the original client
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  // x-real-ip: set by nginx/cloudflare
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  // fallback
  return "127.0.0.1";
}

/**
 * Sliding window log rate limiter.
 * Stores timestamps of requests and counts those within the window.
 * More accurate than fixed-window: no burst at window boundaries.
 */
const slidingWindowStore = new Map<string, number[]>();

// Periodic cleanup to prevent memory leaks (every 5 min)
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, timestamps] of slidingWindowStore) {
    // Remove entries older than max window (10 min safety net)
    const cutoff = now - 10 * 60 * 1000;
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      slidingWindowStore.delete(key);
    } else {
      slidingWindowStore.set(key, filtered);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  windowMs: number;
}

/**
 * Check rate limit using a sliding window log algorithm.
 *
 * @param key - Route identifier (e.g. "stats", "fixtures")
 * @param request - NextRequest to extract client IP
 * @param limit - Max requests per window (default 60)
 * @param windowMs - Window duration in ms (default 60000)
 * @returns Rate limit result with allowed, remaining, resetAt
 */
export function checkRateLimit(
  key: string,
  request: NextRequest | null,
  limit: number = 60,
  windowMs: number = 60000
): RateLimitResult {
  const now = Date.now();
  cleanupExpiredEntries();

  // Build composite key: route + IP (or user-provided key)
  const ip = request ? getClientIp(request) : "no-request";
  const compositeKey = `${ip}:${key}`;

  // Get or create timestamp array
  let timestamps = slidingWindowStore.get(compositeKey);
  if (!timestamps) {
    timestamps = [];
    slidingWindowStore.set(compositeKey, timestamps);
  }

  // Remove timestamps outside the window
  const windowStart = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= windowStart) {
    timestamps.shift();
  }

  // Check if under limit
  if (timestamps.length >= limit) {
    // Rate limited — resetAt is when the oldest request in window expires
    const resetAt = timestamps[0] + windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      limit,
      windowMs,
    };
  }

  // Allowed — record this request
  timestamps.push(now);
  const remaining = limit - timestamps.length;
  const resetAt = timestamps[0] + windowMs;

  return {
    allowed: true,
    remaining,
    resetAt,
    limit,
    windowMs,
  };
}

/**
 * Add rate limit headers to a response.
 */
export function addRateLimitHeaders(
  response: NextResponse,
  remaining: number,
  resetAt: number
): NextResponse {
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  return response;
}

// ==========================================
// Query Param Helpers
// ==========================================

/**
 * Extract common filter params from search params.
 */
export function parseFilters(searchParams: URLSearchParams) {
  return {
    search: searchParams.get("search") || undefined,
    league: searchParams.get("league") || undefined,
    status: searchParams.get("status") || undefined,
    date: searchParams.get("date") || undefined,
    sortBy: searchParams.get("sortBy") || "created_at",
    sortOrder: (searchParams.get("sortOrder") || "desc") as "asc" | "desc",
  };
}

/**
 * Safe JSON parse with default.
 */
export async function safeJsonParse<T>(request: NextRequest, defaultValue: T): Promise<T> {
  try {
    const body = await request.json();
    return body as T;
  } catch {
    return defaultValue;
  }
}
