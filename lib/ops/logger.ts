type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const redactedValue = "[REDACTED]";
const sensitiveKeyPatterns = [
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "rawbody",
  "body",
  "payload",
  "html",
  "emailhtml"
];

function isSensitiveKey(key: string) {
  const normalised = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();

  return sensitiveKeyPatterns.some((pattern) => normalised.includes(pattern));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? redactedValue : redactValue(item, seen)
    ])
  );
}

export function redactLogContext(context: LogContext = {}) {
  return redactValue(context, new WeakSet()) as LogContext;
}

export function writeLog(
  level: LogLevel,
  event: string,
  context: LogContext = {}
) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    service: "thunderstrux",
    environment: process.env.NODE_ENV ?? "development",
    ...redactLogContext(context)
  };

  try {
    console[level](JSON.stringify(entry));
  } catch {
    // Operational logging must never affect request or worker behavior.
  }

  return entry;
}

export function logInfo(event: string, context?: LogContext) {
  return writeLog("info", event, context);
}

export function logWarn(event: string, context?: LogContext) {
  return writeLog("warn", event, context);
}

export function logError(event: string, context?: LogContext) {
  return writeLog("error", event, context);
}
