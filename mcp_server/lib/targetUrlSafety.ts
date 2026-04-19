import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface TargetUrlValidationResult {
  ok: boolean;
  normalizedUrl: string | null;
  hostname: string | null;
  reason: string | null;
}

export type TargetUrlResolver = (hostname: string) => Promise<string[]>;

export interface TargetUrlValidationOptions {
  environment?: string;
  allowHttpInNonProduction?: boolean;
  allowLocalhostInNonProduction?: boolean;
  allowedProviderDomains?: string[];
}

const INTERNAL_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
];

function fail(reason: string, hostname: string | null = null): TargetUrlValidationResult {
  return {
    ok: false,
    normalizedUrl: null,
    hostname,
    reason,
  };
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function ipv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return null;
  }
  return octets;
}

export function isUnsafeIpAddress(value: string): boolean {
  const hostname = stripIpv6Brackets(value).toLowerCase();
  const ipVersion = isIP(hostname);

  if (ipVersion === 4) {
    const octets = ipv4Octets(hostname);
    if (!octets) return true;
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    if (hostname === "::" || hostname === "::1") return true;
    if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(hostname)) return true;
    if (hostname.startsWith("::ffff:")) {
      const mappedIpv4 = hostname.slice("::ffff:".length);
      return isUnsafeIpAddress(mappedIpv4);
    }
  }

  return false;
}

function isInternalHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (!lower) return true;
  if (lower === "localhost") return true;
  if (lower === "metadata.google.internal") return true;
  if (lower === "169.254.169.254") return true;
  if (!lower.includes(".")) return true;
  return INTERNAL_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isProductionEnvironment(options: TargetUrlValidationOptions = {}) {
  return String(options.environment ?? process.env.NODE_ENV ?? "development").toLowerCase() === "production";
}

function isLocalhostTarget(hostname: string) {
  const lower = stripIpv6Brackets(hostname).toLowerCase();
  return lower === "localhost" || lower === "::1" || lower === "127.0.0.1";
}

function normalizeAllowedDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^\.+/, "");
  }
}

function hostMatchesAllowedDomain(hostname: string, allowedDomains: string[]) {
  const normalizedAllowed = allowedDomains.map(normalizeAllowedDomain).filter(Boolean);
  if (normalizedAllowed.length === 0) return true;
  return normalizedAllowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function validateTargetUrl(
  value: unknown,
  options: TargetUrlValidationOptions = {},
): TargetUrlValidationResult {
  if (typeof value !== "string" || !value.trim()) {
    return fail("url_required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return fail("url_invalid");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("url_protocol_not_allowed");
  }

  const isProduction = isProductionEnvironment(options);
  const httpAllowed =
    parsed.protocol === "https:" ||
    (!isProduction && options.allowHttpInNonProduction !== false);
  if (!httpAllowed) {
    return fail("url_https_required");
  }

  if (parsed.username || parsed.password) {
    return fail("url_userinfo_not_allowed");
  }

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();
  const localDevAllowed =
    !isProduction &&
    options.allowLocalhostInNonProduction === true &&
    isLocalhostTarget(hostname);

  if (!localDevAllowed) {
    if (isIP(hostname) && isUnsafeIpAddress(hostname)) {
      return fail("url_private_ip_not_allowed", hostname);
    }

    if (isInternalHostname(hostname)) {
      return fail("url_internal_hostname_not_allowed", hostname);
    }
  }

  if (!hostMatchesAllowedDomain(hostname, options.allowedProviderDomains ?? [])) {
    return fail("url_provider_domain_not_allowed", hostname);
  }

  parsed.hash = "";

  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    hostname,
    reason: null,
  };
}

export function validateTargetUrlRedirectChain(
  urls: unknown[],
  options: TargetUrlValidationOptions = {},
): TargetUrlValidationResult {
  if (!Array.isArray(urls) || urls.length === 0) {
    return fail("redirect_chain_required");
  }

  for (const url of urls) {
    const result = validateTargetUrl(url, options);
    if (!result.ok) {
      return fail(`redirect_${result.reason ?? "url_invalid"}`, result.hostname);
    }
  }

  return validateTargetUrl(urls[urls.length - 1], options);
}

async function defaultResolver(hostname: string) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function validateTargetUrlWithResolvedIps(
  value: unknown,
  resolver: TargetUrlResolver = defaultResolver,
  options: TargetUrlValidationOptions = {},
): Promise<TargetUrlValidationResult> {
  const result = validateTargetUrl(value, options);
  if (!result.ok || !result.hostname) return result;

  if (isIP(result.hostname)) return result;

  let addresses: string[];
  try {
    addresses = await resolver(result.hostname);
  } catch {
    return fail("dns_resolution_failed", result.hostname);
  }

  if (addresses.length === 0) return fail("dns_resolution_empty", result.hostname);
  if (addresses.some((address) => isUnsafeIpAddress(address))) {
    return fail("dns_resolved_private_ip_not_allowed", result.hostname);
  }

  return result;
}

export function safeTargetUrlHost(value: string | null | undefined): string | null {
  const result = validateTargetUrl(value);
  return result.ok ? result.hostname : null;
}
