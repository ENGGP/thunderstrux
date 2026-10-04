FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Keep the digest-pinned base, but refresh required Debian packages from its
# security repository. Explicitly install libpcre2-8-0 so a vulnerable version
# inherited from the base is upgraded (CVE-2026-103111).
# hadolint ignore=DL3008
RUN corepack enable \
  && corepack prepare pnpm@10.34.5 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libpcre2-8-0 openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

ARG APP_ORIGIN=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$APP_ORIGIN

# These values are non-secret build placeholders scoped to this command. The
# runtime image does not retain them and validates its real configuration.
RUN DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public" \
  AUTH_SECRET="build-time-only-auth-secret-change-at-runtime" \
  AUTH_URL="http://localhost:3000" \
  NEXTAUTH_URL="http://localhost:3000" \
  pnpm build

FROM deps AS development

FROM base AS runner

ENV NODE_ENV=production

COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next-build ./.next-build
COPY --chown=node:node --from=builder /app/app ./app
COPY --chown=node:node --from=builder /app/components ./components
COPY --chown=node:node --from=builder /app/lib ./lib
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/auth.ts ./auth.ts
COPY --chown=node:node --from=builder /app/next-auth.d.ts ./next-auth.d.ts
COPY --chown=node:node --from=builder /app/next-env.d.ts ./next-env.d.ts
COPY --chown=node:node --from=builder /app/next.config.ts ./next.config.ts
COPY --chown=node:node --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --chown=node:node --from=builder /app/proxy.ts ./proxy.ts
COPY --chown=node:node --from=builder /app/tailwind.config.js ./tailwind.config.js
COPY --chown=node:node --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh

# Package managers are build tools. Runtime commands invoke Node entrypoints
# directly, so remove Corepack and its dependency tree from the final image.
RUN chmod +x ./docker/entrypoint.sh \
  && rm -rf /usr/local/lib/node_modules/corepack \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -rf /root/.cache/node/corepack \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
