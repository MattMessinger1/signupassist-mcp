/**
 * Single-Flight Guard
 * Ensures at most one instance of a given operation runs at a time
 * Prevents duplicate login calls for the same user+org
 */

const inflight = new Map<string, Promise<any>>();

/**
 * Execute a function with single-flight guarantee
 * If the same key is already in-flight, returns the existing promise
 * Otherwise, executes the function and tracks it until completion
 * 
 * @param key - Unique identifier for the operation (e.g., "login:user123:blackhawk")
 * @param fn - Async function to execute
 * @returns Promise resolving to the function's result
 */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    console.log(`[SingleFlight] ⏳ Reusing in-flight request: ${key}`);
    return existing as Promise<T>;
  }
  
  console.log(`[SingleFlight] ▶️ Starting new request: ${key}`);
  const promise = fn().finally(() => {
    inflight.delete(key);
    console.log(`[SingleFlight] ✅ Completed: ${key}`);
  });
  
  inflight.set(key, promise);
  return promise;
}

/**
 * Check if an operation is currently in-flight
 * @param key - Operation key to check
 * @returns true if the operation is currently running
 */
export function isInFlight(key: string): boolean {
  return inflight.has(key);
}

/**
 * Clear all in-flight operations (useful for testing or cleanup)
 */
export function clearAllInflight(): void {
  inflight.clear();
}
