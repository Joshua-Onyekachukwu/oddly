/**
 * POST /api/v1/auth/forgot-password
 * 
 * Send a password reset email.
 * Always returns success to prevent email enumeration.
 * 
 * Body:
 *   - email: string (required)
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  badRequest,
  internalError,
} from "@/lib/api/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return badRequest("Email is required");
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Always return success to prevent email enumeration
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/reset-password`,
    });

    // Log error but don't expose it
    if (error) {
      console.error("Password reset error:", error.message);
    }

    return successResponse({
      message: "If an account exists with that email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("POST /api/v1/auth/forgot-password error:", error);
    return internalError();
  }
}
