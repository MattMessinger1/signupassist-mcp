// mcp_server/providers/utils/resolveBaseUrl.ts
const ORG_DOMAINS: Record<string, string> = {
  // add orgRef -> hostname mappings here when needed
};

export function resolveBaseUrl(orgRef: string): string {
  const raw = ORG_DOMAINS[orgRef] || orgRef;
  const domain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${domain}`;
}
