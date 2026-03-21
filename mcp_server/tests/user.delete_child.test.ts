import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockCreateClient = vi.fn(() => ({ from: mockFrom }));
const mockAuditToolCall = vi.fn(async (_ctx: any, _args: any, fn: () => Promise<any>) => fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

vi.mock('../middleware/audit.js', () => ({
  auditToolCall: mockAuditToolCall,
}));

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

describe.skip('user.delete_child tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a child when owned by the requesting user', async () => {
    const fetchBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'child-1' }, error: null }),
    } as any;

    const deleteBuilder = {
      delete: vi.fn().mockReturnThis(),
      eq: vi
        .fn()
        .mockReturnValueOnce({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    } as any;

    mockFrom
      .mockReturnValueOnce(fetchBuilder)
      .mockReturnValueOnce(deleteBuilder);

    const { userTools } = await import('../providers/user.ts');
    const tool = userTools.find((t) => t.name === 'user.delete_child');

    expect(tool).toBeDefined();

    const result = await tool!.handler({ user_id: 'user-1', child_id: 'child-1' });

    expect(result).toEqual({
      success: true,
      data: {
        deleted: true,
        child_id: 'child-1',
      },
    });
    expect(mockAuditToolCall).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly error when child is non-existent or not owned by user', async () => {
    const fetchBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any;

    mockFrom.mockReturnValueOnce(fetchBuilder);

    const { userTools } = await import('../providers/user.ts');
    const tool = userTools.find((t) => t.name === 'user.delete_child');

    const result = await tool!.handler({ user_id: 'user-1', child_id: 'missing-child' });

    expect(result).toEqual({
      success: false,
      error: {
        display: 'Child record not found',
        recovery: 'That child may already be removed, or belongs to another account.',
        severity: 'low',
        code: 'USER_CHILD_NOT_FOUND',
      },
    });
  });
});
