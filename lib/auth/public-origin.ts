// Auth.js picks __Secure- session cookies from the scheme of its public URL, which stays
// https when TLS ends at a tunnel or proxy in front of a plain-http app.
export function publicOriginIsHttps(fallbackUrl?: string) {
  const url = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? fallbackUrl;
  return url ? new URL(url).protocol === "https:" : false;
}

// The app's own cookies follow the same rule, so an https preview never sends them in clear.
export const appCookieSecure = () => process.env.NODE_ENV === "production" || publicOriginIsHttps();
