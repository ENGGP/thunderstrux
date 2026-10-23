FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS os

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Keep the digest-pinned base, but refresh required Debian packages from its
# security repository, including vulnerable PCRE and Perl inherited from the base.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libpcre2-8-0 openssl perl-base \
  && rm -rf /var/lib/apt/lists/*

# Build stages add pnpm; the release images (runtime below) never carry it.
FROM os AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@10.34.7 --activate

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

# T43: production dependencies only. The Prisma CLI is a production dependency
# because the ops image runs migrations with it.
FROM base AS ops-deps

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod \
  && pnpm exec prisma generate

# Package managers are build tools. Runtime commands invoke Node entrypoints
# directly, so remove Corepack and its dependency tree from both release images.
FROM os AS runtime

ENV NODE_ENV=production

RUN rm -rf /usr/local/lib/node_modules/corepack \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -rf /root/.cache/node/corepack \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --chown=node:node --chmod=755 docker/entrypoint.sh ./docker/entrypoint.sh

# The operations image (T43): migrations, every worker, seeds and maintenance
# commands. It never serves traffic.
FROM runtime AS ops

COPY --chown=node:node --from=ops-deps /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml tsconfig.json auth.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node config ./config
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts

USER node

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# The web image (T43): Next's standalone server and its static assets only.
FROM runtime AS web

ENV HOSTNAME=0.0.0.0

COPY --chown=node:node --from=builder /app/.next-build/standalone ./
COPY --chown=node:node --from=builder /app/.next-build/static ./.next-build/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
