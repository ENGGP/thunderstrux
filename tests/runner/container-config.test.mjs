import assert from "node:assert/strict";
import test from "node:test";
import { assertImmutableImageRef, validateHostedConfig } from "../../scripts/container-config.mjs";

const digest = "a".repeat(64);
const image = `ghcr.io/enggp/thunderstrux@sha256:${digest}`;

function hardenedService(extra = {}) {
  return {
    image,
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    user: "1000:1000",
    init: true,
    stop_grace_period: "30s",
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    pids_limit: 128,
    cpus: 1,
    mem_limit: 1_073_741_824,
    ...extra
  };
}

test("hosted images must use immutable lowercase digest references", () => {
  assert.equal(assertImmutableImageRef(image), image);
  assert.throws(() => assertImmutableImageRef("thunderstrux-app:latest"));
  assert.throws(() => assertImmutableImageRef(`GHCR.IO/ENGGP/app@sha256:${digest}`));
});

test("hosted contract requires external services, file secrets, and runtime hardening", () => {
  const environment = Object.fromEntries([
    "DATABASE_URL",
    "AUTH_SECRET",
    "MFA_ENCRYPTION_KEY",
    "NOTIFICATION_ENCRYPTION_KEY",
    "RATE_LIMIT_REDIS_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_CONNECT_WEBHOOK_SECRET",
    "RESEND_API_KEY"
  ].map((name) => [`${name}_FILE`, `/run/secrets/${name.toLowerCase()}`]));
  const config = {
    services: {
      app: hardenedService({ environment: { ...environment, RATE_LIMIT_ENABLED: "true" }, healthcheck: { test: ["CMD", "node"] } }),
      migration: hardenedService({ profiles: ["tools"] }),
      "notification-worker": hardenedService({ profiles: ["workers"] }),
      "email-worker": hardenedService({ profiles: ["workers"] }),
      "stale-order-worker": hardenedService({ profiles: ["workers"] }),
      "compensation-worker": hardenedService({ profiles: ["workers"] })
    }
  };
  assert.equal(validateHostedConfig(config), config);
  assert.throws(() => validateHostedConfig({ ...config, services: { ...config.services, db: {} } }));
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, app: { ...config.services.app, environment: { ...environment, AUTH_SECRET: "unsafe" } } }
  }));
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, migration: { ...config.services.migration, user: "0:0" } }
  }));
});
