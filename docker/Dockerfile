FROM node:20-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

# Build-time placeholders keep image builds deterministic without requiring real secrets.
# Production runtime still validates AUTH_SECRET from the container environment.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"
ENV AUTH_SECRET="build-time-only-auth-secret-change-at-runtime"
ENV AUTH_URL="http://localhost:3000"
ENV NEXTAUTH_URL="http://localhost:3000"
ARG APP_ORIGIN=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$APP_ORIGIN

RUN pnpm build

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

RUN chmod +x ./docker/entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
