import { redactAuditText } from "./dashboardStatus";

const SENSITIVE_DISCOVERY_KEY_PATTERN =
  /(child|participant|first.?name|last.?name|full.?name|dob|birth|age|grade|email|phone|address|credential|password|token|secret|session|cookie|auth|payment|card|cvv|cvc|medical|allerg|insurance|doctor|waiver|signature|ssn|social)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostOnly(value: unknown) {
  if (typeof value !== "string") return "[redacted url]";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "[redacted url]";
  }
}

export function redactDiscoveryRunDetail(value: unknown, key = "value", depth = 0): unknown {
  if (SENSITIVE_DISCOVERY_KEY_PATTERN.test(key)) return "[redacted]";
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactAuditText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactDiscoveryRunDetail(item, key, depth + 1));
  if (!isRecord(value)) return "[unprintable]";

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => {
      if (childKey.toLowerCase().includes("url")) {
        return [`${childKey}_host`, hostOnly(childValue)];
      }
      return [childKey, redactDiscoveryRunDetail(childValue, childKey, depth + 1)];
    }),
  );
}
