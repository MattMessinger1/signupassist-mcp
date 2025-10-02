/**
 * Safely converts any value to an ISO date string
 * @param value - Any date-like value (Date, string, number, etc.)
 * @returns ISO string or null if invalid
 */
export function toIsoStringSafe(value: any): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Normalizes all date fields in an object to ISO strings
 * @param obj - Object that may contain date fields
 * @param dateFields - Array of field names that should be normalized
 * @returns New object with normalized dates
 */
export function normalizeDates<T extends Record<string, any>>(
  obj: T,
  dateFields: string[]
): T {
  const normalized = { ...obj };
  
  for (const field of dateFields) {
    if (field in normalized) {
      normalized[field] = toIsoStringSafe(normalized[field]);
    }
  }
  
  return normalized;
}
