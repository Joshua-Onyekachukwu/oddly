/**
 * POST /api/v1/auth/login
 * 
 * Authenticate a user with email and password.
 * 
 * Body:
 *   - email: string (required)
 *   - password: string (required)
 * 
 * Returns:
 *   - access_token: string
 *   - refresh_token: string
 *   - user: { id, email, role }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  badRequest,
  unauthorized,
  internalError,
} from "@/lib/api/utils";
import { loginSchema, validateBody } from "@/lib/api/validation";

export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(loginSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { email, password } = validation.data;

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return unauthorized(error.message);
    }

    // Fetch user profile with role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, display_name, bankroll")
      .eq("id", data.user.id)
      .single();

    return successResponse({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile?.role || "user",
        display_name: profile?.display_name || null,
        bankroll: profile?.bankroll || 0,
      },
    });
  } catch (error) {
    console.error("POST /api/v1/auth/login error:", error);
    return internalError();
  }
}
