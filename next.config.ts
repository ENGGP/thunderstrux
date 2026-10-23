import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));
const development = process.env.NODE_ENV !== "production";

// T39. Scripts, styles, images, fonts and requests come from this site only;
// Stripe is reached by navigation (Checkout, Connect onboarding), never
// embedded. Next's inline bootstrap scripts need 'unsafe-inline' until pages
// take a per-request nonce; development adds eval and the HMR socket.
export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${development ? " ws: wss:" : ""}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(development ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }])
];

const nextConfig: NextConfig = {
  // Next 16 blocks dev resources (HMR) for unlisted hosts, which stops pages
  // hydrating; the local Docker app is opened at 127.0.0.1:3080 or localhost.
  allowedDevOrigins: ["thunderstrux.mistayu.com", "127.0.0.1", "localhost"],
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // T43: production builds trace only what the server needs into
  // .next-build/standalone, the web image. Workers and migrations use the ops image.
  ...(development ? {} : { output: "standalone" as const, outputFileTracingRoot: root }),
  turbopack: {
    root
  },
  // Society pages moved from /organisations; shared links keep working.
  // /dashboard/organisations and /api/* are different paths and do not match.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API answers are private unless a route says otherwise; public reads and health checks set their own.
      { source: "/api/:path((?!public/|health).*)", headers: [{ key: "Cache-Control", value: "private, no-store" }] }
    ];
  },
  async redirects() {
    return [
      { source: "/organisations", destination: "/societies", permanent: true },
      {
        source: "/organisations/:orgSlug",
        destination: "/societies/:orgSlug",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
