/**
 * Tests for SkiClubPro Login Functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scpLogin } from '../providers/skiclubpro';
import type { LoginArgs } from '../providers/skiclubpro';

// Mock dependencies
vi.mock('../lib/mandates', () => ({
  verifyMandate: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/credentials', () => ({
  lookupCredentials: vi.fn().mockResolvedValue({
    email: 'test@example.com',
    password: 'test-password',
  }),
}));

vi.mock('../lib/browserbase', () => ({
  launchBrowserbaseSession: vi.fn().mockResolvedValue({
    sessionId: 'mock-session-123',
    browser: { close: vi.fn() },
    context: {},
    page: {},
  }),
  performSkiClubProLogin: vi.fn().mockResolvedValue(undefined),
  captureScreenshot: vi.fn().mockResolvedValue(Buffer.from('mock-screenshot')),
  closeBrowserbaseSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/evidence', () => ({
  captureScreenshotEvidence: vi.fn().mockResolvedValue({
    asset_url: 'https://evidence.test.com/screenshot.png',
    sha256: 'mock-hash',
  }),
}));

vi.mock('../middleware/audit', () => ({
  auditToolCall: vi.fn().mockImplementation(async (context, fn) => {
    return await fn();
  }),
  logEvidence: vi.fn().mockResolvedValue(undefined),
}));

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: { user_id: 'test-user-123' },
    error: null,
  }),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue(mockSupabaseQuery),
  }),
}));

describe('SkiClubPro Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up environment variables
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.BROWSERBASE_API_KEY = 'test-browserbase-key';
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should successfully login with valid credentials', async () => {
    const args: LoginArgs = {
      credential_alias: 'skiclubpro-test',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    const result = await scpLogin(args);

    expect(result).toEqual({
      session_ref: 'mock-session-123',
    });

    // Verify that mandate was verified
    const { verifyMandate } = await import('../lib/mandates');
    expect(verifyMandate).toHaveBeenCalledWith('mandate-123', 'scp:login');

    // Verify that credentials were looked up
    const { lookupCredentials } = await import('../lib/credentials');
    expect(lookupCredentials).toHaveBeenCalledWith('skiclubpro-test', 'test-user-123');

    // Verify that Browserbase session was launched
    const { launchBrowserbaseSession } = await import('../lib/browserbase');
    expect(launchBrowserbaseSession).toHaveBeenCalled();

    // Verify that login was performed
    const { performSkiClubProLogin } = await import('../lib/browserbase');
    expect(performSkiClubProLogin).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'mock-session-123' }),
      { email: 'test@example.com', password: 'test-password' }
    );

    // Verify that screenshot evidence was captured
    const { captureScreenshotEvidence } = await import('../lib/evidence');
    expect(captureScreenshotEvidence).toHaveBeenCalledWith(
      'execution-456',
      expect.any(Buffer),
      'successful-login'
    );
  });

  it('should handle mandate verification failure', async () => {
    const { verifyMandate } = await import('../lib/mandates');
    vi.mocked(verifyMandate).mockRejectedValueOnce(
      new Error('Mandate does not include required scope: scp:login')
    );

    const args: LoginArgs = {
      credential_alias: 'skiclubpro-test',
      mandate_id: 'invalid-mandate',
      plan_execution_id: 'execution-456',
    };

    await expect(scpLogin(args)).rejects.toThrow(
      'Mandate does not include required scope: scp:login'
    );
  });

  it('should handle credentials lookup failure', async () => {
    const { lookupCredentials } = await import('../lib/credentials');
    vi.mocked(lookupCredentials).mockRejectedValueOnce(
      new Error('Credentials not found for alias: invalid-alias')
    );

    const args: LoginArgs = {
      credential_alias: 'invalid-alias',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    await expect(scpLogin(args)).rejects.toThrow(
      'SkiClubPro login failed: Credentials not found for alias: invalid-alias'
    );
  });

  it('should handle login automation failure', async () => {
    const { performSkiClubProLogin } = await import('../lib/browserbase');
    vi.mocked(performSkiClubProLogin).mockRejectedValueOnce(
      new Error('Could not find login button')
    );

    const args: LoginArgs = {
      credential_alias: 'skiclubpro-test',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    await expect(scpLogin(args)).rejects.toThrow(
      'SkiClubPro login failed: Could not find login button'
    );

    // Verify that error screenshot was captured
    const { captureScreenshotEvidence } = await import('../lib/evidence');
    expect(captureScreenshotEvidence).toHaveBeenCalledWith(
      'execution-456',
      expect.any(Buffer),
      'failed-login'
    );

    // Verify that session was closed
    const { closeBrowserbaseSession } = await import('../lib/browserbase');
    expect(closeBrowserbaseSession).toHaveBeenCalled();
  });
});