/**
 * Resolves relative or partial URLs to absolute SkiClubPro URLs
 * 
 * Handles:
 * - Already absolute URLs (pass through)
 * - Leading slash paths: /registration/310 → https://blackhawk.skiclubpro.team/registration/310
 * - Relative paths: registration/310/start → https://blackhawk.skiclubpro.team/registration/310/start
 * 
 * @param orgRef - Organization reference (e.g. "blackhawk-ski-club")
 * @param href - URL or path to resolve
 * @returns Absolute HTTPS URL
 * @throws Error if href is null/undefined
 */
export function resolveSkiClubProUrl(orgRef: string, href: string | null | undefined): string {
  if (!href) {
    throw new Error(`resolveSkiClubProUrl: href is required for org ${orgRef}`);
  }

  const trimmed = href.trim();

  // Already absolute - return as-is
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Check for custom domain override (Blackhawk uses blackhawk.skiclubpro.team)
  let baseUrl: string;
  if (orgRef === 'blackhawk-ski-club') {
    baseUrl = 'https://blackhawk.skiclubpro.team';
  } else {
    // Normalize orgRef into subdomain (remove special chars except hyphens)
    const subdomain = orgRef.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    baseUrl = `https://${subdomain}.skiclubpro.team`;
  }

  // Leading slash → append as path
  if (trimmed.startsWith('/')) {
    return `${baseUrl}${trimmed}`;
  }

  // No leading slash → add one
  return `${baseUrl}/${trimmed}`;
}
