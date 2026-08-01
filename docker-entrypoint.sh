#!/bin/sh
set -e

# Apply pending Prisma migrations before booting the API. Postgres is already
# healthy at this point (compose gates startup on the healthcheck).
echo "Running prisma migrate deploy..."
npx prisma migrate deploy

echo "Starting API..."
exec "$@"
