/**
 * Log Debouncer Utility
 * 
 * Reduces log noise by throttling repetitive log messages.
 * Tracks last emission time per key and only logs if threshold has passed.
 */

// Track last emission time for each log key
const lastEmission = new Map<string, number>();

/**
 * Log once per time interval
 * @param key - Unique identifier for this log message
 * @param ms - Minimum milliseconds between emissions
 * @param emit - Function to call when logging (e.g., () => console.log(...))
 * @returns true if logged, false if debounced
 */
export function logOncePer(key: string, ms: number, emit: () => void): boolean {
  const now = Date.now();
  const last = lastEmission.get(key);
  
  // Check if enough time has passed since last emission
  if (last && (now - last) < ms) {
    return false; // Debounced
  }
  
  // Update timestamp and emit
  lastEmission.set(key, now);
  emit();
  return true;
}

/**
 * Clear debounce state for a specific key
 * @param key - Key to clear
 */
export function clearDebounce(key: string): void {
  lastEmission.delete(key);
}

/**
 * Clear all debounce state (for testing/debugging)
 */
export function clearAllDebounce(): void {
  lastEmission.clear();
}

/**
 * Get time since last emission for a key
 * @param key - Key to check
 * @returns Milliseconds since last emission, or null if never emitted
 */
export function timeSinceLastEmission(key: string): number | null {
  const last = lastEmission.get(key);
  if (!last) return null;
  return Date.now() - last;
}

/**
 * Helper: Create a debounced logger function
 * @param key - Unique key for this logger
 * @param ms - Debounce interval
 * @returns Function that logs with debouncing
 * 
 * @example
 * const logRetry = debouncedLogger('extraction-retry', 5000);
 * // Later in a loop:
 * logRetry(() => console.log('Retrying extraction...'));
 */
export function debouncedLogger(key: string, ms: number) {
  return (emit: () => void) => logOncePer(key, ms, emit);
}
