import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { NextResponse } from "next/server";
import { serviceUnavailable, tooManyRequests } from "@/lib/api/errors";

const TOO_MANY_REQUESTS_MESSAGE = "Too many requests. Please try again later.";
const PROTECTION_UNAVAILABLE_MESSAGE =
  "Request protection is temporarily unavailable. Please try again later.";

type FailureMode = "closed" | "open";

export type RateLimitPolicy =
  | "login_ip_email"
  | "login_ip_global"
  | "signup_ip"
  | "signup_email"
  | "organisation_create"
  | "checkout_create"
  | "order_resend"
  | "organisation_join_leave"
  | "ticket_check_in_out"
  | "stripe_connect_mutation";

type RateLimitPolicyConfig = {
  limit: number;
  windowSeconds: number;
  failureMode: FailureMode;
};

type RateLimitBackendResult = {
  count: number;
  retryAfterSeconds: number | null;
};

export type RateLimitBackend = {
  increment(key: string, windowSeconds: number): Promise<RateLimitBackendResult>;
};

type EnforceRateLimitInput = {
  policy: RateLimitPolicy;
  request: Request;
  keyParts: Array<string | number | null | undefined>;
};

const policies: Record<RateLimitPolicy, RateLimitPolicyConfig> = {
  login_ip_email: { limit: 10, windowSeconds: 10 * 60, failureMode: "closed" },
  login_ip_global: { limit: 50, windowSeconds: 10 * 60, failureMode: "closed" },
  signup_ip: { limit: 25, windowSeconds: 60 * 60, failureMode: "closed" },
  signup_email: { limit: 3, windowSeconds: 60 * 60, failureMode: "closed" },
  organisation_create: {
    limit: 5,
    windowSeconds: 60 * 60,
    failureMode: "closed"
  },
  checkout_create: { limit: 5, windowSeconds: 10 * 60, failureMode: "open" },
  order_resend: { limit: 10, windowSeconds: 15 * 60, failureMode: "open" },
  organisation_join_leave: {
    limit: 30,
    windowSeconds: 10 * 60,
    failureMode: "open"
  },
  ticket_check_in_out: { limit: 300, windowSeconds: 60, failureMode: "open" },
  stripe_connect_mutation: {
    limit: 20,
    windowSeconds: 10 * 60,
    failureMode: "open"
  }
};

let testBackend: RateLimitBackend | null = null;
let testEnabled: boolean | null = null;
let testBackendFailure: Error | null = null;

function isRateLimitEnabled() {
  if (testEnabled !== null) {
    return testEnabled;
  }

  return process.env.RATE_LIMIT_ENABLED === "true";
}

function getKeyPrefix() {
  return process.env.RATE_LIMIT_KEY_PREFIX?.trim() || "thunderstrux";
}

export function getRateLimitClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function hashBucketKey(policy: RateLimitPolicy, keyParts: EnforceRateLimitInput["keyParts"]) {
  const rawKey = [policy, ...keyParts.map((part) => String(part ?? ""))].join(":");
  return createHash("sha256").update(rawKey).digest("hex");
}

function storageKey(policy: RateLimitPolicy, keyParts: EnforceRateLimitInput["keyParts"]) {
  return `${getKeyPrefix()}:rate-limit:${policy}:${hashBucketKey(policy, keyParts)}`;
}

function responseWithRetryAfter(response: NextResponse, retryAfterSeconds: number | null) {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }

  return response;
}

function getRequestPath(request: Request) {
  try {
    return new URL(request.url).pathname
      .split("/")
      .map((segment) =>
        /^c[a-z0-9]{20,}$/i.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment
        )
          ? ":id"
          : segment
      )
      .join("/");
  } catch {
    return "<unknown>";
  }
}

function logRateLimitWarning({
  policy,
  request,
  reason,
  error
}: {
  policy: RateLimitPolicy;
  request: Request;
  reason:
    | "rate_limited"
    | "backend_unavailable_fail_closed"
    | "backend_unavailable_fail_open";
  error?: unknown;
}) {
  console.warn("Rate limit guard", {
    policy,
    method: request.method,
    path: getRequestPath(request),
    reason,
    error: error instanceof Error ? error.message : undefined
  });
}

function getBackend(): RateLimitBackend {
  if (testBackendFailure) {
    throw testBackendFailure;
  }

  if (testBackend) {
    return testBackend;
  }

  const redisUrl = process.env.RATE_LIMIT_REDIS_URL?.trim();

  if (!redisUrl) {
    throw new Error("RATE_LIMIT_REDIS_URL is not configured");
  }

  return new RedisRateLimitBackend(redisUrl);
}

export async function enforceRateLimit({
  policy,
  request,
  keyParts
}: EnforceRateLimitInput): Promise<NextResponse | null> {
  if (!isRateLimitEnabled()) {
    return null;
  }

  const config = policies[policy];
  const key = storageKey(policy, keyParts);

  try {
    const result = await getBackend().increment(key, config.windowSeconds);

    if (result.count <= config.limit) {
      return null;
    }

    logRateLimitWarning({ policy, request, reason: "rate_limited" });
    return responseWithRetryAfter(
      tooManyRequests(TOO_MANY_REQUESTS_MESSAGE),
      result.retryAfterSeconds
    );
  } catch (error) {
    if (config.failureMode === "open") {
      logRateLimitWarning({
        policy,
        request,
        reason: "backend_unavailable_fail_open",
        error
      });
      return null;
    }

    logRateLimitWarning({
      policy,
      request,
      reason: "backend_unavailable_fail_closed",
      error
    });
    return serviceUnavailable(PROTECTION_UNAVAILABLE_MESSAGE);
  }
}

function encodeRedisCommand(command: string, args: Array<string | number>) {
  const parts = [command, ...args.map(String)];
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;
}

class RespParser {
  private offset = 0;

  constructor(private buffer: Buffer) {}

  get complete() {
    return this.offset >= this.buffer.length;
  }

  parse(): unknown {
    if (this.offset >= this.buffer.length) {
      throw new Error("Incomplete Redis response");
    }

    const prefix = String.fromCharCode(this.buffer[this.offset]);
    this.offset += 1;

    if (prefix === "+") {
      return this.readLine();
    }

    if (prefix === "-") {
      throw new Error(this.readLine());
    }

    if (prefix === ":") {
      return Number(this.readLine());
    }

    if (prefix === "$") {
      const length = Number(this.readLine());

      if (length === -1) {
        return null;
      }

      if (this.buffer.length < this.offset + length + 2) {
        throw new Error("Incomplete Redis response");
      }

      const value = this.buffer.toString("utf8", this.offset, this.offset + length);
      const terminator = this.buffer.toString(
        "utf8",
        this.offset + length,
        this.offset + length + 2
      );

      if (terminator !== "\r\n") {
        throw new Error("Malformed Redis bulk string");
      }

      this.offset += length + 2;
      return value;
    }

    if (prefix === "*") {
      const length = Number(this.readLine());

      if (length === -1) {
        return null;
      }

      return Array.from({ length }, () => this.parse());
    }

    throw new Error("Unsupported Redis response");
  }

  private readLine() {
    const end = this.buffer.indexOf("\r\n", this.offset);

    if (end === -1) {
      throw new Error("Incomplete Redis response");
    }

    const line = this.buffer.toString("utf8", this.offset, end);
    this.offset = end + 2;
    return line;
  }
}

class RedisRateLimitBackend implements RateLimitBackend {
  constructor(private redisUrl: string) {}

  async increment(key: string, windowSeconds: number): Promise<RateLimitBackendResult> {
    const replies = await this.runCommands([
      encodeRedisCommand("MULTI", []),
      encodeRedisCommand("INCR", [key]),
      encodeRedisCommand("EXPIRE", [key, windowSeconds, "NX"]),
      encodeRedisCommand("TTL", [key]),
      encodeRedisCommand("EXEC", [])
    ]);
    const execResult = replies[4];

    if (!Array.isArray(execResult)) {
      throw new Error("Unexpected Redis transaction response");
    }

    const count = Number(execResult[0]);
    const ttl = Number(execResult[2]);

    if (!Number.isFinite(count)) {
      throw new Error("Unexpected Redis counter response");
    }

    return {
      count,
      retryAfterSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : windowSeconds
    };
  }

  private runCommands(commands: string[]) {
    return new Promise<unknown[]>((resolve, reject) => {
      const url = new URL(this.redisUrl);
      const port = url.port ? Number(url.port) : url.protocol === "rediss:" ? 6380 : 6379;
      const socket =
        url.protocol === "rediss:"
          ? tls.connect({ host: url.hostname, port })
          : net.connect({ host: url.hostname, port });
      let buffer = Buffer.alloc(0);
      let settled = false;

      function fail(error: Error) {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(error);
        }
      }

      socket.setTimeout(1500, () => fail(new Error("Redis rate limit timeout")));
      socket.on("error", fail);
      socket.on("close", () => {
        if (!settled) {
          fail(new Error("Redis rate limit connection closed before response"));
        }
      });
      socket.on("connect", () => {
        const auth =
          url.username && url.password
            ? encodeRedisCommand("AUTH", [
                decodeURIComponent(url.username),
                decodeURIComponent(url.password)
              ])
            : url.password
              ? encodeRedisCommand("AUTH", [decodeURIComponent(url.password)])
              : "";
        socket.write(`${auth}${commands.join("")}`);
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        try {
          const parser = new RespParser(buffer);
          const replies: unknown[] = [];
          const expectedReplies = url.password ? commands.length + 1 : commands.length;

          while (!parser.complete && replies.length < expectedReplies) {
            replies.push(parser.parse());
          }

          if (replies.length === expectedReplies) {
            settled = true;
            socket.end();
            resolve(url.password ? replies.slice(1) : replies);
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Incomplete Redis response"
          ) {
            return;
          }

          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

export function createTestRateLimitBackend(): RateLimitBackend & { reset(): void } {
  const buckets = new Map<string, { count: number; expiresAt: number }>();

  return {
    async increment(key, windowSeconds) {
      const now = Date.now();
      const existing = buckets.get(key);

      if (!existing || existing.expiresAt <= now) {
        const expiresAt = now + windowSeconds * 1000;
        buckets.set(key, { count: 1, expiresAt });
        return { count: 1, retryAfterSeconds: windowSeconds };
      }

      existing.count += 1;
      return {
        count: existing.count,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000))
      };
    },
    reset() {
      buckets.clear();
    }
  };
}

export function setRateLimitTestBackend(backend: RateLimitBackend | null) {
  testBackend = backend;
}

export function setRateLimitTestEnabled(enabled: boolean | null) {
  testEnabled = enabled;
}

export function setRateLimitTestBackendFailure(error: Error | null) {
  testBackendFailure = error;
}
