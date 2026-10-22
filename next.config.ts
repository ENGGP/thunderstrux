import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Next 16 blocks dev resources (HMR) for unlisted hosts, which stops pages
  // hydrating; the local Docker app is opened at 127.0.0.1:3080 or localhost.
  allowedDevOrigins: ["thunderstrux.mistayu.com", "127.0.0.1", "localhost"],
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  turbopack: {
    root
  },
  // Society pages moved from /organisations; shared links keep working.
  // /dashboard/organisations and /api/* are different paths and do not match.
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
