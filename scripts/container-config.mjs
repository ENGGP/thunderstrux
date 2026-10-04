const immutableImagePattern = /^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/;

export function assertImmutableImageRef(value) {
  if (!immutableImagePattern.test(value ?? "")) {
    throw new Error("APP_IMAGE must be a lowercase registry reference pinned with @sha256:<64 lowercase hex characters>");
  }
  return value;
}

function requireService(config, name) {
  const service = config.services?.[name];
  if (!service) throw new Error(`Hosted Compose service is missing: ${name}`);
  return service;
}

export function validateHostedConfig(config) {
  if (config.services?.db || config.services?.redis) {
    throw new Error("Hosted Compose must not bundle PostgreSQL or Redis");
  }

  const serviceNames = ["app", "migration", "email-worker", "notification-worker", "stale-order-worker", "compensation-worker"];
  for (const name of serviceNames) {
    const service = requireService(config, name);
    assertImmutableImageRef(service.image);
    if (service.build) throw new Error(`${name} must consume a prebuilt image`);
    if (service.volumes?.length) throw new Error(`${name} must not use hosted source or state volumes`);
    if (!service.user || service.user === "0" || service.user === "root" || service.user.startsWith("0:")) {
      throw new Error(`${name} must run as an explicit non-root user`);
    }
    if (service.init !== true) throw new Error(`${name} must run with an init process`);
    if (service.read_only !== true) throw new Error(`${name} must use a read-only root filesystem`);
    if (!service.cap_drop?.includes("ALL")) throw new Error(`${name} must drop all Linux capabilities`);
    if (!service.security_opt?.includes("no-new-privileges:true")) {
      throw new Error(`${name} must set no-new-privileges`);
    }
    if (!service.pids_limit || !service.cpus || !service.mem_limit) {
      throw new Error(`${name} must define PID, CPU, and memory limits`);
    }
    if (service.stop_grace_period !== "30s") throw new Error(`${name} must allow a 30-second graceful stop`);
    if (!service.tmpfs?.some((mount) => mount.startsWith("/tmp:"))) {
      throw new Error(`${name} must provide a bounded writable /tmp filesystem`);
    }
  }

  const app = requireService(config, "app");
  if (app.ports?.length) throw new Error("Hosted app must leave public port publication to the platform ingress");
  if (!app.healthcheck) throw new Error("Hosted app must define a readiness healthcheck");
  if (app.environment?.RATE_LIMIT_ENABLED !== "true") throw new Error("Hosted app must enable Redis rate limiting");

  const secretVariables = [
    "DATABASE_URL",
    "AUTH_SECRET",
    "MFA_ENCRYPTION_KEY",
    "NOTIFICATION_ENCRYPTION_KEY",
    "RATE_LIMIT_REDIS_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_CONNECT_WEBHOOK_SECRET",
    "RESEND_API_KEY"
  ];
  for (const variable of secretVariables) {
    if (Object.hasOwn(app.environment ?? {}, variable)) {
      throw new Error(`Hosted app must inject ${variable} through ${variable}_FILE`);
    }
    if (!app.environment?.[`${variable}_FILE`]) {
      throw new Error(`Hosted app is missing ${variable}_FILE`);
    }
  }

  for (const worker of ["email-worker", "notification-worker", "stale-order-worker", "compensation-worker"]) {
    const profiles = requireService(config, worker).profiles ?? [];
    if (!profiles.includes("workers")) throw new Error(`${worker} must remain an explicitly scheduled one-shot service`);
  }
  if (!requireService(config, "migration").profiles?.includes("tools")) {
    throw new Error("migration must remain an explicitly invoked one-shot tool");
  }

  return config;
}
