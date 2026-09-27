import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "@redis/client";
import { NextResponse } from "next/server";
import { serviceUnavailable, tooManyRequests } from "@/lib/api/errors";
import { logWarn } from "@/lib/ops/logger";

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
  | "stripe_connect_mutation"
  | "staff_mfa_setup"
  | "staff_mfa_verify";

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
  },
  staff_mfa_setup: { limit: 5, windowSeconds: 60 * 60, failureMode: "closed" },
  staff_mfa_verify: { limit: 10, windowSeconds: 10 * 60, failureMode: "closed" }
};

const REDIS_CONNECT_TIMEOUT_MS = 1_500;
const REDIS_COMMAND_TIMEOUT_MS = 1_500;
const REDIS_MAX_RECONNECT_ATTEMPTS = 3;
const REDIS_QUEUE_LIMIT = 1_000;
const DEFAULT_PROXY_HEADER = "x-forwarded-for";
const PROXY_HEADER_NAME_PATTERN = /^[a-z0-9-]+$/;

const incrementScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

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
  const configuredHeader =
    process.env.RATE_LIMIT_TRUSTED_PROXY_HEADER?.trim().toLowerCase() ||
    DEFAULT_PROXY_HEADER;

  if (!PROXY_HEADER_NAME_PATTERN.test(configuredHeader)) {
    return "unknown";
  }

  const value = request.headers.get(configuredHeader)?.trim();

  if (!value) {
    return "unknown";
  }

  // The edge must overwrite this header with one canonical client address.
  // Comma-separated chains are rejected because choosing an element here would
  // make application behavior depend on untrusted proxy input.
  return value.includes(",") ? "unknown" : value;
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
  logWarn(
      reason === "rate_limited"
        ? "rate_limit.rejected"
        : "rate_limit.backend_unavailable",
      {
        policy,
        method: request.method,
        path: getRequestPath(request),
        reason,
        error: error instanceof Error ? error.message : undefined
      }
    );
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

let redisClient: RedisClientType | null = null;
let redisClientUrl: string | null = null;
let redisConnectPromise: Promise<RedisClientType> | null = null;
let redisClientFactory: typeof createClient = createClient;

function destroyRedisClient(client: RedisClientType | null) {
  if (!client) return;
  try {
    client.destroy();
  } catch {
    // A failed or timed-out connection may already be closed.
  }
}

function resetRedisClient() {
  destroyRedisClient(redisClient);
  redisClient = null;
  redisClientUrl = null;
  redisConnectPromise = null;
}

export function setRateLimitRedisClientFactoryForTests(
  factory: typeof createClient | null
) {
  resetRedisClient();
  redisClientFactory = factory ?? createClient;
}

async function withRedisTimeout<T>(operation: Promise<T>, description: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis ${description} timed out`)),
          REDIS_COMMAND_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getConnectedRedisClient(redisUrl: string) {
  if (redisClient && redisClientUrl !== redisUrl) {
    resetRedisClient();
  }

  if (!redisClient) {
    redisClient = redisClientFactory({
      url: redisUrl,
      commandsQueueMaxLength: REDIS_QUEUE_LIMIT,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy(retries) {
          if (retries >= REDIS_MAX_RECONNECT_ATTEMPTS) {
            return new Error("Redis reconnect limit reached");
          }

          return Math.min(50 * 2 ** retries, 500);
        }
      }
    });
    redisClient.on("error", () => {
      // Requests handle and log backend failures according to policy.
    });
    redisClientUrl = redisUrl;
  }

  if (!redisClient.isReady) {
    if (!redisConnectPromise && !redisClient.isOpen) {
      const connectingClient = redisClient;
      const pending = withRedisTimeout(
        connectingClient.connect(),
        "connection"
      )
        .then(() => connectingClient)
        .catch((error) => {
          destroyRedisClient(connectingClient);
          if (redisClient === connectingClient) {
            redisClient = null;
            redisClientUrl = null;
          }
          throw error;
        })
        .finally(() => {
          if (redisConnectPromise === pending) redisConnectPromise = null;
        });
      redisConnectPromise = pending;
    }
    if (redisConnectPromise) await redisConnectPromise;
  }

  return redisClient;
}

class RedisRateLimitBackend implements RateLimitBackend {
  constructor(private redisUrl: string) {}

  async increment(key: string, windowSeconds: number): Promise<RateLimitBackendResult> {
    const client = await getConnectedRedisClient(this.redisUrl);
    const result = await withRedisTimeout(
      client.eval(incrementScript, {
        keys: [key],
        arguments: [String(windowSeconds)]
      }),
      "rate-limit command"
    );

    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error("Unexpected Redis rate-limit response");
    }

    const count = Number(result[0]);
    const ttl = Number(result[1]);

    if (!Number.isFinite(count)) {
      throw new Error("Unexpected Redis counter response");
    }

    return {
      count,
      retryAfterSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : windowSeconds
    };
  }

  async ping() {
    const client = await getConnectedRedisClient(this.redisUrl);
    const reply = await withRedisTimeout(client.ping(), "readiness command");

    if (reply !== "PONG") {
      throw new Error("Unexpected Redis readiness response");
    }
  }
}

export async function checkRateLimitReadiness() {
  if (!isRateLimitEnabled()) {
    return;
  }

  const redisUrl = process.env.RATE_LIMIT_REDIS_URL?.trim();

  if (!redisUrl) {
    throw new Error("RATE_LIMIT_REDIS_URL is not configured");
  }

  await new RedisRateLimitBackend(redisUrl).ping();
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
