/**
 * Debug logging utilities for chat test harness
 * Provides structured logging with different levels and categories
 */

export type LogLevel = "info" | "success" | "error" | "warning" | "debug";
export type LogCategory = "user" | "tool" | "assistant" | "system" | "mcp" | "orchestrator" | "test" | "tone";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
}

/**
 * Mask sensitive data in objects (passwords, tokens, etc.)
 */
export function maskSensitiveData(data: any): any {
  if (!data || typeof data !== "object") return data;

  const sensitiveKeys = ["password", "token", "secret", "api_key", "apiKey"];
  const masked = { ...data };

  for (const key in masked) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      masked[key] = "****";
    } else if (typeof masked[key] === "object") {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }

  return masked;
}

/**
 * Format data for logging (truncate if too long)
 */
export function formatLogData(data: any, maxLength = 500): string {
  if (!data) return "";
  
  const str = typeof data === "string" 
    ? data 
    : JSON.stringify(maskSensitiveData(data), null, 2);
  
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + "... (truncated)";
  }
  
  return str;
}

/**
 * Create a log entry
 */
export function createLogEntry(
  level: LogLevel,
  category: LogCategory,
  message: string,
  data?: any
): LogEntry {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    level,
    category,
    message,
    data: data ? maskSensitiveData(data) : undefined,
  };

  // Also log to browser console
  const consoleMethod = level === "error" ? "error" : level === "warning" ? "warn" : "log";
  const prefix = `[${category.toUpperCase()}]`;
  
  if (data) {
    console[consoleMethod](prefix, message, maskSensitiveData(data));
  } else {
    console[consoleMethod](prefix, message);
  }

  return entry;
}
