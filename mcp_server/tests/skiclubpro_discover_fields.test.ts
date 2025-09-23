/**
 * Unit tests for SkiClubPro discover required fields functionality
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { scpDiscoverRequiredFields, type DiscoverRequiredFieldsArgs, type FieldSchema } from '../providers/skiclubpro';

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
const mockDiscoverProgramRequiredFields = jest.fn();
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

describe('SkiClubPro Discover Required Fields', () => {
  const mockSession = {
    sessionId: 'test-session-123',
    browser: {},
    context: {},
    page: {}
  };

  const mockArgs: DiscoverRequiredFieldsArgs = {
    program_ref: 'blackhawk_winter',
    mandate_id: 'mandate-123',
    plan_execution_id: 'exec-123'
  };

  const mockFieldSchema: FieldSchema = {
    program_ref: 'blackhawk_winter',
    branches: [
      {
        choice: 'Nordic',
        questions: [
          {
            id: 'child_name',
            label: 'Child Name',
            type: 'text',
            required: true
          },
          {
            id: 'skill_level',
            label: 'Skill Level',
            type: 'select',
            required: true,
            options: ['Beginner', 'Intermediate', 'Advanced']
          }
        ]
      },
      {
        choice: 'Alpine',
        questions: [
          {
            id: 'child_name',
            label: 'Child Name',
            type: 'text',
            required: true
          },
          {
            id: 'equipment_rental',
            label: 'Equipment Rental',
            type: 'checkbox',
            required: false
          }
        ]
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
    require('../lib/mandates').verifyMandate = mockVerifyMandate;
    require('../middleware/audit').auditToolCall = mockAuditToolCall;
    require('../lib/credentials').lookupCredentials = mockLookupCredentials;
    require('../lib/browserbase').launchBrowserbaseSession = mockLaunchBrowserbaseSession;
    require('../lib/browserbase').discoverProgramRequiredFields = mockDiscoverProgramRequiredFields;
    require('../lib/browserbase').captureScreenshot = mockCaptureScreenshot;
    require('../lib/browserbase').closeBrowserbaseSession = mockCloseBrowserbaseSession;
    require('../lib/evidence').captureScreenshotEvidence = mockCaptureScreenshotEvidence;
    
    // Mock audit tool call to execute the function directly
    mockAuditToolCall.mockImplementation(async (context, fn) => await fn());
    
    // Mock successful mandate lookup
    mockSupabase.from().select().eq().single.mockResolvedValue({
      data: { user_id: 'user-123' },
      error: null
    });
    
    // Mock successful operations
    mockVerifyMandate.mockResolvedValue(true);
    mockLookupCredentials.mockResolvedValue({
      email: 'test@example.com',
      password: 'password123'
    });
    mockLaunchBrowserbaseSession.mockResolvedValue(mockSession);
    mockDiscoverProgramRequiredFields.mockResolvedValue(mockFieldSchema);
    mockCaptureScreenshot.mockResolvedValue(Buffer.from('screenshot'));
    mockCaptureScreenshotEvidence.mockResolvedValue({
      asset_url: 'https://evidence.com/screenshot.png',
      sha256: 'abc123'
    });
  });

  describe('scp.discover_required_fields', () => {
    it('should successfully discover required fields with branches', async () => {
      const result = await scpDiscoverRequiredFields(mockArgs);
      
      expect(result).toEqual(mockFieldSchema);
      expect(mockVerifyMandate).toHaveBeenCalledWith(mockArgs.mandate_id, 'scp:read:listings');
      expect(mockLaunchBrowserbaseSession).toHaveBeenCalled();
      expect(mockDiscoverProgramRequiredFields).toHaveBeenCalledWith(mockSession, mockArgs.program_ref);
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledWith(
        mockArgs.plan_execution_id,
        expect.any(Buffer),
        'discovery'
      );
      expect(mockCloseBrowserbaseSession).toHaveBeenCalledWith(mockSession);
    });

    it('should handle mandate verification failure', async () => {
      mockVerifyMandate.mockRejectedValue(new Error('Invalid mandate scope'));
      
      await expect(scpDiscoverRequiredFields(mockArgs)).rejects.toThrow('Invalid mandate scope');
      expect(mockLaunchBrowserbaseSession).not.toHaveBeenCalled();
    });

    it('should capture error screenshot on discovery failure', async () => {
      mockDiscoverProgramRequiredFields.mockRejectedValue(new Error('Form not found'));
      
      await expect(scpDiscoverRequiredFields(mockArgs)).rejects.toThrow('SkiClubPro field discovery failed');
      
      expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockSession, 'discovery-failed.png');
      expect(mockCaptureScreenshotEvidence).toHaveBeenCalledWith(
        mockArgs.plan_execution_id,
        expect.any(Buffer),
        'failed-field-discovery'
      );
      expect(mockCloseBrowserbaseSession).toHaveBeenCalledWith(mockSession);
    });

    it('should handle multiple branching scenarios', async () => {
      const complexSchema: FieldSchema = {
        program_ref: 'blackhawk_winter',
        branches: [
          {
            choice: 'Program Type: Nordic',
            questions: [
              {
                id: 'nordic_experience',
                label: 'Nordic Experience',
                type: 'radio',
                required: true,
                options: ['None', 'Some', 'Experienced']
              }
            ]
          },
          {
            choice: 'Program Type: Alpine',
            questions: [
              {
                id: 'alpine_level',
                label: 'Alpine Level',
                type: 'select',
                required: true,
                options: ['Level 1', 'Level 2', 'Level 3']
              }
            ]
          },
          {
            choice: 'Age Group: 6-8',
            questions: [
              {
                id: 'parent_contact',
                label: 'Parent Emergency Contact',
                type: 'text',
                required: true
              }
            ]
          }
        ]
      };
      
      mockDiscoverProgramRequiredFields.mockResolvedValue(complexSchema);
      
      const result = await scpDiscoverRequiredFields(mockArgs);
      
      expect(result).toEqual(complexSchema);
      expect(result.branches).toHaveLength(3);
      expect(result.branches[0].choice).toBe('Program Type: Nordic');
      expect(result.branches[1].choice).toBe('Program Type: Alpine');
      expect(result.branches[2].choice).toBe('Age Group: 6-8');
    });

    it('should validate field types and requirements', async () => {
      const result = await scpDiscoverRequiredFields(mockArgs);
      
      const nordicBranch = result.branches.find(b => b.choice === 'Nordic');
      expect(nordicBranch).toBeDefined();
      
      const nameField = nordicBranch!.questions.find(q => q.id === 'child_name');
      expect(nameField).toEqual({
        id: 'child_name',
        label: 'Child Name',
        type: 'text',
        required: true
      });
      
      const skillField = nordicBranch!.questions.find(q => q.id === 'skill_level');
      expect(skillField).toEqual({
        id: 'skill_level',
        label: 'Skill Level',
        type: 'select',
        required: true,
        options: ['Beginner', 'Intermediate', 'Advanced']
      });
    });
  });
});