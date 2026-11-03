// T54: the admin portal runs only in a process started with
// ADMIN_PORTAL_ENABLED=true: the dev app, or `pnpm ops:admin` on 127.0.0.1.
// The public app never sets it, so /admin answers 404 there (hosted config
// refuses it on the app service). Read at run time, never inlined by the build.
export function isAdminPortalEnabled() {
  return process.env.ADMIN_PORTAL_ENABLED === "true";
}

// In admin mode only the sign-in URL's host (AUTH_URL, else NEXTAUTH_URL) may reach the portal, so a page that
// rebinds its own name to 127.0.0.1 can't (DNS rebinding).
export function adminHostAllowed(host: string | null) {
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!authUrl || !host) return false;
  try {
    const expected = new URL(authUrl);
    const actual = new URL(`http://${host.toLowerCase()}`);
    // localhost and 127.0.0.1 are the same machine; any other name must match exactly.
    const loopback = (name: string) => ["localhost", "127.0.0.1", "[::1]"].includes(name);
    return actual.port === expected.port && (actual.hostname === expected.hostname || (loopback(actual.hostname) && loopback(expected.hostname)));
  } catch {
    return false;
  }
}

// Dev only: ADMIN_PORTAL_MFA=off lets the dev app's portal skip the authenticator.
// Built images run NODE_ENV=production (inlined at build), so preview and
// production always require it whatever this variable says.
export function adminMfaOff() {
  return process.env.NODE_ENV === "development" && process.env.ADMIN_PORTAL_MFA === "off";
}

// How long one authenticator verification lets an operator read.
export const ADMIN_WINDOW_MS = 60 * 60_000;
