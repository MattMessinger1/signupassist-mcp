import { beforeEach, describe, expect, it, vi } from 'vitest';

const delegateProfileMaybeSingle = vi.fn();
const delegateUpsertSingle = vi.fn();
const childMaybeSingle = vi.fn();
const childInsertSingle = vi.fn();
const childUpdateSingle = vi.fn();

vi.mock('../middleware/audit.js', () => ({
  auditToolCall: vi.fn(async (_ctx: any, _args: any, handler: () => Promise<any>) => handler())
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'delegate_profiles') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          maybeSingle: delegateProfileMaybeSingle,
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({ single: delegateUpsertSingle }))
          }))
        };
        return chain;
      }

      if (table === 'children') {
        const selectChain: any = {
          eq: vi.fn(() => selectChain),
          maybeSingle: childMaybeSingle,
          order: vi.fn(() => ({ data: [], error: null }))
        };

        const updateChain: any = {
          eq: vi.fn(() => updateChain),
          select: vi.fn(() => ({ single: childUpdateSingle }))
        };

        return {
          select: vi.fn(() => selectChain),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({ single: childInsertSingle }))
          })),
          update: vi.fn(() => updateChain)
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }
  }))
}));

import { userTools } from '../providers/user.js';

describe('user provider parental consent and age guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  it('rejects delegate profile updates when delegate is under 18', async () => {
    const tool = userTools.find((t) => t.name === 'user.update_delegate_profile');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      user_id: 'user-1',
      date_of_birth: '2012-01-01',
      first_name: 'Teen',
      last_name: 'Parent',
      parental_consent: true
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(delegateUpsertSingle).not.toHaveBeenCalled();
  });

  it('blocks child writes when parental consent is missing', async () => {
    delegateProfileMaybeSingle.mockResolvedValue({
      data: { user_id: 'user-1', parental_consent: false },
      error: null
    });

    const tool = userTools.find((t) => t.name === 'user.update_child');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      user_id: 'user-1',
      child_id: 'child-1',
      first_name: 'Updated'
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PARENTAL_CONSENT_REQUIRED');
    expect(childUpdateSingle).not.toHaveBeenCalled();
  });

  it('allows child writes when parental consent is true', async () => {
    delegateProfileMaybeSingle.mockResolvedValue({
      data: { user_id: 'user-1', parental_consent: true, first_name: 'Parent', last_name: 'One', date_of_birth: '1980-01-01' },
      error: null
    });
    childInsertSingle.mockResolvedValue({
      data: {
        id: 'child-1',
        user_id: 'user-1',
        first_name: 'Kid',
        last_name: 'One',
        dob: '2016-01-01',
        created_at: new Date().toISOString()
      },
      error: null
    });

    const tool = userTools.find((t) => t.name === 'user.create_child');
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      user_id: 'user-1',
      first_name: 'Kid',
      last_name: 'One',
      dob: '2016-01-01'
    });

    expect(result.success).toBe(true);
    expect(result.data?.child?.id).toBe('child-1');
  });
});
