import { describe, expect, it } from 'vitest';

import { parseRequestUrl } from './requestUrl.js';

describe('parseRequestUrl', () => {
  it('parses normal origin-form request targets', () => {
    const url = parseRequestUrl('/health?full=1', 8080);

    expect(url?.pathname).toBe('/health');
    expect(url?.searchParams.get('full')).toBe('1');
  });

  it('uses the root path when the request target is absent', () => {
    expect(parseRequestUrl(undefined, 8080)?.pathname).toBe('/');
  });

  it.each([
    '//',
    '//scanner.example/path',
    'https://scanner.example/path',
    'not-a-path',
  ])('rejects invalid request target %s without throwing', (target) => {
    expect(() => parseRequestUrl(target, 8080)).not.toThrow();
    expect(parseRequestUrl(target, 8080)).toBeNull();
  });
});
