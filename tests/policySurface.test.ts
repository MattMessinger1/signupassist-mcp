import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('mcp/manifest.json', 'utf8'));
const mcpManifest = JSON.parse(readFileSync('public/.well-known/chatgpt-apps-manifest.json', 'utf8'));
const safetyPolicy = readFileSync('docs/SAFETY_POLICY.md', 'utf8').toLowerCase();
const privacyPolicy = readFileSync('docs/PRIVACY_POLICY.md', 'utf8').toLowerCase();
const terms = readFileSync('docs/TERMS_OF_USE.md', 'utf8').toLowerCase();

describe('Policy surface for app review', () => {
  it('has safety policy doc with required classification markers', () => {
    expect(existsSync('docs/SAFETY_POLICY.md')).toBe(true);
    expect(safetyPolicy).toContain('family-safe');
    expect(safetyPolicy).toContain('sexual content');
    expect(safetyPolicy).toContain('dating');
    expect(safetyPolicy).toContain('no booking or payment is executed until explicit user confirmation');
  });

  it('manifests point legal_info_url to /safety', () => {
    expect(String(manifest.legal_info_url || '')).toContain('/safety');
    expect(String(mcpManifest.legal_info_url || '')).toContain('/safety');
  });

  it('privacy and terms docs include child/delegate framing', () => {
    expect(privacyPolicy).toContain('responsible delegate');
    expect(privacyPolicy).toContain('children');
    expect(terms).toContain('acceptable use policy');
  });

  it('has reviewer brief', () => {
    expect(existsSync('docs/review/app-review-brief.md')).toBe(true);
  });
});
