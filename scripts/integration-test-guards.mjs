const refusal =
  'Refusing integration database access: use a PostgreSQL URL with a single database name ending in "_test".';

// Validate before Prisma can reset or truncate anything. Never echo a URL: it
// may contain credentials, and URL parser errors can include the original input.
export function validateIntegrationDatabaseUrl(value) {
  try {
    if (typeof value !== "string" || !value) throw new Error();
    const url = new URL(value);
    const path = value.match(/^postgres(?:ql)?:\/\/[^/]+\/([^?#]+)(?:\?[^#]*)?$/i);
    if (!path || !["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname) {
      throw new Error();
    }
    // Inspect the original path too: URL parsing can normalize dot segments.
    const name = decodeURIComponent(path[1]);
    if (!/^[a-z0-9_-]+_test$/i.test(name)) throw new Error();
    return value;
  } catch {
    throw new Error(refusal);
  }
}
