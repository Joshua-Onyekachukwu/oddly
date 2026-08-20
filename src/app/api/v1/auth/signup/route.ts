/**
 * POST /api/v1/auth/signup
 * 
 * Register a new user account.
 * 
 * Body:
 *   - email: string (required)
 *   - password: string (required, min 8 chars)
 *   - fullName: string (required)
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
  conflict,
  internalError,
} from "@/lib/api/utils";
import { signupSchema, validateBody } from "@/lib/api/validation";

export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(signupSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { email, password, fullName } = validation.data;

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Sign up with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: fullName,
        },
      },
    });

    if (error) {
      if (error.message.includes("already registered")) {
        return conflict("An account with this email already exists");
      }
      return badRequest(error.message);
    }

    if (!data.user) {
      return internalError("User creation failed");
    }

    // If email confirmation is required
    if (!data.session) {
      return successResponse({
        message: "Account created. Please check your email to verify your account.",
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      });
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    return successResponse({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile?.role || "user",
        display_name: fullName,
      },
    });
  } catch (error) {
    console.error("POST /api/v1/auth/signup error:", error);
    return internalError();
  }
}
