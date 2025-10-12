/**
 * Unit tests for mandate signing and verification
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { issueMandate, verifyMandate, hashJSON, MandatePayload } from '../lib/mandates';

// Mock environment variable
process.env.MANDATE_SIGNING_KEY = Buffer.from('test-signing-key-32-bytes-long!!').toString('base64');

describe('Mandate Signing & Verification', () => {
  let validPayload: MandatePayload;

  beforeEach(() => {
    validPayload = {
      mandate_id: 'test-mandate-123',
      user_id: 'user-456',
      provider: 'skiclubpro',
      scope: ['scp:login', 'scp:register', 'scp:pay'],
      child_id: 'child-789',
      program_ref: 'blackhawk-2024',
      max_amount_cents: 50000, // $500
      valid_from: new Date().toISOString(),
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      credential_type: 'jws' as const,
    };
  });

  describe('issueMandate', () => {
    it('should successfully issue a mandate JWS', async () => {
      const jws = await issueMandate(validPayload);
      
      expect(typeof jws).toBe('string');
      expect(jws.split('.')).toHaveLength(3); // JWS has 3 parts
    });

    it('should throw error when signing key is missing', async () => {
      delete process.env.MANDATE_SIGNING_KEY;
      
      await expect(issueMandate(validPayload)).rejects.toThrow(
        'MANDATE_SIGNING_KEY environment variable is required'
      );
      
      // Restore for other tests
      process.env.MANDATE_SIGNING_KEY = Buffer.from('test-signing-key-32-bytes-long!!').toString('base64');
    });
  });

  describe('verifyMandate', () => {
    it('should successfully verify a valid mandate', async () => {
      const jws = await issueMandate(validPayload);
      const verified = await verifyMandate(jws, 'scp:pay');
      
      expect(verified.verified).toBe(true);
      expect(verified.user_id).toBe(validPayload.user_id);
      expect(verified.provider).toBe(validPayload.provider);
    });

    it('should reject expired mandate', async () => {
      const expiredPayload = {
        ...validPayload,
        valid_until: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      };
      
      const jws = await issueMandate(expiredPayload);
      
      await expect(verifyMandate(jws, 'scp:pay')).rejects.toThrow(
        'Mandate has expired'
      );
    });

    it('should reject mandate without required scope', async () => {
      const limitedPayload = {
        ...validPayload,
        scope: ['scp:login'], // Missing 'scp:pay'
      };
      
      const jws = await issueMandate(limitedPayload);
      
      await expect(verifyMandate(jws, 'scp:pay')).rejects.toThrow(
        'Mandate does not include required scope: scp:pay'
      );
    });

    it('should reject amount exceeding mandate limit', async () => {
      const jws = await issueMandate(validPayload);
      
      await expect(
        verifyMandate(jws, 'scp:pay', { amount_cents: 60000 }) // $600 > $500 limit
      ).rejects.toThrow(
        'Amount 60000 cents exceeds mandate limit of 50000 cents'
      );
    });

    it('should allow amount within mandate limit', async () => {
      const jws = await issueMandate(validPayload);
      
      const verified = await verifyMandate(jws, 'scp:pay', { 
        amount_cents: 30000 // $300 < $500 limit
      });
      
      expect(verified.verified).toBe(true);
    });

    it('should reject mandate not yet valid', async () => {
      const futurePayload = {
        ...validPayload,
        valid_from: new Date(Date.now() + 60000).toISOString(), // 1 minute in future
      };
      
      const jws = await issueMandate(futurePayload);
      
      await expect(verifyMandate(jws, 'scp:pay')).rejects.toThrow(
        'Mandate is not yet valid'
      );
    });

    it('should issue JWS mandate when credential_type is jws', async () => {
      const jws = await issueMandate(validPayload, { credential_type: 'jws' });
      const verified = await verifyMandate(jws, 'scp:pay');
      
      expect(verified.verified).toBe(true);
      expect(verified.credential_type).toBe('jws');
    });

    it('should issue VC placeholder when credential_type is vc', async () => {
      const vcPayload = { ...validPayload, credential_type: 'vc' as const };
      const vcToken = await issueMandate(vcPayload, { credential_type: 'vc' });
      
      const parsed = JSON.parse(vcToken);
      expect(parsed.vc).toBe('not-implemented');
      expect(parsed.mandate_id).toBe(validPayload.mandate_id);
    });

    it('should throw error when verifying VC credential', async () => {
      const vcPayload = { ...validPayload, credential_type: 'vc' as const };
      const vcToken = await issueMandate(vcPayload, { credential_type: 'vc' });
      
      await expect(verifyMandate(vcToken, 'scp:pay')).rejects.toThrow(
        'VC verification not yet implemented'
      );
    });
  });

  describe('hashJSON', () => {
    it('should produce consistent hashes for same object', () => {
      const obj = { b: 2, a: 1, c: 3 };
      const hash1 = hashJSON(obj);
      const hash2 = hashJSON(obj);
      
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of property order', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      
      expect(hashJSON(obj1)).toBe(hashJSON(obj2));
    });

    it('should produce different hashes for different objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3 };
      
      expect(hashJSON(obj1)).not.toBe(hashJSON(obj2));
    });
  });
});