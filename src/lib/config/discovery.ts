/**
 * Discovery feature configuration
 * Controls v2 discovery features and timing constraints
 */

/**
 * Check if Discovery V2 is enabled
 * Reads from environment variable, defaults to true
 */
export function isDiscoveryV2Enabled(): boolean {
  const envValue = import.meta.env.VITE_DISCOVERY_V2_ENABLED;
  
  if (envValue === undefined || envValue === '') {
    return true; // default to enabled
  }
  
  if (typeof envValue === 'boolean') {
    return envValue;
  }
  
  // Handle string values
  const normalized = String(envValue).toLowerCase().trim();
  return normalized === 'true' || normalized === '1';
}

/**
 * Get maximum stage duration in seconds
 * Reads from environment variable, parses and clamps to 30-120s range
 * Defaults to 60 seconds if not set or invalid
 */
export function getMaxStageSeconds(): number {
  const envValue = import.meta.env.VITE_DISCOVERY_MAX_STAGE_SECONDS;
  const defaultValue = 60;
  const minValue = 30;
  const maxValue = 120;
  
  // Return default if not set or empty
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  
  // Parse the value
  const parsed = typeof envValue === 'number' 
    ? envValue 
    : parseInt(String(envValue), 10);
  
  // Return default if invalid
  if (isNaN(parsed)) {
    return defaultValue;
  }
  
  // Clamp to valid range
  return Math.max(minValue, Math.min(maxValue, parsed));
}

/**
 * Export configuration object for convenience
 */
export const discoveryConfig = {
  isV2Enabled: isDiscoveryV2Enabled,
  getMaxStageSeconds: getMaxStageSeconds,
} as const;
