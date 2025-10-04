import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
  onRetry?: (attempt: number, error: any) => void | Promise<void>;
}

/**
 * Default retry configuration for Browserbase/external API calls
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 2000,
  maxDelayMs: 8000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  onRetry: async () => {}
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any, retryableStatuses: number[]): boolean {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }
  
  // Timeout errors
  if (error.name === 'TimeoutError' || error.message?.toLowerCase().includes('timeout')) {
    return true;
  }
  
  // HTTP status codes
  if (error.status && retryableStatuses.includes(error.status)) {
    return true;
  }
  
  // Response status
  if (error.response?.status && retryableStatuses.includes(error.response.status)) {
    return true;
  }
  
  return false;
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableStatuses)) {
        console.log(`[Retry] Non-retryable error on attempt ${attempt}:`, error.message);
        throw error;
      }
      
      // If this was the last attempt, throw the error
      if (attempt === opts.maxAttempts) {
        console.log(`[Retry] Max attempts (${opts.maxAttempts}) reached, giving up`);
        throw error;
      }
      
      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts.initialDelayMs, opts.maxDelayMs, opts.backoffMultiplier);
      console.log(`[Retry] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      
      // Call retry callback if provided
      if (opts.onRetry) {
        await opts.onRetry(attempt, error);
      }
      
      await sleep(delay);
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Log execution attempt to Supabase
 */
export async function logExecutionAttempt(
  supabase: SupabaseClient,
  params: {
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
    const { error } = await supabase.rpc('insert_execution_log', {
      p_correlation_id: params.correlationId,
      p_plan_id: params.planId || null,
      p_plan_execution_id: params.planExecutionId || null,
      p_mandate_id: params.mandateId || null,
      p_stage: params.stage,
      p_status: params.status,
      p_attempt: params.attempt,
      p_error_message: params.errorMessage || null,
      p_metadata: params.metadata || {}
    });

    if (error) {
      console.error('[Retry] Failed to log execution attempt:', error);
    }
  } catch (err) {
    // Don't throw - logging failures shouldn't break the main flow
    console.error('[Retry] Exception while logging execution attempt:', err);
  }
}

/**
 * Fetch latest execution logs for a correlation ID
 */
export async function getExecutionLogs(
  supabase: SupabaseClient,
  correlationId: string,
  limit: number = 10
): Promise<any[]> {
  const { data, error } = await supabase
    .from('execution_logs')
    .select('*')
    .eq('correlation_id', correlationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Retry] Failed to fetch execution logs:', error);
    return [];
  }

  return data || [];
}

/**
 * Get execution summary for console display
 */
export function formatExecutionSummary(logs: any[]): string {
  if (logs.length === 0) {
    return 'No execution logs found';
  }

  const summary = logs.map(log => {
    const timestamp = new Date(log.created_at).toISOString();
    const status = log.status.toUpperCase();
    const error = log.error_message ? ` - ${log.error_message}` : '';
    return `[${timestamp}] ${log.stage} (attempt ${log.attempt}): ${status}${error}`;
  }).join('\n');

  return `Execution Logs:\n${summary}`;
}
