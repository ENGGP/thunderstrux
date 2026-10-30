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

  const serviceNames = ["app", "migration", "email-worker", "notification-worker", "stale-order-worker", "compensation-worker", "checkout-recovery-worker", "monitor-worker"];
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
  // T53: staff authority on a hosted app always needs an authenticator and a live staff row.
  if (app.environment?.MFA_ENFORCEMENT_MODE !== "enforce") throw new Error("Hosted app must set MFA_ENFORCEMENT_MODE=enforce");
  if (app.environment?.LEGACY_ORGANISATION_ACCESS_MODE !== "deny") throw new Error("Hosted app must set LEGACY_ORGANISATION_ACCESS_MODE=deny");

  const secretVariables = [
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
  ];
  for (const variable of secretVariables) {
    if (Object.hasOwn(app.environment ?? {}, variable)) {
      throw new Error(`Hosted app must inject ${variable} through ${variable}_FILE`);
    }
    if (!app.environment?.[`${variable}_FILE`]) {
      throw new Error(`Hosted app is missing ${variable}_FILE`);
    }
  }

  for (const worker of ["email-worker", "notification-worker", "stale-order-worker", "compensation-worker", "checkout-recovery-worker", "monitor-worker"]) {
    const service = requireService(config, worker);
    if (!(service.profiles ?? []).includes("workers")) throw new Error(`${worker} must remain an explicitly scheduled one-shot service`);
    // T42: a worker that fails must be able to page someone.
    if (!service.environment?.ALERT_WEBHOOK_URL_FILE) throw new Error(`${worker} is missing ALERT_WEBHOOK_URL_FILE`);
    for (const variable of ["EMAIL_FROM", "NEXT_PUBLIC_APP_URL"]) {
      if (!service.environment?.[variable]) throw new Error(`${worker} is missing ${variable}`);
    }
  }
  // PAY-024, DEF-065: the stale-order and refunds jobs settle payments and refunds
  // with Stripe and queue the buyer's notice in the same transaction, so a notice
  // that can't be queued rolls the money step back: the sweep leaves a paid order
  // pending, and a refund made at Stripe reads as failed.
  const workerSecrets = {
    "email-worker": ["RESEND_API_KEY_FILE"],
    "notification-worker": ["RESEND_API_KEY_FILE", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    "stale-order-worker": ["STRIPE_SECRET_KEY_FILE", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    "compensation-worker": ["STRIPE_SECRET_KEY_FILE", "NOTIFICATION_ENCRYPTION_KEY_FILE"],
    "checkout-recovery-worker": ["STRIPE_SECRET_KEY_FILE"]
  };
  for (const [worker, variables] of Object.entries(workerSecrets)) {
    for (const variable of variables) {
      if (!requireService(config, worker).environment?.[variable]) throw new Error(`${worker} is missing ${variable}`);
    }
  }
  // T43: migration and every worker run the release's one ops image; the app runs its web image.
  const opsImages = new Set(["migration", "email-worker", "notification-worker", "stale-order-worker", "compensation-worker", "checkout-recovery-worker", "monitor-worker"].map((name) => requireService(config, name).image));
  if (opsImages.size !== 1) throw new Error("migration and workers must share one ops image");
  if (opsImages.has(app.image)) throw new Error("the app must run the web image, not the ops image");
  if (!requireService(config, "migration").profiles?.includes("tools")) {
    throw new Error("migration must remain an explicitly invoked one-shot tool");
  }

  return config;
}
