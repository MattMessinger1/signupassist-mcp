import { describe, it, expect } from 'https://deno.land/std@0.203.0/testing/bdd.ts';
import {
  humanizeFieldName,
  allPassed,
  anyFailed,
  isChecking,
  getCheckSummary,
} from '../src/components/discovery/useDiscoveryHelpers.ts';
import type { PrerequisiteCheck } from '../src/components/discovery/useDiscoveryHelpers.ts';

describe('useDiscoveryHelpers', () => {
  describe('humanizeFieldName', () => {
    it('converts snake_case to Title Case', () => {
      expect(humanizeFieldName('membership_current')).toBe('Membership Current');
      expect(humanizeFieldName('account_active')).toBe('Account Active');
      expect(humanizeFieldName('payment_method')).toBe('Payment Method');
    });

    it('handles single word', () => {
      expect(humanizeFieldName('account')).toBe('Account');
    });

    it('handles empty string', () => {
      expect(humanizeFieldName('')).toBe('');
    });

    it('handles multiple underscores', () => {
      expect(humanizeFieldName('emergency_contact_phone_number')).toBe(
        'Emergency Contact Phone Number'
      );
    });
  });

  describe('allPassed', () => {
    it('returns true when all checks pass', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'pass' },
      ];
      expect(allPassed(checks)).toBe(true);
    });

    it('returns false when any check fails', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'fail' },
      ];
      expect(allPassed(checks)).toBe(false);
    });

    it('returns false when any check is unknown', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'unknown' },
      ];
      expect(allPassed(checks)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(allPassed([])).toBe(false);
    });
  });

  describe('anyFailed', () => {
    it('returns true when any check fails', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'fail' },
      ];
      expect(anyFailed(checks)).toBe(true);
    });

    it('returns false when all checks pass', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'pass' },
      ];
      expect(anyFailed(checks)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(anyFailed([])).toBe(false);
    });
  });

  describe('isChecking', () => {
    it('returns true when any check is unknown', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'unknown' },
      ];
      expect(isChecking(checks)).toBe(true);
    });

    it('returns false when all checks are resolved', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'fail' },
      ];
      expect(isChecking(checks)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(isChecking([])).toBe(false);
    });
  });

  describe('getCheckSummary', () => {
    it('returns correct summary for mixed statuses', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'fail' },
        { check: 'payment', status: 'unknown' },
      ];

      const summary = getCheckSummary(checks);

      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.unknown).toBe(1);
      expect(summary.allPassed).toBe(false);
      expect(summary.anyFailed).toBe(true);
      expect(summary.isChecking).toBe(true);
    });

    it('returns correct summary when all pass', () => {
      const checks: PrerequisiteCheck[] = [
        { check: 'account', status: 'pass' },
        { check: 'membership', status: 'pass' },
      ];

      const summary = getCheckSummary(checks);

      expect(summary.allPassed).toBe(true);
      expect(summary.anyFailed).toBe(false);
      expect(summary.isChecking).toBe(false);
    });

    it('handles empty array', () => {
      const summary = getCheckSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.passed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.unknown).toBe(0);
      expect(summary.allPassed).toBe(false);
    });
  });
});
