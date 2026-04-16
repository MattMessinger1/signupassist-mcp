import { findPlaybookForUrl, type ProviderPlaybook } from "./playbooks";

const FINAL_ACTION_WORDS = [
  "submit",
  "register",
  "complete registration",
  "checkout",
  "place order",
  "pay",
  "purchase",
  "confirm purchase",
  "confirm registration",
  "finish registration",
  "enroll",
];

const SAFE_NAVIGATION_WORDS = [
  "next",
  "continue",
  "save and continue",
  "review",
  "go to cart",
  "add participant",
  "select participant",
];

const SENSITIVE_FIELD_WORDS = [
  "allergy",
  "allergies",
  "medical",
  "medication",
  "medicine",
  "diagnosis",
  "doctor",
  "physician",
  "insurance",
  "policy number",
  "disability",
  "special needs",
  "iep",
  "504",
  "epi",
  "epipen",
  "health",
  "social security",
  "ssn",
  "credit card",
  "card number",
  "cardholder",
  "expiration",
  "expiry",
  "security code",
  "billing",
  "cvv",
  "cvc",
];

const SOLD_OUT_WORDS = [
  "sold out",
  "waitlist",
  "waiting list",
  "unavailable",
  "no seats",
  "no spots",
  "closed",
];

export type ButtonClassification = {
  kind: "safe_navigation" | "forbidden_final" | "unknown";
  reason: string;
};

export function normalizeAutopilotText(value?: string | null) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isSensitiveField(labelParts: Array<string | null | undefined>) {
  const text = normalizeAutopilotText(labelParts.filter(Boolean).join(" "));
  return SENSITIVE_FIELD_WORDS.some((word) => text.includes(word));
}

export function classifyButtonAction(
  textValue?: string | null,
  attributes: { type?: string | null; ariaLabel?: string | null } = {},
): ButtonClassification {
  const visibleText = normalizeAutopilotText(
    [textValue, attributes.ariaLabel].filter(Boolean).join(" "),
  );
  const buttonType = normalizeAutopilotText(attributes.type);
  const text = visibleText || buttonType;

  if (!text) {
    return {
      kind: "unknown",
      reason: "Button has no readable label",
    };
  }

  if (visibleText && FINAL_ACTION_WORDS.some((word) => visibleText.includes(word))) {
    return {
      kind: "forbidden_final",
      reason: "Final registration or payment action requires parent approval",
    };
  }

  if (visibleText && SAFE_NAVIGATION_WORDS.some((word) => visibleText === word || visibleText.includes(word))) {
    return {
      kind: "safe_navigation",
      reason: "Safe non-final navigation",
    };
  }

  if (buttonType === "submit") {
    return {
      kind: "unknown",
      reason: "Submit button needs visible context before it can be treated as safe",
    };
  }

  return {
    kind: "unknown",
    reason: "Button meaning is not confidently known",
  };
}

export function detectSoldOutState(pageText?: string | null) {
  const text = normalizeAutopilotText(pageText);
  return SOLD_OUT_WORDS.some((word) => text.includes(word));
}

export function evaluatePriceCap(totalCents: number | null | undefined, capCents: number | null | undefined) {
  if (typeof totalCents !== "number" || typeof capCents !== "number") {
    return {
      ok: true,
      reason: "No price cap comparison available",
    };
  }

  if (totalCents > capCents) {
    return {
      ok: false,
      reason: `Price ${totalCents} exceeds cap ${capCents}`,
    };
  }

  return {
    ok: true,
    reason: "Price is within cap",
  };
}

export function detectProviderMismatch(targetUrl: string, expectedPlaybook: ProviderPlaybook) {
  const detected = findPlaybookForUrl(targetUrl);

  if (expectedPlaybook.key === "generic" || detected.key === "generic") {
    return false;
  }

  return detected.key !== expectedPlaybook.key;
}

export function buildAutopilotAuditEvent(type: string, details: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    source: "web",
    type,
    details,
  };
}
