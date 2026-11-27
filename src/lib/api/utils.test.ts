/**
 * Tests for src/lib/api/utils.ts — auth boundaries (requireAuth /
 * requireAdmin / authenticate) plus the pure response & pagination helpers.
 *
 * @supabase/supabase-js is mocked so authenticate() never hits the network;
 * the mock client's auth.getUser / from().single() results are controlled
 * per-test via mockAuthState.
 */

const mockAuthState: {
  getUserResult: { data: { user: any }; error: any };
  profileResult: { data: any; error: any };
} = {
  getUserResult: { data: { user: null }, error: null },
  profileResult: { data: null, error: null },
};

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn(async () => mockAuthState.getUserResult) },
    from: jest.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => mockAuthState.profileResult,
        }),
      }),
    })),
  })),
}));

import { NextRequest } from "next/server";
import {
  AuthError,
  addRateLimitHeaders,
  authenticate,
  badRequest,
  buildPaginationMeta,
  checkRateLimit,
  forbidden,
  internalError,
  notFound,
  parseFilters,
  parsePagination,
  requireAdmin,
  requireAuth,
  successResponse,
  tooManyRequests,
  unauthorized,
  unprocessable,
} from "./utils";

function req(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthState.getUserResult = { data: { user: null }, error: null };
  mockAuthState.profileResult = { data: null, error: null };
});

// ─── authenticate / requireAuth ────────────────────────────────────────

describe("authenticate", () => {
  test("no Authorization header → null user (no supabase call needed)", async () => {
    const { user, supabase } = await authenticate(req());
    expect(user).toBeNull();
    expect(supabase).toBeNull();
  });

  test("non-Bearer scheme → null user", async () => {
    const { user } = await authenticate(req({ authorization: "Basic abc" }));
    expect(user).toBeNull();
  });

  test("Bearer token rejected by supabase.auth.getUser → null user", async () => {
    mockAuthState.getUserResult = {
      data: { user: null },
      error: { message: "invalid JWT" },
    };
    const { user } = await authenticate(req({ authorization: "Bearer bad-token" }));
    expect(user).toBeNull();
  });

  test("valid token + profile → user with role from profiles table", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "u1", email: "a@b.c" } },
      error: null,
    };
    mockAuthState.profileResult = { data: { role: "admin" }, error: null };
    const { user } = await authenticate(req({ authorization: "Bearer good" }));
    expect(user).toEqual({ id: "u1", email: "a@b.c", role: "admin" });
  });

  test("valid token + missing profile → defaults to role 'user'", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "u2", email: null } },
      error: null,
    };
    mockAuthState.profileResult = { data: null, error: { message: "not found" } };
    const { user } = await authenticate(req({ authorization: "Bearer good" }));
    expect(user.role).toBe("user");
    expect(user.email).toBe("");
  });
});

describe("requireAuth", () => {
  test("missing token throws AuthError 401 UNAUTHORIZED", async () => {
    await expect(requireAuth(req())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  test("invalid token throws AuthError 401", async () => {
    mockAuthState.getUserResult = { data: { user: null }, error: { message: "bad" } };
    await expect(
      requireAuth(req({ authorization: "Bearer nope" }))
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  test("valid token returns { user, supabase }", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "u1", email: "x@y.z" } },
      error: null,
    };
    const res = await requireAuth(req({ authorization: "Bearer ok" }));
    expect(res.user.id).toBe("u1");
    expect(res.supabase).toBeTruthy();
  });
});

describe("requireAdmin", () => {
  test("non-admin user throws AuthError 403 FORBIDDEN", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "u1", email: "u@x.y" } },
      error: null,
    };
    mockAuthState.profileResult = { data: { role: "user" }, error: null };
    await expect(
      requireAdmin(req({ authorization: "Bearer ok" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  test("missing profile (role defaults to user) → 403", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "u1", email: "u@x.y" } },
      error: null,
    };
    mockAuthState.profileResult = { data: null, error: null };
    await expect(
      requireAdmin(req({ authorization: "Bearer ok" }))
    ).rejects.toMatchObject({ status: 403 });
  });

  test("admin role passes", async () => {
    mockAuthState.getUserResult = {
      data: { user: { id: "a1", email: "admin@x.y" } },
      error: null,
    };
    mockAuthState.profileResult = { data: { role: "admin" }, error: null };
    const res = await requireAdmin(req({ authorization: "Bearer ok" }));
    expect(res.user.role).toBe("admin");
  });

  test("unauthenticated → 401 before role check", async () => {
    await expect(requireAdmin(req())).rejects.toMatchObject({ status: 401 });
  });
});

// ─── Response helpers ──────────────────────────────────────────────────

describe("response builders", () => {
  test("errorResponse shape: success:false, code, timestamp, path", async () => {
    const res = unauthorized("nope");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("nope");
    expect(body.timestamp).toBeTruthy();
  });

  test("standard error helpers map to expected status codes", async () => {
    expect(badRequest("bad").status).toBe(400);
    expect(forbidden().status).toBe(403);
    expect(notFound("Fixture").status).toBe(404);
    expect(tooManyRequests().status).toBe(429);
    expect(internalError().status).toBe(500);
    expect(unprocessable("bad entity").status).toBe(422);
  });

  test("notFound interpolates the resource name", async () => {
    const body = await notFound("Pick").json();
    expect(body.error.message).toBe("Pick not found");
  });

  test("successResponse wraps data with success:true", async () => {
    const res = successResponse({ hello: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { hello: 1 } });
  });
});

// ─── Pagination ────────────────────────────────────────────────────────

describe("parsePagination / buildPaginationMeta", () => {
  test("defaults: page 1, pageSize 20, offset 0", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
    });
  });

  test("page & pageSize parsed; offset = (page-1)*pageSize", () => {
    expect(parsePagination(new URLSearchParams("page=3&pageSize=10"))).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
    });
  });

  test("clamps: page >= 1, pageSize in [1,100]", () => {
    expect(parsePagination(new URLSearchParams("page=0&pageSize=500"))).toEqual({
      page: 1,
      pageSize: 100,
      offset: 0,
    });
    expect(parsePagination(new URLSearchParams("page=-4&pageSize=-2"))).toEqual({
      page: 1,
      pageSize: 1,
      offset: 0,
    });
    // Non-numeric input falls back to defaults rather than propagating NaN.
    expect(parsePagination(new URLSearchParams("page=abc&pageSize=xyz"))).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
    });
  });

  test("buildPaginationMeta computes totals/flags", () => {
    expect(buildPaginationMeta(2, 10, 95)).toEqual({
      page: 2,
      pageSize: 10,
      total: 95,
      totalPages: 10,
      hasNext: true,
      hasPrev: true,
    });
    expect(buildPaginationMeta(1, 10, 5).hasNext).toBe(false);
    expect(buildPaginationMeta(1, 10, 5).hasPrev).toBe(false);
  });
});

// ─── Rate limiting ─────────────────────────────────────────────────────

describe("checkRateLimit (sliding window)", () => {
  test("allows up to limit then denies within window", () => {
    const key = `test-${Date.now()}-a`;
    const r1 = checkRateLimit(key, null, 2, 60000);
    const r2 = checkRateLimit(key, null, 2, 60000);
    const r3 = checkRateLimit(key, null, 2, 60000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetAt).toBeGreaterThan(Date.now());
  });

  test("per-IP keys are isolated via x-forwarded-for", () => {
    const key = `test-${Date.now()}-b`;
    const ipA = req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    const ipB = req({ "x-forwarded-for": "9.9.9.9" });
    // Exhaust IP A's budget
    checkRateLimit(key, ipA, 1, 60000);
    expect(checkRateLimit(key, ipA, 1, 60000).allowed).toBe(false);
    // IP B unaffected (first IP in x-forwarded-for is used)
    expect(checkRateLimit(key, ipB, 1, 60000).allowed).toBe(true);
  });

  test("addRateLimitHeaders sets X-RateLimit-* headers", () => {
    const res = successResponse({ ok: true });
    addRateLimitHeaders(res, 42, 1700000000000);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("42");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("1700000000");
  });
});

// ─── Misc helpers ──────────────────────────────────────────────────────

describe("parseFilters", () => {
  test("extracts known params with defaults", () => {
    const f = parseFilters(new URLSearchParams("league=epl&status=live&sortOrder=asc"));
    expect(f.league).toBe("epl");
    expect(f.status).toBe("live");
    expect(f.sortBy).toBe("created_at");
    expect(f.sortOrder).toBe("asc");
    expect(f.search).toBeUndefined();
  });
});
