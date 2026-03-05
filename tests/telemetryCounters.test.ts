import { describe, expect, it } from 'vitest';
import { telemetry } from '../mcp_server/lib/telemetry';

describe('telemetry counters', () => {
  it('increments blocked adult signup counter and exposes current value', () => {
    telemetry.clear();

    const first = telemetry.incrementCounter('guardrail.child_scope.blocked_adult_signup_total');
    const second = telemetry.incrementCounter('guardrail.child_scope.blocked_adult_signup_total');

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(telemetry.getCounter('guardrail.child_scope.blocked_adult_signup_total')).toBe(2);
  });
});
