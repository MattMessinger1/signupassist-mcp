import type { Page } from "playwright-core";

// Signature for all readiness checkers
export type PageReadinessFn = (page: Page) => Promise<void>;

// Default no-op readiness
export const defaultReadiness: PageReadinessFn = async () => {
  console.log("[Readiness] Default: no waiting required");
};

// The registry
const readinessRegistry: Record<string, PageReadinessFn> = {};

/**
 * Register a readiness function for a provider ID.
 */
export function registerReadiness(providerId: string, fn: PageReadinessFn) {
  readinessRegistry[providerId] = fn;
}

/**
 * Retrieve a readiness function for a provider ID.
 * Falls back to defaultReadiness if none exists,
 * but also logs a visible REMINDER so no one forgets.
 */
export function getReadiness(providerId: string): PageReadinessFn {
  if (!readinessRegistry[providerId]) {
    console.warn(
      `[REMINDER] No page-readiness helper registered for provider '${providerId}'. ` +
      "➡️  Create one under mcp_server/providers/utils/<providerId>Readiness.ts and register it in mcp_server/index.ts."
    );
  }
  return readinessRegistry[providerId] ?? defaultReadiness;
}
