import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertDeployedAppEnvironment, assertImmutableImageRef, validateHostedConfig } from "../../scripts/container-config.mjs";

const digest = "a".repeat(64);
const image = `ghcr.io/enggp/thunderstrux@sha256:${digest}`;
const opsImage = `ghcr.io/enggp/thunderstrux-ops@sha256:${"b".repeat(64)}`;

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

test("every job in the real compose files takes the shared worker settings", async () => {
  const jobs = ["email-worker", "notification-worker", "stale-order-worker", "compensation-worker", "checkout-recovery-worker", "monitor-worker"];
  const service = (text, name) => text.split(/^  (?=[a-z-]+:\r?$)/m).find((block) => block.startsWith(`${name}:`)) ?? "";
  for (const file of ["docker-compose.yml", "docker-compose.hosted.yml"]) {
    const text = await readFile(file, "utf8");
    for (const job of jobs) {
      assert.match(service(text, job), /<<: \*worker\s/, `${job} in ${file}`);
      assert.match(service(text, job), /\*worker-env/, `${job} in ${file}`);
    }
  }
  const schedules = await readFile("docker-compose.schedules.yml", "utf8");
  for (const job of jobs) assert.match(service(schedules, job), /<<: \*every-minute/, job);
  assert.match(await readFile("docker-compose.hosted.yml", "utf8"), /EMAIL_FROM: \$\{EMAIL_FROM:\?/);
});

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
    "STRIPE_ACCOUNTS_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "ALERT_WEBHOOK_URL"
  ].map((name) => [`${name}_FILE`, `/run/secrets/${name.toLowerCase()}`]));
  const workerEnvironment = {
    ALERT_WEBHOOK_URL_FILE: "/run/secrets/alert_webhook_url",
    EMAIL_FROM: "Thunderstrux <tickets@thunderstrux.example>",
    NEXT_PUBLIC_APP_URL: "https://thunderstrux.example"
  };
  const stripeKey = { STRIPE_SECRET_KEY_FILE: "/run/secrets/stripe_secret_key" };
  const resendKey = { RESEND_API_KEY_FILE: "/run/secrets/resend_api_key" };
  const notificationKey = { NOTIFICATION_ENCRYPTION_KEY_FILE: "/run/secrets/notification_encryption_key" };
  const moneyWorkerEnvironment = { ...workerEnvironment, ...stripeKey, ...notificationKey };
  const config = {
    services: {
      app: hardenedService({ environment: { ...environment, RATE_LIMIT_ENABLED: "true", RATE_LIMIT_TRUSTED_PROXY_HEADER: "x-thunderstrux-client-ip", MFA_ENFORCEMENT_MODE: "enforce", LEGACY_ORGANISATION_ACCESS_MODE: "deny" }, healthcheck: { test: ["CMD", "node"] } }),
      migration: hardenedService({ image: opsImage, profiles: ["tools"] }),
      "notification-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: { ...workerEnvironment, ...resendKey, ...notificationKey } }),
      "email-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: { ...workerEnvironment, ...resendKey } }),
      "stale-order-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: moneyWorkerEnvironment }),
      "compensation-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: moneyWorkerEnvironment }),
      "checkout-recovery-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: { ...workerEnvironment, ...stripeKey } }),
      "monitor-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: workerEnvironment })
    }
  };
  assert.equal(validateHostedConfig(config), config);
  assert.throws(() => validateHostedConfig({ ...config, services: { ...config.services, db: {} } }));
  // T53: MFA enforcement and legacy denial are pinned.
  for (const [name, value] of [["MFA_ENFORCEMENT_MODE", "enroll"], ["LEGACY_ORGANISATION_ACCESS_MODE", "allow"]]) {
    const app = { ...config.services.app, environment: { ...config.services.app.environment, [name]: value } };
    assert.throws(() => validateHostedConfig({ ...config, services: { ...config.services, app } }), new RegExp(name));
  }
  // T54: the admin portal never runs in the public app, whatever the value says.
  for (const value of ["true", "false", ""]) {
    const app = { ...config.services.app, environment: { ...config.services.app.environment, ADMIN_PORTAL_ENABLED: value } };
    assert.throws(() => validateHostedConfig({ ...config, services: { ...config.services, app } }), /ADMIN_PORTAL_ENABLED/);
  }
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, app: { ...config.services.app, environment: { ...environment, AUTH_SECRET: "unsafe" } } }
  }));
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, migration: { ...config.services.migration, user: "0:0" } }
  }));
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, "monitor-worker": hardenedService({ image: opsImage, profiles: ["workers"] }) }
  }), /ALERT_WEBHOOK_URL_FILE/);
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, "email-worker": { ...config.services["email-worker"], image } }
  }), /share one ops image/);
  // PAY-024: the stale-order worker can't confirm payments without Stripe.
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, "stale-order-worker": hardenedService({ image: opsImage, profiles: ["workers"], environment: workerEnvironment }) }
  }), /stale-order-worker is missing STRIPE_SECRET_KEY_FILE/);
  // DEF-065: each of these rolls a money step back when a notice can't be queued.
  const without = (worker, variable) => {
    const { [variable]: _, ...environment } = config.services[worker].environment;
    return { ...config, services: { ...config.services, [worker]: { ...config.services[worker], environment } } };
  };
  for (const [worker, variable] of [
    ["compensation-worker", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    ["compensation-worker", "STRIPE_SECRET_KEY_FILE"],
    ["stale-order-worker", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    ["stale-order-worker", "EMAIL_FROM"],
    ["compensation-worker", "EMAIL_FROM"],
    ["compensation-worker", "NEXT_PUBLIC_APP_URL"],
    ["monitor-worker", "EMAIL_FROM"],
    ["notification-worker", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    ["notification-worker", "RESEND_API_KEY_FILE"],
    ["email-worker", "RESEND_API_KEY_FILE"],
    ["checkout-recovery-worker", "STRIPE_SECRET_KEY_FILE"]
  ]) {
    assert.throws(() => validateHostedConfig(without(worker, variable)), new RegExp(`${worker} is missing ${variable}`));
  }
  assert.throws(() => validateHostedConfig({
    ...config,
    services: { ...config.services, app: { ...config.services.app, image: opsImage } }
  }), /web image/);
});

test("every deployed app rate-limits behind an overwritten client-IP header, with no admin portal, whatever its MFA mode (SEC-053)", () => {
  const base = { RATE_LIMIT_ENABLED: "true", RATE_LIMIT_TRUSTED_PROXY_HEADER: "cf-connecting-ip", MFA_ENFORCEMENT_MODE: "off" };
  assert.doesNotThrow(() => assertDeployedAppEnvironment(base));
  assert.throws(() => assertDeployedAppEnvironment({ ...base, RATE_LIMIT_ENABLED: "false" }), /RATE_LIMIT_ENABLED/);
  assert.throws(() => assertDeployedAppEnvironment({ ...base, RATE_LIMIT_ENABLED: undefined }), /RATE_LIMIT_ENABLED/);
  // SEC-072: an allowlist of headers our edges overwrite, so a pass-through one like x-real-ip is refused too.
  assert.doesNotThrow(() => assertDeployedAppEnvironment({ ...base, RATE_LIMIT_TRUSTED_PROXY_HEADER: "X-Thunderstrux-Client-IP" }));
  for (const header of [undefined, "", "X-Forwarded-For", "x-real-ip", "true-client-ip", "x-client-ip"]) {
    assert.throws(() => assertDeployedAppEnvironment({ ...base, RATE_LIMIT_TRUSTED_PROXY_HEADER: header }), /RATE_LIMIT_TRUSTED_PROXY_HEADER/);
  }
  assert.throws(() => assertDeployedAppEnvironment({ ...base, ADMIN_PORTAL_ENABLED: "false" }), /ADMIN_PORTAL_ENABLED/);
});

test("each deploy path accepts only its own edge's client-IP header, and no deployed app allows legacy access (SEC-085)", () => {
  const base = { RATE_LIMIT_ENABLED: "true", MFA_ENFORCEMENT_MODE: "off" };
  const withHeader = (header) => ({ ...base, RATE_LIMIT_TRUSTED_PROXY_HEADER: header });
  assert.doesNotThrow(() => assertDeployedAppEnvironment(withHeader("cf-connecting-ip"), "cloudflare"));
  assert.throws(() => assertDeployedAppEnvironment(withHeader("x-thunderstrux-client-ip"), "cloudflare"), /cf-connecting-ip/);
  assert.doesNotThrow(() => assertDeployedAppEnvironment(withHeader("x-thunderstrux-client-ip"), "caddy"));
  assert.throws(() => assertDeployedAppEnvironment(withHeader("cf-connecting-ip"), "caddy"), /x-thunderstrux-client-ip/);
  for (const edge of [undefined, "cloudflare"]) {
    assert.throws(() => assertDeployedAppEnvironment({ ...withHeader("cf-connecting-ip"), LEGACY_ORGANISATION_ACCESS_MODE: "allow" }, edge), /LEGACY_ORGANISATION_ACCESS_MODE/);
    assert.doesNotThrow(() => assertDeployedAppEnvironment({ ...withHeader("cf-connecting-ip"), LEGACY_ORGANISATION_ACCESS_MODE: "deny" }, edge));
  }
});
