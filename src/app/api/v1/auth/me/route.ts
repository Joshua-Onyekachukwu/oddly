/**
 * GET /api/v1/auth/me
 * 
 * Get the current authenticated user's profile.
 * Requires authentication (Bearer token).
 * 
 * Returns:
 *   - user: { id, email, role, full_name, avatar_url, created_at }
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  unauthorized,
  internalError,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return unauthorized("Authentication required");
    }

    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return unauthorized("Invalid or expired token");
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    return successResponse({
      id: user.id,
      email: user.email,
      role: profile?.role || "user",
      display_name: profile?.display_name || null,
      subscription_tier: profile?.subscription_tier || "free",
      bankroll: profile?.bankroll || 0,
      created_at: profile?.created_at || user.created_at,
    });
  } catch (error) {
    console.error("GET /api/v1/auth/me error:", error);
    return internalError();
  }
}
