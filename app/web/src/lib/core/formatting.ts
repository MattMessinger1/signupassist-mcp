/**
 * Formatting Utilities
 * Pure functions for consistent data formatting
 */

/**
 * Format cents to currency string
 */
export function formatMoney(cents: number, currency = 'USD'): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency });
}

/**
 * Format cents to currency string with explicit locale
 */
export function formatMoneyWithLocale(
  cents: number,
  locale: string,
  currency = 'USD'
): string {
  return (cents / 100).toLocaleString(locale, { style: 'currency', currency });
}

/**
 * Format date with default options
 */
export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(undefined, options);
}

/**
 * Format date and time
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format date with full style (e.g., "Saturday, January 1, 2025 at 9:00 AM")
 */
export function formatDateTimeFull(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(d);
}

/**
 * Format relative time (e.g., "in 2 days", "3 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffMins) < 60) {
    return diffMins >= 0 ? `in ${diffMins} minutes` : `${Math.abs(diffMins)} minutes ago`;
  }
  if (Math.abs(diffHours) < 24) {
    return diffHours >= 0 ? `in ${diffHours} hours` : `${Math.abs(diffHours)} hours ago`;
  }
  return diffDays >= 0 ? `in ${diffDays} days` : `${Math.abs(diffDays)} days ago`;
}

/**
 * Format phone number for display
 */
export function formatPhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone; // Return as-is if format unknown
}

/**
 * Format name to title case
 */
export function formatName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
