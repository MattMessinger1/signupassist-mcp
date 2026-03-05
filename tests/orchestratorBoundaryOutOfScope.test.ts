import { describe, expect, it } from 'vitest';
import {
  buildChildScopeOutOfScopeResponse,
  evaluateChildRegistrationScope,
} from '../mcp_server/lib/childScopeGuardrail';

describe('orchestrator boundary out-of-scope envelope', () => {
  it('returns an outOfScope response object for blocked adult signup requests', () => {
    const scopeDecision = evaluateChildRegistrationScope({
      message: 'Please register me for adult swimming lessons.',
      payload: null,
    });

    expect(scopeDecision.blocked).toBe(true);

    const response = buildChildScopeOutOfScopeResponse();
    expect(response).toEqual(
      expect.objectContaining({
        message: expect.any(String),
        metadata: expect.objectContaining({
          outOfScope: true,
          suppressWizardHeader: true,
          reason: 'adult_signup_request',
        }),
        context: expect.objectContaining({
          step: 'BROWSE',
        }),
      }),
    );
  });
});
