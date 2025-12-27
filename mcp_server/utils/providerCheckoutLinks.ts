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

  // Bookeo: public booking/checkout entry point is by product/program_ref.
  // We include lightweight attribution params and orgRef for debugging.
  if (provider === "bookeo") {
    const url = new URL(`https://bookeo.com/book/${program_ref}`);
    url.searchParams.set("ref", "signupassist");
    url.searchParams.set("utm_source", "chatgpt_app");
    url.searchParams.set("utm_medium", "mcp");
    url.searchParams.set("org", org_ref);
    return url.toString();
  }

  // Unknown provider: no known provider-hosted checkout URL.
  return null;
}


