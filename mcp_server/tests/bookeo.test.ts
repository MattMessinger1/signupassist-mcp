/**
 * Bookeo Provider Tests
 * Tests for Bookeo API integration
 */

import { describe, it, expect } from '@jest/globals';
import { bookeoTools } from '../providers/bookeo.js';

describe('Bookeo Provider', () => {
  it('should export find_programs tool', () => {
    const findProgramsTool = bookeoTools.find(t => t.name === 'bookeo.find_programs');
    expect(findProgramsTool).toBeDefined();
    expect(findProgramsTool?.inputSchema.required).toContain('org_ref');
  });

  it('should export discover_required_fields tool', () => {
    const discoverTool = bookeoTools.find(t => t.name === 'bookeo.discover_required_fields');
    expect(discoverTool).toBeDefined();
    expect(discoverTool?.inputSchema.required).toContain('program_ref');
    expect(discoverTool?.inputSchema.required).toContain('org_ref');
  });

  it('should have proper tool structure', () => {
    bookeoTools.forEach(tool => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    });
  });
});

describe('Bookeo API Integration', () => {
  // Note: These tests require valid Bookeo API credentials
  // They are skipped in CI/CD without BOOKEO_API_KEY
  const hasCredentials = process.env.BOOKEO_API_KEY && process.env.BOOKEO_SECRET_KEY;
  
  it.skipIf(!hasCredentials)('should authenticate with Bookeo API', async () => {
    // This would make a real API call to verify credentials
    // Implementation depends on test environment setup
  });

  it.skipIf(!hasCredentials)('should fetch products from Bookeo', async () => {
    // This would test the actual API integration
    // Implementation depends on test environment setup
  });
});
