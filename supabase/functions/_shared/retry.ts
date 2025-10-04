import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { sanitizeError } from './errors.ts';

/**
 * Retry configuration with exponential backoff
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 2000,  // 2s
  maxDelayMs: 8000,      // 8s
  backoffMultiplier: 2
};

/**
 * Determine if an error is retryable (5xx, timeout, network)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status >= 500 && error.status < 600;
  }
  
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('econnreset') ||
           message.includes('network') ||
           message.includes('fetch failed');
  }
  
  return false;
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
    config.maxDelayMs
  );
  
  // Add jitter to prevent thundering herd
  const jitter = delay * 0.1 * Math.random();
  return delay + jitter;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context?: {
    correlationId?: string;
    planId?: string;
    stage?: string;
    onAttemptFailed?: (attempt: number, error: unknown) => Promise<void>;
  }
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      console.log(`[Retry] Attempt ${attempt}/${config.maxAttempts}${context?.stage ? ` for stage: ${context.stage}` : ''}`);
      
      const result = await fn();
      
      if (attempt > 1) {
        console.log(`[Retry] Success on attempt ${attempt}`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      const sanitized = sanitizeError(error);
      
      console.error(`[Retry] Attempt ${attempt}/${config.maxAttempts} failed:`, sanitized);
      
      // Call optional failure callback
      if (context?.onAttemptFailed) {
        await context.onAttemptFailed(attempt, error);
      }
      
      // Don't retry if not retryable or max attempts reached
      if (!isRetryableError(error) || attempt >= config.maxAttempts) {
        console.error(`[Retry] Giving up after ${attempt} attempts`);
        break;
      }
      
      // Wait before next attempt
      const delayMs = getBackoffDelay(attempt, config);
      console.log(`[Retry] Waiting ${delayMs}ms before retry...`);
      await sleep(delayMs);
    }
  }
  
  throw lastError;
}

/**
 * Log execution attempt to Supabase
 */
export async function logExecutionAttempt(
  supabaseUrl: string,
  supabaseServiceKey: string,
  payload: {
    correlationId: string;
    planId?: string;
    planExecutionId?: string;
    mandateId?: string;
    stage: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'timeout';
    attempt: number;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error } = await supabase.rpc('insert_execution_log', {
      p_correlation_id: payload.correlationId,
      p_plan_id: payload.planId || null,
      p_plan_execution_id: payload.planExecutionId || null,
      p_mandate_id: payload.mandateId || null,
      p_stage: payload.stage,
      p_status: payload.status,
      p_attempt: payload.attempt,
      p_error_message: payload.errorMessage || null,
      p_metadata: payload.metadata || {}
    });
    
    if (error) {
      console.error('[Retry] Failed to log execution attempt:', error);
    }
  } catch (err) {
    // Don't throw - logging failures shouldn't break the main flow
    console.error('[Retry] Exception while logging execution attempt:', err);
  }
}
