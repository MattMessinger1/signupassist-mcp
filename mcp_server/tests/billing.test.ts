/**
 * Tests for billing integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chargeOnSuccess } from '../lib/billing';
import { verifyMandate } from '../lib/mandates';
import { auditToolCall } from '../middleware/audit';

// Mock dependencies
vi.mock('../lib/mandates');
vi.mock('../middleware/audit');
vi.mock('stripe');
vi.mock('@supabase/supabase-js');

const mockVerifyMandate = vi.mocked(verifyMandate);
const mockAuditToolCall = vi.mocked(auditToolCall);

// Mock Stripe
const mockStripe = {
  paymentIntents: {
    create: vi.fn()
  }
};

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  insert: vi.fn().mockReturnThis()
};

// Setup mocks
vi.mock('stripe', () => ({
  default: vi.fn(() => mockStripe)
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase)
}));

describe('Billing Integration', () => {
  const validArgs = {
    plan_execution_id: 'plan-exec-123',
    mandate_id: 'mandate-456'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default successful audit wrapper
    mockAuditToolCall.mockImplementation(async (context, handler) => {
      return await handler();
    });

    // Default successful mandate verification
    mockVerifyMandate.mockResolvedValue({
      verified: true,
      user_id: 'user-123',
      provider: 'skiclubpro',
      credential_type: 'jws'
    });

    // Mock environment variables
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_key';
  });

  describe('chargeOnSuccess', () => {
    it('should create a charge for successful plan execution', async () => {
      // Mock plan execution lookup
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'plan-exec-123',
          result: 'success',
          amount_cents: 5000,
          plans: { user_id: 'user-123' }
        },
        error: null
      });

      // Mock no existing charge
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' } // Not found
      });

      // Mock Stripe success
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded'
      });

      // Mock charge insertion
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'charge-789',
          status: 'succeeded'
        },
        error: null
      });

      const result = await chargeOnSuccess(validArgs);

      expect(result).toEqual({
        charge_id: 'charge-789',
        status: 'succeeded'
      });

      expect(mockVerifyMandate).toHaveBeenCalledWith('mandate-456', 'scp:pay');
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 5000,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          plan_execution_id: 'plan-exec-123',
          mandate_id: 'mandate-456'
        }
      });
    });

    it('should return existing charge if already exists (idempotency)', async () => {
      // Mock plan execution lookup
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'plan-exec-123',
          result: 'success',
          amount_cents: 5000,
          plans: { user_id: 'user-123' }
        },
        error: null
      });

      // Mock existing charge
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'existing-charge-123',
          status: 'succeeded'
        },
        error: null
      });

      const result = await chargeOnSuccess(validArgs);

      expect(result).toEqual({
        charge_id: 'existing-charge-123',
        status: 'succeeded'
      });

      // Should not create new Stripe payment intent
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should throw error if mandate missing scp:pay scope', async () => {
      mockVerifyMandate.mockRejectedValue(new Error('Mandate missing required scope: scp:pay'));

      await expect(chargeOnSuccess(validArgs)).rejects.toThrow('Mandate missing required scope: scp:pay');
    });

    it('should throw error if plan execution not found', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' }
      });

      await expect(chargeOnSuccess(validArgs)).rejects.toThrow('Plan execution not found: plan-exec-123');
    });

    it('should throw error if plan execution result is not success', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'plan-exec-123',
          result: 'failed',
          amount_cents: 5000,
          plans: { user_id: 'user-123' }
        },
        error: null
      });

      // Mock no existing charge
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' }
      });

      await expect(chargeOnSuccess(validArgs)).rejects.toThrow("Plan execution must have result 'success', got: failed");
    });

    it('should create charge with failed status if Stripe fails', async () => {
      // Mock plan execution lookup
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'plan-exec-123',
          result: 'success',
          amount_cents: 5000,
          plans: { user_id: 'user-123' }
        },
        error: null
      });

      // Mock no existing charge
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' }
      });

      // Mock Stripe failure
      mockStripe.paymentIntents.create.mockRejectedValue(new Error('Card declined'));

      // Mock charge insertion with failed status
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'charge-failed-123',
          status: 'failed'
        },
        error: null
      });

      const result = await chargeOnSuccess(validArgs);

      expect(result).toEqual({
        charge_id: 'charge-failed-123',
        status: 'failed'
      });
    });

    it('should throw error for invalid amount', async () => {
      // Mock plan execution with invalid amount
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'plan-exec-123',
          result: 'success',
          amount_cents: 0,
          plans: { user_id: 'user-123' }
        },
        error: null
      });

      // Mock no existing charge
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116' }
      });

      await expect(chargeOnSuccess(validArgs)).rejects.toThrow('Invalid amount for charging');
    });
  });
});