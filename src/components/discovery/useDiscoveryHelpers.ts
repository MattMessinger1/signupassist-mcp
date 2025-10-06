import { useMemo } from 'react';

export interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail' | 'unknown';
  message?: string;
}

/**
 * Humanizes a snake_case field name to Title Case
 * @example humanizeFieldName('membership_current') → 'Membership Current'
 */
export function humanizeFieldName(fieldName: string): string {
  if (!fieldName) return '';
  
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Checks if all prerequisite checks have passed
 * @param checks - Array of prerequisite checks
 * @returns true if all checks have 'pass' status
 */
export function allPassed(checks: PrerequisiteCheck[]): boolean {
  return checks.length > 0 && checks.every(check => check.status === 'pass');
}

/**
 * Checks if any prerequisite checks have failed
 * @param checks - Array of prerequisite checks
 * @returns true if any check has 'fail' status
 */
export function anyFailed(checks: PrerequisiteCheck[]): boolean {
  return checks.some(check => check.status === 'fail');
}

/**
 * Checks if any prerequisite checks are still being verified
 * @param checks - Array of prerequisite checks
 * @returns true if any check has 'unknown' status
 */
export function isChecking(checks: PrerequisiteCheck[]): boolean {
  return checks.some(check => check.status === 'unknown');
}

/**
 * Gets a summary of prerequisite check statuses
 * @param checks - Array of prerequisite checks
 */
export function getCheckSummary(checks: PrerequisiteCheck[]) {
  return {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    unknown: checks.filter(c => c.status === 'unknown').length,
    allPassed: allPassed(checks),
    anyFailed: anyFailed(checks),
    isChecking: isChecking(checks),
  };
}

/**
 * Custom hook for discovery helper functions
 */
export function useDiscoveryHelpers(checks: PrerequisiteCheck[] = []) {
  const summary = useMemo(() => getCheckSummary(checks), [checks]);

  return {
    humanizeFieldName,
    allPassed: summary.allPassed,
    anyFailed: summary.anyFailed,
    isChecking: summary.isChecking,
    summary,
  };
}
