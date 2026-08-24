/**
 * Centralized Observability Tracer
 * 
 * Tracks operations across the system:
 * - Request ID / correlation ID
 * - Timestamp
 * - Service
 * - Operation
 * - Duration
 * - Status
 * - Error
 * - Retry count
 * 
 * Usage:
 *   const trace = startTrace("settlement", "archive-prediction");
 *   try {
 *     await archivePrediction(pred);
 *     trace.complete({ archived: true });
 *   } catch (err) {
 *     trace.fail(err);
 *   }
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export interface TraceEvent {
  id: string;
  correlation_id: string;
  service: string;
  operation: string;
  status: "started" | "completed" | "failed" | "retrying";
  duration_ms?: number;
  error?: string;
  retry_count: number;
  metadata?: Record<string, any>;
  created_at: string;
}

// In-memory trace buffer (flushed periodically)
const traceBuffer: TraceEvent[] = [];
const BUFFER_SIZE = 50;
const FLUSH_INTERVAL = 30000; // 30 seconds

let flushTimer: NodeJS.Timeout | null = null;

function generateId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function flushTraces() {
  if (traceBuffer.length === 0) return;

  const batch = traceBuffer.splice(0, BUFFER_SIZE);
  try {
    // Store in CockroachDB (observability table)
    // For now, just log to console — can add table later
    for (const trace of batch) {
      if (trace.status === "failed") {
        console.error(`[TRACE] ${trace.service}/${trace.operation} FAILED: ${trace.error} (${trace.duration_ms}ms)`);
      }
    }
  } catch (err) {
    console.error("[TRACE] Flush failed:", err);
  }
}

function ensureFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flushTraces, FLUSH_INTERVAL);
}

export interface Trace {
  id: string;
  correlationId: string;
  service: string;
  operation: string;
  startTime: number;
  retryCount: number;
  metadata: Record<string, any>;

  complete(result?: Record<string, any>): void;
  fail(error: Error | string): void;
  retry(error: Error | string): Trace;
}

export function startTrace(
  service: string,
  operation: string,
  options: {
    correlationId?: string;
    retryCount?: number;
    metadata?: Record<string, any>;
  } = {}
): Trace {
  ensureFlushTimer();

  const id = generateId();
  const correlationId = options.correlationId || generateCorrelationId();
  const startTime = Date.now();

  const event: TraceEvent = {
    id,
    correlation_id: correlationId,
    service,
    operation,
    status: "started",
    retry_count: options.retryCount || 0,
    metadata: options.metadata,
    created_at: new Date().toISOString(),
  };

  traceBuffer.push(event);

  const trace: Trace = {
    id,
    correlationId,
    service,
    operation,
    startTime,
    retryCount: options.retryCount || 0,
    metadata: options.metadata || {},

    complete(result?: Record<string, any>) {
      const duration = Date.now() - startTime;
      traceBuffer.push({
        ...event,
        status: "completed",
        duration_ms: duration,
        metadata: { ...event.metadata, ...result },
      });
    },

    fail(error: Error | string) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : error;
      traceBuffer.push({
        ...event,
        status: "failed",
        duration_ms: duration,
        error: errorMsg,
      });
    },

    retry(error: Error | string) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : error;
      traceBuffer.push({
        ...event,
        status: "retrying",
        duration_ms: duration,
        error: errorMsg,
        retry_count: event.retry_count + 1,
      });
      return startTrace(service, operation, {
        correlationId,
        retryCount: event.retry_count + 1,
        metadata: event.metadata,
      });
    },
  };

  return trace;
}

/**
 * Profile a database query
 */
export async function profileQuery<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const trace = startTrace(service, operation);
  try {
    const result = await fn();
    trace.complete({ success: true });
    return result;
  } catch (err) {
    trace.fail(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    service: string;
    operation: string;
    maxRetries?: number;
    baseDelay?: number;
  }
): Promise<T> {
  const { service, operation, maxRetries = 3, baseDelay = 1000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const trace = startTrace(service, operation, {
      retryCount: attempt,
      metadata: { attempt, maxRetries },
    });

    try {
      const result = await fn();
      trace.complete({ attempt, success: true });
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxRetries) {
        trace.retry(lastError);
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        trace.fail(lastError);
      }
    }
  }

  throw lastError;
}

/**
 * Job tracker for background operations
 */
export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed" | "retrying";
  startTime?: string;
  endTime?: string;
  duration_ms?: number;
  worker?: string;
  dataset_version?: string;
  model_version?: string;
  error?: string;
  retry_count: number;
  metadata?: Record<string, any>;
}

const jobs = new Map<string, Job>();

export function startJob(type: string, metadata?: Record<string, any>): Job {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const job: Job = {
    id,
    type,
    status: "running",
    startTime: new Date().toISOString(),
    retry_count: 0,
    metadata,
  };
  jobs.set(id, job);
  return job;
}

export function completeJob(id: string, result?: Record<string, any>) {
  const job = jobs.get(id);
  if (job) {
    job.status = "completed";
    job.endTime = new Date().toISOString();
    job.duration_ms = new Date(job.endTime).getTime() - new Date(job.startTime!).getTime();
    job.metadata = { ...job.metadata, ...result };
  }
}

export function failJob(id: string, error: Error | string) {
  const job = jobs.get(id);
  if (job) {
    job.status = "failed";
    job.endTime = new Date().toISOString();
    job.duration_ms = new Date(job.endTime).getTime() - new Date(job.startTime!).getTime();
    job.error = error instanceof Error ? error.message : error;
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values()).sort(
    (a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime()
  );
}
