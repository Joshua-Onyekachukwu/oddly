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

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  badRequest,
  unauthorized,
  internalError,
} from "@/lib/api/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return badRequest("Email and password are required");
    }

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
