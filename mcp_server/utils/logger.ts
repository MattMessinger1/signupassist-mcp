/**
 * Secure logging utility with automatic PII redaction
 * Provides structured logging with timestamps and sensitive data protection
 */

// Keys that should always be redacted
const SENSITIVE_KEYS = [
  'email', 'phone', 'password', 'token', 'secret', 'ssn', 'card',
  'credit', 'api_key', 'apiKey', 'authorization', 'credential',
  'dob', 'dateOfBirth', 'date_of_birth', 'birth', 'social',
];

// Patterns to detect and redact in string values
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
const SSN_REGEX = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g;
const CARD_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

/**
 * Check if a key name indicates sensitive data
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEYS.some(sk => lowerKey.includes(sk.toLowerCase()));
}

/**
 * Redact sensitive patterns from a string value
 */
function redactPatterns(value: string): string {
  return value
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(PHONE_REGEX, '[PHONE_REDACTED]')
    .replace(SSN_REGEX, '[SSN_REDACTED]')
    .replace(CARD_REGEX, '[CARD_REDACTED]');
}

/**
 * Recursively redact sensitive data from any value
 */
function redactValue(value: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) return '[DEPTH_LIMIT]';
  
  if (value === null || value === undefined) {
    return value;
  }
  
  if (typeof value === 'string') {
    return redactPatterns(value);
  }
  
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }
  
  if (typeof value === 'object') {
    return redactPayload(value as Record<string, unknown>, depth + 1);
  }
  
  return value;
}

/**
 * Redact sensitive data from an object payload
 * Handles nested objects and arrays
 */
export function redactPayload(payload: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 10) return { _redacted: '[DEPTH_LIMIT]' };
  
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactValue(value, depth);
    }
  }
  
  return result;
}

/**
 * Format log entry as structured JSON
 */
function formatLogEntry(level: string, message: string, payload?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    level,
    ts: new Date().toISOString(),
    msg: redactPatterns(message),
  };
  
  if (payload) {
    entry.data = redactPayload(payload);
  }
  
  return JSON.stringify(entry);
}

/**
 * Logger with automatic PII redaction
 * All log methods automatically redact sensitive data
 */
export default class Logger {
  /**
   * Log informational message
   */
  static info(message: string, payload?: Record<string, unknown>) {
    console.log(formatLogEntry('info', message, payload));
  }
  
  /**
   * Log warning message
   */
  static warn(message: string, payload?: Record<string, unknown>) {
    console.warn(formatLogEntry('warn', message, payload));
  }
  
  /**
   * Log error message
   */
  static error(message: string, payload?: Record<string, unknown>) {
    console.error(formatLogEntry('error', message, payload));
  }
  
  /**
   * Log debug message (only in development)
   */
  static debug(message: string, payload?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV === 'development') {
      console.log(formatLogEntry('debug', message, payload));
    }
  }
  
  /**
   * Create a child logger with default context
   */
  static withContext(context: Record<string, unknown>) {
    const safeContext = redactPayload(context);
    return {
      info: (message: string, payload?: Record<string, unknown>) => 
        Logger.info(message, { ...safeContext, ...payload }),
      warn: (message: string, payload?: Record<string, unknown>) => 
        Logger.warn(message, { ...safeContext, ...payload }),
      error: (message: string, payload?: Record<string, unknown>) => 
        Logger.error(message, { ...safeContext, ...payload }),
      debug: (message: string, payload?: Record<string, unknown>) => 
        Logger.debug(message, { ...safeContext, ...payload }),
    };
  }
}

/**
 * Utility function for safe logging without Logger class
 * Use when you need standalone redaction
 */
export function safeLog(event: string, payload: Record<string, unknown>) {
  console.log(formatLogEntry('info', event, payload));
}

/**
 * Export redaction utilities for use in other modules
 */
export { redactPatterns, isSensitiveKey };
