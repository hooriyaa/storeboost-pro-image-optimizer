// modified-2026-09-16
/**
 * Structured logger for StoreBoost Pro.
 * Never logs secrets, access tokens, or sensitive credentials.
 */

enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

interface LogContext {
  [key: string]: unknown;
}

const SENSITIVE_KEYS = [
  "accessToken",
  "token",
  "secret",
  "password",
  "apiKey",
  "cookie",
  "authorization",
  "sessionToken",
];

function sanitizeContext(ctx: LogContext): LogContext {
  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "storeboost-pro",
    ...(context ? sanitizeContext(context) : {}),
  };

  const output = JSON.stringify(entry);

  if (level === LogLevel.ERROR || level === LogLevel.WARN) {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    log(LogLevel.DEBUG, message, context),
  info: (message: string, context?: LogContext) =>
    log(LogLevel.INFO, message, context),
  warn: (message: string, context?: LogContext) =>
    log(LogLevel.WARN, message, context),
  error: (message: string, context?: LogContext) =>
    log(LogLevel.ERROR, message, context),
};
