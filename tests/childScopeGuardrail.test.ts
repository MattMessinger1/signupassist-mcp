import { describe, expect, it } from 'vitest';
import {
  evaluateChildRegistrationScope,
  getChildScopeBlockedMessage,
} from '../mcp_server/lib/childScopeGuardrail';

describe('child scope guardrail', () => {
  it('blocks adult-only signup messages', () => {
    const result = evaluateChildRegistrationScope({
      message: 'Can you register me for adult tennis lessons this weekend?',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('adult_signup_request');
  });

  it('does not block child signup messages', () => {
    const result = evaluateChildRegistrationScope({
      message: 'Help me register my child for robotics camp in Madison',
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks adult audience from payload metadata', () => {
    const result = evaluateChildRegistrationScope({
      message: 'show options',
      payload: { audience: 'adults' },
    });
    expect(result.blocked).toBe(true);
  });

  it('returns a clear out-of-scope message', () => {
    const msg = getChildScopeBlockedMessage().toLowerCase();
    expect(msg).toContain('child activity registration');
    expect(msg).toContain('adult-only signup requests');
    expect(msg).toContain('register directly with the provider');
  });
});
