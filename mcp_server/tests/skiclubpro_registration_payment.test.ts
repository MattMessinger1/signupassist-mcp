/**
 * Unit tests for SkiClubPro registration and payment functionality
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { scpRegister, scpPay, type RegisterArgs, type PayArgs } from '../providers/skiclubpro';

// Mock dependencies
jest.mock('../lib/mandates');
jest.mock('../middleware/audit');
jest.mock('../lib/credentials');
jest.mock('../lib/browserbase');
jest.mock('../lib/evidence');

const mockVerifyMandate = jest.fn();
const mockAuditToolCall = jest.fn();
const mockLookupCredentials = jest.fn();
const mockLaunchBrowserbaseSession = jest.fn();
const mockConnectToBrowserbaseSession = jest.fn();
const mockPerformSkiClubProLogin = jest.fn();
const mockPerformSkiClubProRegistration = jest.fn();
const mockPerformSkiClubProPayment = jest.fn();
const mockCaptureScreenshot = jest.fn();
const mockCaptureScreenshotEvidence = jest.fn();
const mockCloseBrowserbaseSession = jest.fn();

// Mock Supabase
const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn()
      }))
    }))
  }))
};

describe('SkiClubPro Registration and Payment', () => {
  const mockSession = {
    sessionId: 'test-session-123',
    browser: {},
    context: {},
    page: {}
  };

  const mockChild = {
    id: 'child-123',
    name: 'Test Child',
    dob: '2015-06-15',
    user_id: 'user-123'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
    require('../lib/mandates').verifyMandate = mockVerifyMandate;
    require('../middleware/audit').auditToolCall = mockAuditToolCall;
    require('../lib/credentials').lookupCredentials = mockLookupCredentials;
    require('../lib/browserbase').launchBrowserbaseSession = mockLaunchBrowserbaseSession;
    require('../lib/browserbase').connectToBrowserbaseSession = mockConnectToBrowserbaseSession;
    require('../lib/browserbase').performSkiClubProLogin = mockPerformSkiClubProLogin;
    require('../lib/browserbase').performSkiClubProRegistration = mockPerformSkiClubProRegistration;
    require('../lib/browserbase').performSkiClubProPayment = mockPerformSkiClubProPayment;
    require('../lib/browserbase').captureScreenshot = mockCaptureScreenshot;
    require('../lib/browserbase').closeBrowserbaseSession = mockCloseBrowserbaseSession;
    require('../lib/evidence').captureScreenshotEvidence = mockCaptureScreenshotEvidence;
    
    // Mock audit tool call to execute the function directly
    mockAuditToolCall.mockImplementation(async (context, fn) => await fn());
    
    // Mock successful operations
    mockVerifyMandate.mockResolvedValue(true);
    mockLookupCredentials.mockResolvedValue({
      email: 'test@example.com',
      password: 'password123'
    });
    mockLaunchBrowserbaseSession.mockResolvedValue(mockSession);
    mockConnectToBrowserbaseSession.mockResolvedValue(mockSession);
    mockCaptureScreenshot.mockResolvedValue(Buffer.from('screenshot'));
    mockCaptureScreenshotEvidence.mockResolvedValue({
      asset_url: 'https://evidence.com/screenshot.png',
      sha256: 'abc123'
    });
  });

  describe('scp.register', () => {
    const mockRegisterArgs: RegisterArgs = {
      program_ref: 'blackhawk_winter_nordic',
      child_id: 'child-123',
      answers: {
        'skill_level': 'Beginner',
        'program_type': 'Nordic',
        'emergency_contact': 'Parent Name'
      },
      mandate_id: 'mandate-123',
      plan_execution_id: 'exec-123'
    };

    beforeEach(() => {
      // Mock successful mandate and child lookup
      mockSupabase.from().select().eq().single
        .mockResolvedValueOnce({
          data: { user_id: 'user-123', scope: ['scp:enroll'], program_ref: 'blackhawk_winter_nordic' },
          error: null
        })
        .mockResolvedValueOnce({
          data: mockChild,
          error: null
        });
      
      mockPerformSkiClubProRegistration.mockResolvedValue({
        registration_ref: 'reg_test_12345'
      });
    });

    it('should successfully register with Nordic program answers', async () => {
      const result = await scpRegister(mockRegisterArgs);
      
      expect(result).toEqual({ registration_ref: 'reg_test_12345' });
      expect(mockVerifyMandate).toHaveBeenCalledWith(mockRegisterArgs.mandate_id, 'scp:enroll');
      expect(mockPerformSkiClubProRegistration).toHaveBeenCalledWith(mockSession, {
        program_ref: mockRegisterArgs.program_ref,
        child: mockChild,
        answers: mockRegisterArgs.answers,
        mandate_scope: ['scp:enroll']
      });
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledTimes(2); // pre and post registration
    });

    it('should register with Alpine program answers', async () => {
      const alpineArgs = {
        ...mockRegisterArgs,
        program_ref: 'blackhawk_winter_alpine',
        answers: {
          'skill_level': 'Intermediate',
          'program_type': 'Alpine',
          'equipment_rental': 'Yes'
        }
      };

      await scpRegister(alpineArgs);
      
      expect(mockPerformSkiClubProRegistration).toHaveBeenCalledWith(mockSession, {
        program_ref: alpineArgs.program_ref,
        child: mockChild,
        answers: alpineArgs.answers,
        mandate_scope: ['scp:enroll']
      });
    });

    it('should use existing session if session_ref provided', async () => {
      const argsWithSession = { ...mockRegisterArgs, session_ref: 'existing-session-456' };
      
      await scpRegister(argsWithSession);
      
      expect(mockConnectToBrowserbaseSession).toHaveBeenCalledWith('existing-session-456');
      expect(mockLaunchBrowserbaseSession).not.toHaveBeenCalled();
      expect(mockPerformSkiClubProLogin).not.toHaveBeenCalled();
      expect(mockCloseBrowserbaseSession).not.toHaveBeenCalled();
    });

    it('should handle unexpected required field failure', async () => {
      mockPerformSkiClubProRegistration.mockRejectedValue(
        new Error('Registration denied: Unexpected required fields detected: Medical Information')
      );
      
      await expect(scpRegister(mockRegisterArgs)).rejects.toThrow('Unexpected required fields detected');
      
      expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockSession, 'registration-failed.png');
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledWith(
        mockRegisterArgs.plan_execution_id,
        expect.any(Buffer),
        'failed-registration'
      );
    });

    it('should handle mandate verification failure', async () => {
      mockVerifyMandate.mockRejectedValue(new Error('Invalid mandate scope'));
      
      await expect(scpRegister(mockRegisterArgs)).rejects.toThrow('Invalid mandate scope');
      expect(mockLaunchBrowserbaseSession).not.toHaveBeenCalled();
    });
  });

  describe('scp.pay', () => {
    const mockPayArgs: PayArgs = {
      registration_ref: 'reg_test_12345',
      amount_cents: 15000, // $150.00
      payment_method: {
        type: 'stored' as const,
        card_alias: 'visa_1234'
      },
      mandate_id: 'mandate-123',
      plan_execution_id: 'exec-123'
    };

    beforeEach(() => {
      // Mock successful mandate lookup
      mockSupabase.from().select().eq().single.mockResolvedValue({
        data: { user_id: 'user-123' },
        error: null
      });
      
      mockPerformSkiClubProPayment.mockResolvedValue({
        confirmation_ref: 'pay_conf_67890',
        final_url: 'https://app.skiclubpro.com/confirmation/pay_conf_67890'
      });
    });

    it('should successfully process payment with stored card', async () => {
      const result = await scpPay(mockPayArgs);
      
      expect(result).toEqual({
        confirmation_ref: 'pay_conf_67890',
        final_url: 'https://app.skiclubpro.com/confirmation/pay_conf_67890'
      });
      expect(mockVerifyMandate).toHaveBeenCalledWith(
        mockPayArgs.mandate_id, 
        'scp:pay', 
        { amount_cents: mockPayArgs.amount_cents }
      );
      expect(mockPerformSkiClubProPayment).toHaveBeenCalledWith(mockSession, {
        registration_ref: mockPayArgs.registration_ref,
        amount_cents: mockPayArgs.amount_cents,
        payment_method: mockPayArgs.payment_method
      });
    });

    it('should process payment with another stored card', async () => {
      const altPayArgs: PayArgs = {
        ...mockPayArgs,
        payment_method: {
          type: 'stored' as const,
          card_alias: 'card_alternate_456'
        }
      };

      await scpPay(altPayArgs);
      
      expect(mockPerformSkiClubProPayment).toHaveBeenCalledWith(mockSession, {
        registration_ref: altPayArgs.registration_ref,
        amount_cents: altPayArgs.amount_cents,
        payment_method: altPayArgs.payment_method
      });
    });

    it('should process payment without specific payment method', async () => {
      const simplePayArgs = {
        registration_ref: 'reg_test_12345',
        amount_cents: 10000,
        mandate_id: 'mandate-123',
        plan_execution_id: 'exec-123'
      };

      await scpPay(simplePayArgs);
      
      expect(mockPerformSkiClubProPayment).toHaveBeenCalledWith(mockSession, {
        registration_ref: simplePayArgs.registration_ref,
        amount_cents: simplePayArgs.amount_cents,
        payment_method: undefined
      });
    });

    it('should use existing session if session_ref provided', async () => {
      const argsWithSession = { ...mockPayArgs, session_ref: 'existing-session-789' };
      
      await scpPay(argsWithSession);
      
      expect(mockConnectToBrowserbaseSession).toHaveBeenCalledWith('existing-session-789');
      expect(mockLaunchBrowserbaseSession).not.toHaveBeenCalled();
      expect(mockCloseBrowserbaseSession).not.toHaveBeenCalled();
    });

    it('should handle payment failure with error screenshot', async () => {
      mockPerformSkiClubProPayment.mockRejectedValue(new Error('Payment declined'));
      
      await expect(scpPay(mockPayArgs)).rejects.toThrow('Payment declined');
      
      expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockSession, 'payment-failed.png');
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledWith(
        mockPayArgs.plan_execution_id,
        expect.any(Buffer),
        'failed-payment'
      );
    });

    it('should handle amount exceeding mandate limit', async () => {
      mockVerifyMandate.mockRejectedValue(new Error('Amount exceeds mandate limit'));
      
      await expect(scpPay(mockPayArgs)).rejects.toThrow('Amount exceeds mandate limit');
      expect(mockLaunchBrowserbaseSession).not.toHaveBeenCalled();
    });

    it('should capture pre-payment and confirmation screenshots', async () => {
      await scpPay(mockPayArgs);
      
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledTimes(2);
      expect(mockCaptureScreenshotEvidence).toHaveBeenNthCalledWith(
        1,
        mockPayArgs.plan_execution_id,
        expect.any(Buffer),
        'pre-payment'
      );
      expect(mockCaptureScreenshotEvidence).toHaveBeenNthCalledWith(
        2,
        mockPayArgs.plan_execution_id,
        expect.any(Buffer),
        'payment-confirmation'
      );
    });
  });

  describe('audit integration', () => {
    it('should audit registration calls', async () => {
      const registerArgs: RegisterArgs = {
        program_ref: 'test_program',
        child_id: 'child-123',
        mandate_id: 'mandate-123',
        plan_execution_id: 'exec-123'
      };

      mockSupabase.from().select().eq().single
        .mockResolvedValueOnce({ data: { user_id: 'user-123', scope: ['scp:enroll'] }, error: null })
        .mockResolvedValueOnce({ data: mockChild, error: null });
      
      mockPerformSkiClubProRegistration.mockResolvedValue({ registration_ref: 'reg_123' });

      await scpRegister(registerArgs);

      expect(mockAuditToolCall).toHaveBeenCalledWith(
        {
          plan_execution_id: registerArgs.plan_execution_id,
          mandate_id: registerArgs.mandate_id,
          tool: 'scp.register'
        },
        expect.any(Function)
      );
    });

    it('should audit payment calls', async () => {
      const payArgs: PayArgs = {
        registration_ref: 'reg_123',
        amount_cents: 10000,
        mandate_id: 'mandate-123',
        plan_execution_id: 'exec-123'
      };

      mockSupabase.from().select().eq().single.mockResolvedValue({
        data: { user_id: 'user-123' },
        error: null
      });
      
      mockPerformSkiClubProPayment.mockResolvedValue({
        confirmation_ref: 'pay_123',
        final_url: 'https://test.com'
      });

      await scpPay(payArgs);

      expect(mockAuditToolCall).toHaveBeenCalledWith(
        {
          plan_execution_id: payArgs.plan_execution_id,
          mandate_id: payArgs.mandate_id,
          tool: 'scp.pay'
        },
        expect.any(Function)
      );
    });
  });
});