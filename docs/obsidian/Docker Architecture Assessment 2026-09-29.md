---
status: assessment
last-reviewed: 2026-09-29
owner: engineering
---

# Docker Architecture Assessment 2026-09-29

This document assesses whether Thunderstrux uses Docker appropriately for an early-stage company and whether each system responsibility is in the right place. It records a point-in-time review of the repository and local development runtime. Read [[Current Handover]], [[Development Workflow]], and [[Production Operations]] for current delivery and operating instructions.

## Executive Assessment

Docker is a common and defensible startup choice, especially when a product needs consistent Node.js, PostgreSQL, and Redis environments. It is not mandatory and does not establish production readiness on its own. A managed application platform can be a better startup choice when the team does not have dedicated infrastructure capacity.

Thunderstrux has a sound Docker architecture for development, CI, staging, and an initial single-host deployment. Its application packaging, migration separation, readiness checks, deployment rehearsal, backup verification, and rollback controls are more mature than a typical early-stage repository. Hosted production is still gated on worker scheduling, ingress, managed or deliberately operated stateful services, secret management, off-machine backups, external monitoring, and image supply-chain controls.

The 2024 CNCF survey reported that 74% of surveyed organizations used containers for at least some production stateful applications. That survey reflects a cloud-native audience and should be treated as evidence that containers are mainstream, not evidence that every startup should operate its own container platform. See the [CNCF 2024 Annual Survey](https://www.cncf.io/wp-content/uploads/2025/04/cncf_annual_survey24_031225a.pdf).

## Current Topology

The base Compose configuration defines four responsibilities:

| Service | Responsibility | Assessment |
| --- | --- | --- |
| `app` | Next.js web application and API | Correct container boundary |
| `migration` | One-shot Prisma migration from the release image | Strong deployment pattern |
| `db` | PostgreSQL 16 | Correct locally; production hosting decision required |
| `redis` | Redis 7 for rate limiting | Correct locally; managed production service preferred |

The development override selects the `development` image target, bind-mounts source, uses a named `node_modules` volume, enables file polling, exposes PostgreSQL for host tools, and runs Prisma generation plus migration deployment before Next development startup.

The production runner image uses the unprivileged `node` user, an `exec` entrypoint, and a bounded `/api/health/ready` image health check. Production migrations run through the separate `migration` service; ordinary app restarts do not migrate.

## What Is Designed Well

### Separation of concerns

The application, migration command, database, and Redis run as separate services. Docker recommends that each container have one primary concern so services can be operated and scaled independently. See [Docker build best practices](https://docs.docker.com/build/building/best-practices/).

The migration job uses the same release image as the application. This avoids running a schema tool or application version that differs from the deployed release. `scripts/operations.mjs` builds one uniquely tagged candidate, stops writers, creates a verified backup, runs migrations once, starts the candidate, and performs readiness and smoke checks.

### Development and production separation

Production-like Compose contains no source bind mount. Development behavior is isolated in `docker-compose.dev.yml`. This follows Docker's guidance to remove application-code bind mounts from production while using Compose overrides for environment-specific behavior. See [Use Compose in production](https://docs.docker.com/compose/how-tos/production/).

### Runtime security foundations

The production image runs as the built-in `node` user instead of root. The entrypoint uses `exec`, allowing Node to receive termination signals directly. The deployment runner gives the application a 20-second shutdown window, which is consistent with Next.js guidance to allow approximately 10–30 seconds for graceful self-hosted shutdown. See [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

The application port is published on host loopback in the base Compose file. PostgreSQL is not published by the base file, and Redis is never published to the host. The Docker socket is not mounted into application containers.

### Health, migration, and recovery behavior

`/api/health` is liveness. `/api/health/ready` checks the application database query, migration contract, MFA and legacy-access configuration, and Redis when enabled. The image health check calls readiness with bounded timeouts.

The operations test suite rehearses non-root runtime, explicit migration, database and Redis readiness failure, backup, restore, corrupt-archive rejection, compatibility-gated rollback, and resource cleanup. This is valuable evidence, although it does not replace hosted monitoring, real backups, or a hosted recovery drill.

### Build context hygiene

`.dockerignore` excludes `.git`, local environment files, dependencies, Next build directories, test artifacts, temporary files, logs, and coverage. This reduces accidental secret or local-artifact inclusion in the image context.

## Placement Decisions

### Next.js application: keep in Docker

The web/API application is an appropriate container workload. Next.js supports deployment through `next start` or a Docker image, and a single Next.js server supports the framework's normal runtime features. See [Next.js platform deployment requirements](https://nextjs.org/docs/app/guides/deploying-to-platforms).

### Migration: keep as a one-shot container

Migration should remain a separate command using the release image. It should not be returned to ordinary application startup. A Compose tools profile could make the service's one-shot purpose clearer, but the current guarded deployment runner already invokes it explicitly.

Docker Compose profiles are suitable for one-off services such as migration and administration tools. See [Docker Compose profiles](https://docs.docker.com/compose/how-tos/profiles/).

### PostgreSQL: keep in Docker for development and CI

Local PostgreSQL provides reproducibility and reduces environment drift. Using the same database family in development, tests, and production also follows the Twelve-Factor principle of keeping backing services similar across environments. See [Twelve-Factor dev/prod parity](https://12factor.net/dev-prod-parity).

For production, a single PostgreSQL container backed by one host volume leaves backups, encryption, upgrades, monitoring, disk capacity, failover, and disaster recovery with the Thunderstrux team. It also places the database and application in the same host failure domain. Managed PostgreSQL is the preferred startup default unless self-hosting is a deliberate, staffed operating decision.

### Redis: keep in Docker locally

Local Redis is appropriate for testing rate limiting and failure behavior. Managed Redis is preferable for hosted production. If Redis remains limited to rate-limit counters, its data has lower durability requirements than PostgreSQL, but service availability is still required when fail-closed policies are active.

The named `redis_data` volume is acceptable but should not be mistaken for high availability or disaster recovery.

### Background jobs: run in separate scheduled containers

The repository implements bounded commands for:

- Email outbox processing
- Stale-order cleanup and expired MFA grant cleanup
- Compensation refund processing

They are documented as one-minute scheduled jobs but are not persistent Compose services. This is valid only when the hosting platform scheduler is configured. Until then, important work can remain queued.

The preferred production model is a scheduler that launches the same immutable release image with the relevant one-shot command. Separate scheduled containers preserve one concern per invocation and make failures, retries, timeouts, and monitoring explicit. Long-running polling workers are an alternative if the selected platform does not offer scheduled jobs.

### Reverse proxy and TLS: provide outside the application image

The application should not terminate public traffic directly. Next.js recommends a reverse proxy in front of a self-hosted server for malformed requests, slow-connection handling, payload limits, rate limiting, and related protections. See [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

It is correct for the proxy to remain outside the application image. The chosen production platform must supply HTTPS termination, forwarding-header ownership, request limits, and routing. A direct single-host Compose deployment needs an explicit ingress service such as Caddy, nginx, or Traefik, or a cloud load balancer.

### Stripe CLI: keep out of permanent production Compose

Stripe CLI is a development and staging webhook tool. Production uses configured Stripe webhook endpoints and secrets. It should remain ephemeral and outside the permanent production topology.

## Material Gaps And Tradeoffs

### P1: Activate the external production topology

The repository intentionally leaves several concerns to the hosting environment:

- The three one-minute worker schedules
- HTTPS ingress and trusted client-IP header ownership
- External logs, alerts, and readiness monitoring
- Encrypted off-machine backups and a hosted restore drill
- Stripe refund webhook subscription and a real provider campaign

The code and Compose configuration cannot compensate for these missing hosted controls. Unrestricted payments should remain blocked until they are active and verified.

### P1: Protect production secrets

Local environment files are excluded from Git and the build context, but Compose expands runtime secrets into ordinary container environment variables. Those values are visible through container inspection and `docker compose config`.

Local environment injection is conventional. Production should use the hosting platform's secret store or Compose secrets where the application supports file-backed values. Docker advises treating sensitive environment values carefully and considering secrets. See [Docker Compose environment guidance](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) and [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/).

Do not publish `docker compose config`, container inspection output, environment dumps, or operations state. Rotate provider test credentials if output containing them is shared outside the trusted development environment.

### P1: Move PostgreSQL durability outside one host

The named volume is correct local persistence but remains a single-host failure domain. Before public production, choose managed PostgreSQL or demonstrate reliable encrypted off-machine backups, monitoring, capacity management, patching, and a hosted restore/failover procedure.

### P2: Build once and deploy by immutable digest

The operations runner builds the candidate on the target host, gives it a unique release tag, and records its image ID. This is safer than reusing a mutable `latest` tag, but it is not a complete build-once promotion chain.

The preferred production chain is:

1. Build the release image in CI.
2. Run image acceptance tests.
3. Scan operating-system and application packages.
4. Generate an SBOM and provenance attestation.
5. Push to a private registry.
6. Deploy the tested image by immutable digest.

Docker supports SBOM and provenance attestations through BuildKit and its official GitHub Actions. See [Docker build attestations](https://docs.docker.com/build/ci/github-actions/attestations/).

### P2: Pin and update base images

The current image references use mutable tags:

- `node:20-bookworm-slim`
- `postgres:16`
- `redis:7-alpine`

Mutable tags receive upstream fixes conveniently, but the same repository revision can rebuild to different bytes. Pin production base images by digest and let Renovate or another controlled updater submit reviewed digest changes. Docker recommends digest pinning where supply-chain integrity and auditability matter. See [Docker image pinning](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions).

### P2: Align Node versions

CI uses Node 22.23.3 while the Dockerfile uses the Node 20 major-version base. Both can be supported, but validating one major runtime and deploying another weakens dev/prod parity. Select one supported Node line and use it consistently in the Dockerfile, CI, developer tooling, and operations evidence.

### P2: Reduce the production image

The inspected local `thunderstrux-app:local` development image was approximately 1.72 GB on 2026-09-29. The production runner also copies the full `node_modules`, source directories, Prisma tooling, scripts, and build configuration.

This simplifies using one artifact for the web app, migrations, and workers, but increases transfer time, rollback time, storage use, vulnerability surface, and scanning noise.

Next.js standalone output traces and copies only the dependencies needed by the server. See [Next.js standalone output](https://nextjs.org/docs/13/pages/api-reference/next-config-js/output). A reasonable future split is:

- Minimal standalone web runtime target
- Operations target containing Prisma and worker tooling
- Full development target

Do this after measuring the built production target and verifying that Prisma engines, image optimization, worker scripts, and runtime assets remain present.

### P2: Remove local image-tag ambiguity

The development override selects the `development` target while the base Compose file defaults to `thunderstrux-app:local`. Building development can therefore replace the local tag with a development image. The inspected running development container correctly had source and dependency mounts, but it ran as root and had no image health check because those settings exist only in the later production runner stage.

This is acceptable for a local development container, but the shared tag can confuse production-like testing. Use a distinct development tag such as `thunderstrux-app:dev` and reserve immutable release tags or digests for production-like images.

### P2: Bind development PostgreSQL to loopback

The development override publishes `5433:5432`, which binds PostgreSQL to all host interfaces. The example database credentials are intentionally local and weak. Bind it as `127.0.0.1:5433:5432` unless another trusted machine explicitly requires access.

The base production-like Compose file does not expose the database, so this finding is limited to development configuration.

### P2: Add runtime hardening after compatibility tests

The production image already runs as a non-root user. Additional controls to test include:

- `read_only: true`
- Explicit writable `tmpfs` mounts for required Next.js cache/temp paths
- `cap_drop: [ALL]`
- `security_opt: [no-new-privileges:true]`
- Memory, CPU, PID, and file-descriptor limits
- Bounded Docker log rotation when the platform does not manage logs

These reduce the impact of compromise and resource exhaustion. They must be tested because Next.js image optimization and caching may require writable paths. See the [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/) and [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html).

### P3: Make Redis dependency match configuration

The application waits for healthy Redis even when `RATE_LIMIT_ENABLED=false`. Production should enable Redis-backed protection, so the dependency is appropriate there. Local configurations that deliberately disable rate limiting are unnecessarily blocked by an unused Redis failure. Consider environment-specific dependency topology if this becomes a recurring development problem.

## Startup-Specific Recommendation

Do not introduce Kubernetes solely to appear production grade. It would add control-plane, deployment, networking, observability, and incident-response work before Thunderstrux has demonstrated a scaling requirement.

The recommended near-term topology is:

```text
Managed HTTPS ingress / load balancer
              |
Managed container service
  |-- Next.js web container
  |-- scheduled email-outbox job
  |-- scheduled stale-order job
  |-- scheduled compensation-refund job
  `-- one-shot migration job

Managed PostgreSQL
Managed Redis
Managed secret store
Central logs, monitoring, and alerts
Encrypted off-machine backups
Private image registry with immutable digests
```

This preserves Docker's environment consistency while transferring high-cost stateful operations to managed services. Docker Compose on a single server remains a valid lower-cost option when its availability ceiling is accepted and the team operates backups, monitoring, patching, ingress, and recovery deliberately. Docker documents single-server Compose as a supported production approach, not as an automatic high-availability platform. See [Use Compose in production](https://docs.docker.com/compose/how-tos/production/).

## Prioritized Decision List

1. Select the hosting platform and decide managed versus self-operated PostgreSQL and Redis.
2. Activate ingress, exact trusted proxy headers, external monitoring, and secret storage.
3. Configure and monitor all three scheduled worker commands.
4. Establish encrypted off-machine backups and complete a hosted restore drill.
5. Align the Node runtime across Docker and CI.
6. Separate the development image tag from release images.
7. Bind the development PostgreSQL port to loopback.
8. Build, scan, attest, publish, and deploy immutable release images from CI.
9. Pin base images by digest with automated reviewed updates.
10. Measure and reduce the production image, then test read-only filesystem, capability, and resource controls.

## Overall Rating

| Area | Assessment |
| --- | --- |
| Local development | Strong |
| Reproducible testing | Strong |
| Migration safety | Strong |
| Production image structure | Adequate but oversized |
| Runtime hardening | Partial |
| Worker implementation | Implemented but externally unactivated |
| Secret handling | Acceptable locally, incomplete for production |
| Stateful production resilience | Single-host risk until hosting is chosen |
| Image supply chain | Incomplete |
| External ingress and monitoring | Not yet configured |
| Overall early-stage engineering | Above average |
| Ready for unrestricted public production | No |

The negative production conclusion is primarily an activation and operations conclusion. It does not mean Docker was the wrong architectural choice.
