import { describe, it, expect } from 'vitest';

/**
 * Compute SHA-256 hash
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute form fingerprint from URL path and DOM signature
 */
async function computeFormFingerprint(url: string, domSignature: string[]): Promise<string> {
  const urlObj = new URL(url);
  const path = urlObj.pathname; // no query params
  const sortedSignature = domSignature.sort().join('|');
  const combined = `${path}::${sortedSignature}`;
  return await sha256(combined);
}

describe('computeFormFingerprint', () => {
  it('should produce stable hash for same inputs', async () => {
    const url = 'https://example.com/register';
    const domSignature = ['input[name=email]', 'input[name=password]', 'input[name=username]'];
    
    const hash1 = await computeFormFingerprint(url, domSignature);
    const hash2 = await computeFormFingerprint(url, domSignature);
    
    expect(hash1).toBe(hash2);
  });

  it('should be order-insensitive for DOM signatures', async () => {
    const url = 'https://example.com/form';
    
    const signature1 = ['input[name=a]', 'input[name=b]', 'input[name=c]'];
    const signature2 = ['input[name=c]', 'input[name=a]', 'input[name=b]'];
    const signature3 = ['input[name=b]', 'input[name=c]', 'input[name=a]'];
    
    const hash1 = await computeFormFingerprint(url, signature1);
    const hash2 = await computeFormFingerprint(url, signature2);
    const hash3 = await computeFormFingerprint(url, signature3);
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should ignore query parameters in URL', async () => {
    const signature = ['input[name=field]'];
    
    const hash1 = await computeFormFingerprint('https://example.com/form', signature);
    const hash2 = await computeFormFingerprint('https://example.com/form?id=123', signature);
    const hash3 = await computeFormFingerprint('https://example.com/form?session=abc&user=xyz', signature);
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should produce different hashes for different paths', async () => {
    const signature = ['input[name=field]'];
    
    const hash1 = await computeFormFingerprint('https://example.com/form1', signature);
    const hash2 = await computeFormFingerprint('https://example.com/form2', signature);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes for different DOM signatures', async () => {
    const url = 'https://example.com/form';
    
    const hash1 = await computeFormFingerprint(url, ['input[name=a]', 'input[name=b]']);
    const hash2 = await computeFormFingerprint(url, ['input[name=a]', 'input[name=c]']);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty DOM signature', async () => {
    const url = 'https://example.com/form';
    
    const hash1 = await computeFormFingerprint(url, []);
    const hash2 = await computeFormFingerprint(url, []);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters
  });

  it('should produce valid SHA-256 hash format', async () => {
    const url = 'https://example.com/test';
    const signature = ['input[name=test]'];
    
    const hash = await computeFormFingerprint(url, signature);
    
    // SHA-256 hash should be 64 hexadecimal characters
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle complex selectors in signature', async () => {
    const url = 'https://example.com/complex';
    const signature = [
      'input[name="child[first_name]"]',
      'select[aria-label="Skill Level"]',
      'textarea[id="special-needs"]',
      'input[type="email"][required]',
    ];
    
    const hash1 = await computeFormFingerprint(url, signature);
    const hash2 = await computeFormFingerprint(url, [...signature].reverse());
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});
