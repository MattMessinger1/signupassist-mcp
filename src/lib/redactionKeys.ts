const SAFE_PUBLIC_NAME_KEYS = new Set([
  "activity_name",
  "activityname",
  "business_name",
  "businessname",
  "class_name",
  "classname",
  "company_name",
  "companyname",
  "course_name",
  "coursename",
  "organization_name",
  "organizationname",
  "org_name",
  "orgname",
  "program_name",
  "programname",
  "provider_name",
  "providername",
  "venue_name",
  "venuename",
]);

const SENSITIVE_KEY_PATTERN =
  /(child|participant|first.?name|last.?name|full.?name|parent.?name|guardian.?name|contact.?name|emergency.?contact.?name|account.?holder.?name|dob|birth|age|grade|email|phone|address|credential|password|token|secret|session|cookie|auth|payment|card|cvv|cvc|medical|allerg|insurance|doctor|waiver|signature|ssn|social)/i;

const GENERIC_NAME_KEY_PATTERN = /(^|[_-])(name|label|title)($|[_-])/i;

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitiveRedactionKey(key: string) {
  const normalized = normalizedKey(key);
  if (SAFE_PUBLIC_NAME_KEYS.has(normalized)) return false;
  return SENSITIVE_KEY_PATTERN.test(key) || GENERIC_NAME_KEY_PATTERN.test(key);
}
