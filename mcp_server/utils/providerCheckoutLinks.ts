/**
 * Provider checkout/deep-link helpers (provider is merchant-of-record for program fees).
 *
 * These are user-facing links (not API endpoints). They are safe to show in UI.
 */

export function getProviderCheckoutUrl(args: {
  provider: string;
  org_ref: string;
  program_ref: string;
  booking_number?: string;
}): string | null {
  const { provider, org_ref, program_ref } = args;

  // Bookeo:
  // We previously attempted to fabricate `https://bookeo.com/book/{program_ref}` links.
  // That URL pattern 404s on bookeo.com/www.bookeo.com and is NOT a stable public checkout URL.
  //
  // Bookeo's API does not expose a canonical user-facing checkout link; providers typically embed
  // Bookeo widgets on their own website. Prefer a provider-configured URL or business website URL
  // fetched via `/settings/business`.
  if (provider === "bookeo") {
    void org_ref;
    void program_ref;
    return null;
  }

  // Unknown provider: no known provider-hosted checkout URL.
  return null;
}


