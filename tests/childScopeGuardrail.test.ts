import { describe, expect, it } from 'vitest';
import {
  buildChildScopeOutOfScopeResponse,
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
    expect(result.reason).toBe('adult_signup_request');
  });


  it('blocks adult-only signup requests in another language', () => {
    const result = evaluateChildRegistrationScope({
      message: 'Por favor, inscribirme en clases para adultos de natación.',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('adult_signup_request');
  });

  it('does not block mixed child + adult context when child intent is present', () => {
    const result = evaluateChildRegistrationScope({
      message: 'Bitte anmelden für Erwachsene und auch mein Kind für Schwimmkurs.',
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks obfuscated adult signup phrasing', () => {
    const result = evaluateChildRegistrationScope({
      message: 'Can you s.i.g.n-u.p me for a d u l t yoga?',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('adult_signup_request');
  });
  it('does not block mixed-language messages that include child cues', () => {
    const result = evaluateChildRegistrationScope({
      message: '¿Puedes registrarme para adultos y también para mi hijo en clases de tenis?',
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks payload-only adult requests without signup-intent text', () => {
    const result = evaluateChildRegistrationScope({
      message: 'show me classes',
      payload: { requestedAudience: 'adult' },
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('adult_signup_request');
  });

  it('avoids false positives for adult references without signup intent', () => {
    const result = evaluateChildRegistrationScope({
      message: 'I am an adult looking for information about youth ski programs.',
    });
    expect(result.blocked).toBe(false);
  });

  it('returns a clear out-of-scope message', () => {
    const msg = getChildScopeBlockedMessage().toLowerCase();
    expect(msg).toContain('child activity registration');
    expect(msg).toContain('adult-only signup requests');
    expect(msg).toContain('register directly with the provider');
  });

  it('builds an out-of-scope response envelope with outOfScope=true', () => {
    const response = buildChildScopeOutOfScopeResponse();
    expect(response.metadata.outOfScope).toBe(true);
    expect(response.metadata.suppressWizardHeader).toBe(true);
    expect(response.metadata.reason).toBe('adult_signup_request');
    expect(response.context.step).toBe('BROWSE');
    expect(response.message).toContain('SignupAssist is focused on parent/guardian-managed child activity registration.');
  });
});
