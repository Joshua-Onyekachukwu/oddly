/**
 * ODDLY Cron Execution Lock
 *
 * Database-backed distributed lock that prevents two instances of the same
 * cron from executing simultaneously. Uses PostgreSQL advisory-style locking
 * via the cron_locks table with lease-based stale lock recovery.
 *
 * Usage:
 *   const lock = await acquireLock('predict', 600);
 *   if (!lock) return; // Another instance is running
 *   try {
 *     await doWork();
 *   } finally {
 *     await releaseLock('predict', lock);
 *   }
 */

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/**
 * Try to acquire a cron execution lock.
 * Returns a lock_id string if successful, or null if another instance holds the lock.
 *
 * @param jobName - Unique cron identifier (e.g., 'predict', 'settle', 'pipeline')
 * @param leaseSeconds - How long the lock is valid before auto-expiring (default: 600s = 10min)
 */
export async function acquireLock(
  jobName: string,
  leaseSeconds: number = 600
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("acquire_cron_lock", {
      p_job_name: jobName,
      p_lease_seconds: leaseSeconds,
    });

    if (error) {
      console.error(`[LOCK] Failed to acquire lock for ${jobName}:`, error.message);
      // If the table doesn't exist yet, allow execution (graceful degradation)
      if (error.message?.includes("does not exist")) {
        console.warn(`[LOCK] cron_locks table missing — allowing ${jobName} without lock`);
        return `fallback_${jobName}_${Date.now()}`;
      }
      return null;
    }

    if (data) {
      console.log(`[LOCK] Acquired lock for ${jobName}: ${data}`);
      return data;
    }

    console.log(`[LOCK] Lock rejected for ${jobName} — another instance is running`);
    return null;
  } catch (err: any) {
    console.error(`[LOCK] Exception acquiring lock for ${jobName}:`, err.message);
    // Graceful degradation: if lock system is broken, allow execution
    return `fallback_${jobName}_${Date.now()}`;
  }
}

/**
 * Release a previously acquired lock.
 *
 * @param jobName - The cron identifier
 * @param lockId - The lock_id returned by acquireLock
 */
export async function releaseLock(
  jobName: string,
  lockId: string
): Promise<boolean> {
  // Don't release fallback locks
  if (lockId.startsWith("fallback_")) return true;

  try {
    const { data, error } = await supabaseAdmin.rpc("release_cron_lock", {
      p_job_name: jobName,
      p_lock_id: lockId,
    });

    if (error) {
      console.error(`[LOCK] Failed to release lock for ${jobName}:`, error.message);
      return false;
    }

    console.log(`[LOCK] Released lock for ${jobName}: ${data}`);
    return data === true;
  } catch (err: any) {
    console.error(`[LOCK] Exception releasing lock for ${jobName}:`, err.message);
    return false;
  }
}

/**
 * Higher-level wrapper: acquire lock, run work, release lock.
 * Handles all error cases and ensures lock is always released.
 *
 * @param jobName - Unique cron identifier
 * @param fn - The work to execute while holding the lock
 * @param options - Optional settings
 */
export async function withLock<T>(
  jobName: string,
  fn: () => Promise<T>,
  options: { leaseSeconds?: number; timeoutMs?: number } = {}
): Promise<{ acquired: boolean; result?: T; error?: string; durationMs: number }> {
  const { leaseSeconds = 600 } = options;
  const startTime = Date.now();

  const lockId = await acquireLock(jobName, leaseSeconds);
  if (!lockId) {
    return {
      acquired: false,
      error: "Lock held by another instance",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const result = await fn();
    await releaseLock(jobName, lockId);
    return {
      acquired: true,
      result,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    // Always release lock on error
    await releaseLock(jobName, lockId);
    return {
      acquired: true,
      error: err.message || "Unknown error",
      durationMs: Date.now() - startTime,
    };
  }
}
