export function parseRequestUrl(
  requestTarget: string | undefined,
  port: number
): URL | null {
  const target = requestTarget || '/';

  // Railway forwards origin-form targets. Reject scheme-relative and absolute
  // targets so scanner traffic cannot escape the request handler as an error.
  if (!target.startsWith('/') || target.startsWith('//')) {
    return null;
  }

  try {
    return new URL(target, `http://localhost:${port}`);
  } catch {
    return null;
  }
}
