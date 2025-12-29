// mcp_server/prereqs/providers.ts
// API-first only: scraping-based providers (SkiClubPro/Browserbase) are deprecated.

export function getOrgOverride(_orgRef: string) {
  return {};
}

export function registerAllProviders() {
  // No-op for v1 (Bookeo is API-based and does not require prereq checkers).
  // Future API providers can register here if needed.
}
