/**
 * Unit tests for audit trail middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { auditToolCall, logEvidence, createAuditMiddleware, AuditContext } from '../middleware/audit';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

// Mock mandate verification
jest.mock('../lib/mandates', () => ({
  verifyMandate: jest.fn(),
}));

// Mock crypto.subtle for browser environment
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: jest.fn().mockImplementation(async (algorithm: string, data: ArrayBuffer) => {
        // Simple mock hash - just convert to string and back to ArrayBuffer
        const text = new TextDecoder().decode(data);
        const hash = text.split('').map(c => c.charCodeAt(0)).slice(0, 32);
        return new Uint8Array(hash.concat(Array(32 - hash.length).fill(0))).buffer;
      }),
    },
  },
});

describe('Audit Trail Middleware', () => {
  let mockContext: AuditContext;
  let mockToolHandler: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      plan_execution_id: 'plan-exec-123',
      mandate_id: 'mandate-456',
      tool: 'test-tool',
    };

    mockToolHandler = jest.fn().mockResolvedValue({ success: true, data: 'test result' });
  });

  describe('auditToolCall', () => {
    it('should log tool call start and finish successfully', async () => {
      // Mock successful DB operations
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const args = { param1: 'value1', param2: 42 };
      const result = await auditToolCall(mockContext, args, mockToolHandler);

      // Verify tool was executed
      expect(mockToolHandler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data: 'test result' });

      // Verify start logging
      expect(mockSupabase.from).toHaveBeenCalledWith('mcp_tool_calls');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_execution_id: 'plan-exec-123',
          mandate_id: 'mandate-456',
          tool: 'test-tool',
          args_json: args,
          decision: 'pending',
        })
      );

      // Verify finish logging
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          result_json: { success: true, data: 'test result' },
          decision: 'allowed',
        })
      );
    });

    it('should handle tool execution failure and log denial', async () => {
      // Mock successful DB operations
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Mock tool failure
      const toolError = new Error('Tool execution failed');
      mockToolHandler.mockRejectedValueOnce(toolError);

      const args = { param1: 'value1' };
      
      await expect(auditToolCall(mockContext, args, mockToolHandler)).rejects.toThrow(
        'Tool execution failed'
      );

      // Verify failure was logged
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          result_json: { error: 'Tool execution failed' },
          decision: 'denied',
        })
      );
    });

    it('should verify mandate when required scope is provided', async () => {
      const { verifyMandate } = require('../lib/mandates');
      
      // Mock mandate retrieval
      mockSupabase.select.mockResolvedValueOnce({
        data: { jws_compact: 'mock.jwt.token' },
        error: null,
      });
      
      // Mock audit logging
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const args = { amount_cents: 5000 };
      const result = await auditToolCall(mockContext, args, mockToolHandler, 'scp:pay');

      // Verify mandate was verified
      expect(verifyMandate).toHaveBeenCalledWith('mock.jwt.token', 'scp:pay');
      expect(result).toEqual({ success: true, data: 'test result' });
    });

    it('should deny execution when mandate verification fails', async () => {
      const { verifyMandate } = require('../lib/mandates');
      
      // Mock mandate retrieval
      mockSupabase.select.mockResolvedValueOnce({
        data: { jws_compact: 'mock.jwt.token' },
        error: null,
      });
      
      // Mock audit logging
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Mock mandate verification failure
      verifyMandate.mockRejectedValueOnce(new Error('Insufficient scope'));

      const args = { amount_cents: 5000 };
      
      await expect(
        auditToolCall(mockContext, args, mockToolHandler, 'scp:pay')
      ).rejects.toThrow('Mandate verification failed: Insufficient scope');

      // Verify denial was logged
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          result_json: { error: 'Insufficient scope' },
          decision: 'denied',
        })
      );
    });

    it('should redact sensitive data in results', async () => {
      // Mock successful DB operations
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      // Mock tool returning sensitive data
      mockToolHandler.mockResolvedValueOnce({
        success: true,
        user_password: 'secret123',
        api_key: 'sk-1234567890',
        credit_card: '4111-1111-1111-1111',
        safe_data: 'this is fine',
      });

      const args = { param1: 'value1' };
      await auditToolCall(mockContext, args, mockToolHandler);

      // Verify sensitive data was redacted
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          result_json: {
            success: true,
            user_password: '[REDACTED]',
            api_key: '[REDACTED]',
            credit_card: '[REDACTED]',
            safe_data: 'this is fine',
          },
          decision: 'allowed',
        })
      );
    });
  });

  describe('logEvidence', () => {
    it('should successfully log evidence assets', async () => {
      mockSupabase.insert.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await logEvidence(
        'plan-exec-123',
        'screenshot',
        'https://example.com/screenshot.png',
        'abc123def456'
      );

      expect(mockSupabase.from).toHaveBeenCalledWith('evidence_assets');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_execution_id: 'plan-exec-123',
          type: 'screenshot',
          url: 'https://example.com/screenshot.png',
          sha256: 'abc123def456',
        })
      );
    });

    it('should handle evidence logging failure', async () => {
      mockSupabase.insert.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        logEvidence('plan-exec-123', 'screenshot')
      ).rejects.toThrow('Evidence logging failed: Database error');
    });
  });

  describe('createAuditMiddleware', () => {
    it('should create middleware function that wraps tool calls', async () => {
      // Mock successful DB operations
      mockSupabase.insert.mockResolvedValueOnce({
        data: { id: 'audit-log-123' },
        error: null,
      });
      mockSupabase.update.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const middleware = createAuditMiddleware(mockContext, 'scp:login');
      const args = { username: 'testuser' };
      
      const result = await middleware(args, mockToolHandler);

      expect(mockToolHandler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data: 'test result' });
      
      // Verify audit logging occurred
      expect(mockSupabase.insert).toHaveBeenCalled();
      expect(mockSupabase.update).toHaveBeenCalled();
    });
  });
});