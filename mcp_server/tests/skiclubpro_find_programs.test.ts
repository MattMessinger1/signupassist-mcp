/**
 * Tests for SkiClubPro Find Programs Functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scpFindPrograms } from '../providers/skiclubpro';
import type { FindProgramsArgs } from '../providers/skiclubpro';

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

const mockPrograms = [
  {
    program_ref: 'blackhawk-winter-2024',
    title: 'Blackhawk Winter Program 2024',
    opens_at: '2024-12-01T09:00:00Z',
  },
  {
    program_ref: 'blackhawk-spring-2024',
    title: 'Blackhawk Spring Program 2024',
    opens_at: '2024-03-01T09:00:00Z',
  },
  {
    program_ref: 'youth-camps-2024',
    title: 'Youth Summer Camps 2024',
    opens_at: '2024-06-01T09:00:00Z',
  },
];

vi.mock('../lib/browserbase', () => ({
  launchBrowserbaseSession: vi.fn().mockResolvedValue({
    sessionId: 'mock-session-123',
    browser: { close: vi.fn() },
    context: {},
    page: {},
  }),
  performSkiClubProLogin: vi.fn().mockResolvedValue(undefined),
  scrapeSkiClubProPrograms: vi.fn().mockResolvedValue(mockPrograms),
  captureScreenshot: vi.fn().mockResolvedValue(Buffer.from('mock-screenshot')),
  closeBrowserbaseSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/evidence', () => ({
  captureScreenshotEvidence: vi.fn().mockResolvedValue({
    asset_url: 'https://evidence.test.com/programs.png',
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

describe('SkiClubPro Find Programs', () => {
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

  it('should successfully find programs', async () => {
    const args: FindProgramsArgs = {
      org_ref: 'blackhawk-ski-club',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    const result = await scpFindPrograms(args);

    expect(result).toEqual({
      programs: mockPrograms,
    });

    // Verify that mandate was verified with correct scope
    const { verifyMandate } = await import('../lib/mandates');
    expect(verifyMandate).toHaveBeenCalledWith('mandate-123', 'scp:read:listings');

    // Verify that Browserbase session was launched
    const { launchBrowserbaseSession } = await import('../lib/browserbase');
    expect(launchBrowserbaseSession).toHaveBeenCalled();

    // Verify that login was performed
    const { performSkiClubProLogin } = await import('../lib/browserbase');
    expect(performSkiClubProLogin).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'mock-session-123' }),
      { email: 'test@example.com', password: 'test-password' }
    );

    // Verify that programs were scraped
    const { scrapeSkiClubProPrograms } = await import('../lib/browserbase');
    expect(scrapeSkiClubProPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'mock-session-123' }),
      'blackhawk-ski-club',
      undefined
    );

    // Verify that screenshot evidence was captured
    const { captureScreenshotEvidence } = await import('../lib/evidence');
    expect(captureScreenshotEvidence).toHaveBeenCalledWith(
      'execution-456',
      expect.any(Buffer),
      'programs-listing'
    );
  });

  it('should filter programs by query', async () => {
    const { scrapeSkiClubProPrograms } = await import('../lib/browserbase');
    vi.mocked(scrapeSkiClubProPrograms).mockResolvedValueOnce([
      mockPrograms[0], // Contains "winter"
    ]);

    const args: FindProgramsArgs = {
      org_ref: 'blackhawk-ski-club',
      query: 'winter',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    const result = await scpFindPrograms(args);

    expect(result.programs).toHaveLength(1);
    expect(result.programs[0].title).toContain('Winter');

    // Verify that query was passed to scraper
    expect(scrapeSkiClubProPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'mock-session-123' }),
      'blackhawk-ski-club',
      'winter'
    );
  });

  it('should handle mandate verification failure', async () => {
    const { verifyMandate } = await import('../lib/mandates');
    vi.mocked(verifyMandate).mockRejectedValueOnce(
      new Error('Mandate does not include required scope: scp:read:listings')
    );

    const args: FindProgramsArgs = {
      org_ref: 'blackhawk-ski-club',
      mandate_id: 'invalid-mandate',
      plan_execution_id: 'execution-456',
    };

    await expect(scpFindPrograms(args)).rejects.toThrow(
      'Mandate does not include required scope: scp:read:listings'
    );
  });

  it('should handle scraping failure', async () => {
    const { scrapeSkiClubProPrograms } = await import('../lib/browserbase');
    vi.mocked(scrapeSkiClubProPrograms).mockRejectedValueOnce(
      new Error('Could not find program listings')
    );

    const args: FindProgramsArgs = {
      org_ref: 'blackhawk-ski-club',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    await expect(scpFindPrograms(args)).rejects.toThrow(
      'SkiClubPro program discovery failed: Could not find program listings'
    );

    // Verify that error screenshot was captured
    const { captureScreenshotEvidence } = await import('../lib/evidence');
    expect(captureScreenshotEvidence).toHaveBeenCalledWith(
      'execution-456',
      expect.any(Buffer),
      'failed-program-scraping'
    );

    // Verify that session was closed
    const { closeBrowserbaseSession } = await import('../lib/browserbase');
    expect(closeBrowserbaseSession).toHaveBeenCalled();
  });

  it('should return empty programs array when none found', async () => {
    const { scrapeSkiClubProPrograms } = await import('../lib/browserbase');
    vi.mocked(scrapeSkiClubProPrograms).mockResolvedValueOnce([]);

    const args: FindProgramsArgs = {
      org_ref: 'empty-org',
      mandate_id: 'mandate-123',
      plan_execution_id: 'execution-456',
    };

    const result = await scpFindPrograms(args);

    expect(result).toEqual({
      programs: [],
    });
  });
});