/**
 * Unit tests for SkiClubPro provider
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { 
  scpLogin, 
  scpFindPrograms, 
  scpRegister, 
  scpPay, 
  captureEvidence,
  Program 
} from '../providers/skiclubpro';

// Mock the mandate verification and audit middleware
jest.mock('../lib/mandates', () => ({
  verifyMandate: jest.fn().mockResolvedValue({ verified: true })
}));

jest.mock('../middleware/audit', () => ({
  auditToolCall: jest.fn().mockImplementation(async (context, fn) => {
    return await fn();
  }),
  logEvidence: jest.fn().mockResolvedValue(undefined)
}));

const { verifyMandate } = require('../lib/mandates');
const { auditToolCall, logEvidence } = require('../middleware/audit');

describe('SkiClubPro Provider', () => {
  const baseArgs = {
    mandate_id: 'test-mandate-123',
    plan_execution_id: 'test-execution-456'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scp.login', () => {
    it('should successfully login and return session ref', async () => {
      const args = {
        ...baseArgs,
        credential_alias: 'blackhawk-parent-login'
      };

      const result = await scpLogin(args);

      expect(result.session_ref).toMatch(/^session_[0-9a-f-]+$/);
      expect(verifyMandate).toHaveBeenCalledWith(args.mandate_id, 'scp:login');
      expect(auditToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_execution_id: args.plan_execution_id,
          mandate_id: args.mandate_id,
          tool: 'scp.login'
        }),
        expect.any(Function)
      );
    });

    it('should fail if mandate verification fails', async () => {
      verifyMandate.mockRejectedValueOnce(new Error('Invalid mandate'));

      const args = {
        ...baseArgs,
        credential_alias: 'blackhawk-parent-login'
      };

      await expect(scpLogin(args)).rejects.toThrow('Invalid mandate');
    });
  });

  describe('scp.find_programs', () => {
    it('should return all programs when no query provided', async () => {
      const args = {
        ...baseArgs,
        org_ref: 'blackhawk'
      };

      const result = await scpFindPrograms(args);

      expect(result.programs).toHaveLength(3);
      expect(result.programs[0]).toMatchObject({
        program_ref: 'blackhawk-2024-winter',
        title: 'Blackhawk Winter Program 2024',
        opens_at: '2024-12-01T09:00:00Z'
      });
      expect(verifyMandate).toHaveBeenCalledWith(args.mandate_id, 'scp:login');
    });

    it('should filter programs by query', async () => {
      const args = {
        ...baseArgs,
        org_ref: 'blackhawk',
        query: 'winter'
      };

      const result = await scpFindPrograms(args);

      expect(result.programs).toHaveLength(1);
      expect(result.programs[0].title).toContain('Winter');
    });

    it('should return empty array for non-matching query', async () => {
      const args = {
        ...baseArgs,
        org_ref: 'blackhawk',
        query: 'nonexistent'
      };

      const result = await scpFindPrograms(args);

      expect(result.programs).toHaveLength(0);
    });
  });

  describe('scp.register', () => {
    it('should successfully register and return registration ref', async () => {
      const args = {
        ...baseArgs,
        session_ref: 'session_123',
        program_ref: 'blackhawk-2024-winter',
        child_id: 'child-789',
        answers: { 'skill_level': 'beginner' }
      };

      const result = await scpRegister(args);

      expect(result.registration_ref).toMatch(/^reg_[0-9a-f-]+$/);
      expect(verifyMandate).toHaveBeenCalledWith(args.mandate_id, 'scp:register');
      expect(auditToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'scp.register'
        }),
        expect.any(Function)
      );
    });
  });

  describe('scp.pay', () => {
    it('should successfully process payment', async () => {
      const args = {
        ...baseArgs,
        session_ref: 'session_123',
        registration_ref: 'reg_456',
        amount_cents: 50000
      };

      const result = await scpPay(args);

      expect(result.confirmation_ref).toMatch(/^pay_[0-9a-f-]+$/);
      expect(result.final_url).toContain('skiclubpro.com/confirmation/');
      expect(verifyMandate).toHaveBeenCalledWith(
        args.mandate_id, 
        'scp:pay', 
        { amount_cents: 50000 }
      );
    });

    it('should fail if amount exceeds mandate limit', async () => {
      verifyMandate.mockRejectedValueOnce(new Error('Amount exceeds mandate limit'));

      const args = {
        ...baseArgs,
        session_ref: 'session_123',
        registration_ref: 'reg_456',
        amount_cents: 100000
      };

      await expect(scpPay(args)).rejects.toThrow('Amount exceeds mandate limit');
    });
  });

  describe('evidence.capture', () => {
    it('should successfully capture evidence', async () => {
      const args = {
        ...baseArgs,
        kind: 'registration_screenshot'
      };

      const result = await captureEvidence(args);

      expect(result.asset_url).toContain('evidence.signupassist.com');
      expect(result.sha256).toMatch(/^sha256_[0-9a-f]+$/);
      expect(logEvidence).toHaveBeenCalledWith(
        args.plan_execution_id,
        args.kind,
        result.asset_url,
        result.sha256
      );
    });
  });

  describe('audit integration', () => {
    it('should call auditToolCall for all operations', async () => {
      const loginArgs = { ...baseArgs, credential_alias: 'test' };
      const findArgs = { ...baseArgs, org_ref: 'blackhawk' };
      const registerArgs = { ...baseArgs, session_ref: 'session_123', program_ref: 'prog_123', child_id: 'child_123' };
      const payArgs = { ...baseArgs, session_ref: 'session_123', registration_ref: 'reg_123', amount_cents: 1000 };
      const evidenceArgs = { ...baseArgs, kind: 'screenshot' };

      await scpLogin(loginArgs);
      await scpFindPrograms(findArgs);
      await scpRegister(registerArgs);
      await scpPay(payArgs);
      await captureEvidence(evidenceArgs);

      expect(auditToolCall).toHaveBeenCalledTimes(5);
      
      const toolCalls = auditToolCall.mock.calls.map(call => call[0].tool);
      expect(toolCalls).toEqual([
        'scp.login',
        'scp.find_programs',
        'scp.register',
        'scp.pay',
        'evidence.capture'
      ]);
    });
  });
});