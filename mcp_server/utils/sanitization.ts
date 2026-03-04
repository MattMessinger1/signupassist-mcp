const MASK = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  'first_name', 'firstname', 'first-name',
  'last_name', 'lastname', 'last-name',
  'full_name', 'fullname',
  'participant_name', 'participant_names', 'participantname',
  'child_name', 'delegate_name',
  'dob', 'date_of_birth', 'dateofbirth', 'birth_date', 'birthday',
  'email', 'phone',
  'password', 'token', 'secret', 'api_key', 'apikey', 'authorization',
  'credential', 'card', 'ssn',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function isSensitiveKeyName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes(normalizedPattern);
  });
}

export function sanitizeForLogs<T>(value: T, depth = 0): T {
  if (depth > 12) return '[DEPTH_LIMIT]' as T;

  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item, depth + 1)) as T;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKeyName(key)) {
        result[key] = MASK;
      } else {
        result[key] = sanitizeForLogs(nested, depth + 1);
      }
    }
    return result as T;
  }

  return value;
}
