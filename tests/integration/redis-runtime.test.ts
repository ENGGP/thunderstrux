import { randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { createClient } from "@redis/client";
import { expect, test, vi } from "vitest";
import {
  checkRateLimitReadiness,
  enforceRateLimit,
  setRateLimitRedisClientFactoryForTests,
  setRateLimitTestBackend,
  setRateLimitTestBackendFailure,
  setRateLimitTestEnabled
} from "@/lib/security/rate-limit";

test("real Redis atomically throttles requests, fails closed during an outage and recovers", async () => {
  // The Docker test project owns this Redis; never flush shared Redis data.
  const redisUrl = process.env.INTEGRATION_REDIS_URL;
  if (!redisUrl) throw new Error("INTEGRATION_REDIS_URL must identify the run-owned test Redis");
  const target = new URL(redisUrl);
  const prefix = `redis-runtime-${randomUUID()}`;
  const sockets = new Set<Socket>();
  let available = true;
  const proxy = createServer((socket) => {
    if (!available) { socket.destroy(); return; }
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 6379) });
    sockets.add(socket);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => { sockets.delete(socket); upstream.destroy(); });
    upstream.on("close", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  const inspector = createClient({ url: redisUrl });
  inspector.on("error", () => {});
  const clients: Array<{ isOpen: boolean }> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Missing test proxy port");
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("RATE_LIMIT_REDIS_URL", `redis://127.0.0.1:${address.port}`);
    vi.stubEnv("RATE_LIMIT_KEY_PREFIX", prefix);
    setRateLimitTestBackend(null);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(null);
    setRateLimitRedisClientFactoryForTests(((options) => {
      const client = createClient(options);
      clients.push(client);
      return client;
    }) as typeof createClient);

    await expect(Promise.all(Array.from({ length: 3 }, () => checkRateLimitReadiness()))).resolves.toEqual([undefined, undefined, undefined]);
    expect(clients).toHaveLength(1);
    const request = new Request("http://localhost/api/auth/callback/credentials", { method: "POST" });
    const attempt = () => enforceRateLimit({ policy: "login_ip_email", request, keyParts: ["synthetic-login"], required: true });
    const responses = await Promise.all(Array.from({ length: 20 }, attempt));
    expect(responses.filter((response) => response === null)).toHaveLength(10);
    const rejected = responses.filter((response) => response !== null);
    expect(rejected).toHaveLength(10);
    for (const response of rejected) {
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(600);
    }
    await inspector.connect();
    const keys = await inspector.keys(`${prefix}:*`);
    expect(keys).toHaveLength(1);
    expect(await inspector.get(keys[0])).toBe("20");
    expect(await inspector.ttl(keys[0])).toBeGreaterThan(0);

    // Interrupt only this client's TCP path, leaving other test clients alone.
    available = false;
    for (const socket of sockets) socket.destroy();
    await expect.poll(() => clients[0].isOpen, { timeout: 5000 }).toBe(false);
    const started = Date.now();
    await expect(checkRateLimitReadiness()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4000);
    expect((await attempt())?.status).toBe(503);
    expect(await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["synthetic-checkout"] })).toBeNull();

    available = true;
    await expect(checkRateLimitReadiness()).resolves.toBeUndefined();
    expect(clients.length).toBeGreaterThan(1);
    expect((await attempt())?.status).toBe(429);
  } finally {
    setRateLimitRedisClientFactoryForTests(null);
    setRateLimitTestBackend(null);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(null);
    for (const socket of sockets) socket.destroy();
    if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (inspector.isReady) {
      const keys = await inspector.keys(`${prefix}:*`);
      if (keys.length) await inspector.del(keys);
    }
    if (inspector.isOpen) inspector.destroy();
  }
});
