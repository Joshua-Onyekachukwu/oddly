/**
 * Admin audit helper — writes to admin_activity_log via the
 * service-role client (the table's RLS only permits service_role).
 *
 * Non-blocking by design: failures are logged, never thrown, so an
 * audit write can never break the admin action it records.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function logAdminAction(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details: (details ?? null) as Json | null,
    });

    if (error) {
      console.error(
        `logAdminAction failed (${action} on ${targetType}/${targetId}):`,
        error.message
      );
    }
  } catch (err) {
    console.error(
      `logAdminAction threw (${action} on ${targetType}/${targetId}):`,
      err
    );
  }
}
