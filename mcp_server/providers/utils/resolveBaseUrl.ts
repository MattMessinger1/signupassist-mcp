// mcp_server/providers/utils/resolveBaseUrl.ts
const ORG_DOMAINS: Record<string, string> = {
  "blackhawk-ski-club": "blackhawk.skiclubpro.team",
  // add others here as needed
};

export function resolveBaseUrl(orgRef: string): string {
  const raw = ORG_DOMAINS[orgRef] || orgRef; // allow passing a full domain in testing
  const domain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/\.skiclubpro\.team\.skiclubpro\.team$/i, ".skiclubpro.team"); // dedupe safety
  return `https://${domain}`;
}
