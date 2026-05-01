#!/bin/sh
set -e

pnpm prisma:migrate:deploy

exec "$@"
