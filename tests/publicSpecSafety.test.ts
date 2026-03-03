import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(readFileSync('mcp/openapi.json', 'utf8'));
const manifest = JSON.parse(readFileSync('mcp/manifest.json', 'utf8'));

describe('Public OpenAPI review safety', () => {
  it('excludes internal MCP transport and direct tool-call paths', () => {
    const paths = Object.keys(openapi.paths || {});
    expect(paths).not.toContain('/tools/call');
    expect(paths).not.toContain('/messages');
    expect(paths).not.toContain('/sse');
  });

  it('does not expose adult-attendee wording in public schema text', () => {
    const serialized = JSON.stringify(openapi).toLowerCase();
    expect(serialized).not.toContain('number of adults attending');
    expect(serialized).not.toContain('"adults"');
  });

  it('includes explicit family-safe positioning in OpenAPI description', () => {
    const description = String(openapi?.info?.description || '').toLowerCase();
    expect(description).toContain('family-safe');
    expect(description).toContain('does not provide adult');
    expect(description).toContain('no external action before');
  });
});

describe('Manifest review safety language', () => {
  it('declares minors-only/family-safe scope', () => {
    const human = String(manifest.description_for_human || '').toLowerCase();
    const model = String(manifest.description_for_model || '').toLowerCase();

    expect(human).toContain('family-safe');
    expect(human).toContain('no adult');
    expect(model).toContain('children');
    expect(model).toContain('do not treat this app as adult content');
    expect(model).toContain('nothing is booked or charged until explicit user confirmation');
  });
});
