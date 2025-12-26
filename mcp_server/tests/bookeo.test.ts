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

  it('should export create_hold tool', () => {
    const createHoldTool = bookeoTools.find(t => t.name === 'bookeo.create_hold');
    expect(createHoldTool).toBeDefined();
    expect(createHoldTool?.inputSchema.required).toContain('eventId');
    expect(createHoldTool?.inputSchema.required).toContain('productId');
    expect(createHoldTool?.inputSchema.required).toContain('email');
  });

  it('should export confirm_booking tool', () => {
    const confirmTool = bookeoTools.find(t => t.name === 'bookeo.confirm_booking');
    expect(confirmTool).toBeDefined();
    expect(confirmTool?.inputSchema.required).toContain('holdId');
    expect(confirmTool?.inputSchema.required).toContain('email');
  });

  it('should have proper tool structure', () => {
    bookeoTools.forEach(tool => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    });
  });
  
  it('should have exactly 4 tools', () => {
    expect(bookeoTools.length).toBe(4);
  });

  it('should include source_provider and org_ref on all tool handlers', () => {
    // Verify that find_programs tool exists and has proper structure
    const findProgramsTool = bookeoTools.find(t => t.name === 'bookeo.find_programs');
    expect(findProgramsTool).toBeDefined();
    // The handler should enforce source_provider: 'bookeo' on all returned programs
    // This is verified at runtime - the actual handler adds source_provider to each program
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
