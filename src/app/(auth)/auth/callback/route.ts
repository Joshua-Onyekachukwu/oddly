/**
 * /auth/callback
 *
 * Handles Supabase auth redirects:
 * - Email verification (signup confirmation)
 * - Password reset flow
 * - OAuth callbacks
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/matches";

  if (code) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            supabaseResponse = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              supabaseResponse.cookies.set(name, value, options as any);
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this is a password reset — redirect to settings
      const isPasswordReset = searchParams.get("type") === "recovery";
      if (isPasswordReset) {
        return NextResponse.redirect(`${origin}/settings`);
      }

      // Otherwise redirect to the intended destination
      const safeRedirect = next.startsWith("/") ? next : "/matches";
      return NextResponse.redirect(`${origin}${safeRedirect}`);
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
