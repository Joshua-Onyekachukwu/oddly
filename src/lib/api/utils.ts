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
// Rate Limiting (in-memory, per-key)
// ==========================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit: number = 60,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count++;
  return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt };
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
