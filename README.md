# vkai-insurance-provider-api

VK AI Labs — Node.js **provider/ops API** for the Insurance module (policy catalog,
enrollments, premiums, claims). This is the provider side of the platform and is one of four
independent repos in the ecosystem. It serves the React provider portal
(`vkai-insurance-provider`) and is deployed live on an Azure VM (Docker + Nginx +
Let's Encrypt SSL).

The provider side (Azure) and the client side (GCP, `vkai-insurance-client-api`) are fully
independent — **no shared database**. They exchange data only via HTTP sync calls secured by
a shared secret.

## Documentation

- [BUSINESS_REQUIREMENTS.md](BUSINESS_REQUIREMENTS.md) — domain scope, data ownership, the
  cross-cloud sync model, and the two endpoint categories.
- [CLAUDE.md](CLAUDE.md) — project context and critical gotchas for future work (Entra ID
  audience/token-version, Prisma-on-Alpine, env-var placement, git workflow).

---

## Tech stack

| Concern        | Choice                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Runtime        | Node.js 20+ / Express                                                  |
| Database       | PostgreSQL via Prisma ORM                                              |
| Auth (ops)     | Entra ID (Azure AD) v2 JWTs, verified with `jsonwebtoken` + `jwks-rsa` |
| Cross-cloud    | Shared-secret header (`X-VKAI-Sync-Key`)                              |
| Scheduling     | `node-cron` (outbound sync retry)                                      |
| Logging        | `pino` (structured JSON)                                               |
| CORS           | `cors` package (enabled from the start)                                |
| Local dev      | Docker + Docker Compose (API + Postgres)                               |

**Entra ID verification choice:** we validate incoming Bearer tokens manually against
Microsoft's tenant JWKS endpoint (`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`)
using `jsonwebtoken` + `jwks-rsa`. This keeps the dependency surface small and gives explicit
control over audience/issuer checks against the Azure AD v2 token contract.

---

## Quick start (Docker — recommended)

```bash
cp .env.example .env       # fill in real values as needed (see below)
docker compose up --build -d
```

This brings up:

- **postgres** — database `vkai_insurance_provider_dev`, exposed on host port **5433**
  (container 5432), with a named volume for persistence and a healthcheck.
- **api** — waits for Postgres to be healthy, runs `prisma migrate deploy` via the
  entrypoint, then boots on host port **4100**.

Check it:

```bash
curl http://localhost:4100/health
```

Tear down (keep data):

```bash
docker compose down
```

Tear down and wipe the database volume:

```bash
docker compose down -v
```

> **Ports:** Postgres is on **5433** (not the default 5432) and the API is on **4100** so
> this stack can run simultaneously with the client-api stack on the same machine without
> clashing.

---

## Local run without Docker

Requires a Postgres reachable at the `VKAI_INSURANCE_PROVIDER_API_DATABASE_URL` in `.env`
(e.g. run just the DB container: `docker compose up -d postgres`).

```bash
npm install
npx prisma migrate deploy   # or: npx prisma migrate dev   (to create/apply during dev)
npm run dev                 # node --watch src/index.js
```

---

## Environment variables

Copy `.env.example` to `.env`. All values use the `VKAI_INSURANCE_PROVIDER_API_` prefix
(except the client base URL, shared across repos).

| Variable | Purpose |
| -------- | ------- |
| `VKAI_INSURANCE_PROVIDER_API_PORT` | API listen port (default 4100) |
| `VKAI_INSURANCE_PROVIDER_API_DATABASE_URL` | Postgres connection string (host port 5433) |
| `VKAI_INSURANCE_PROVIDER_API_ENTRA_TENANT_ID` | Entra ID tenant id — **required for login** |
| `VKAI_INSURANCE_PROVIDER_API_ENTRA_CLIENT_ID` | Entra ID app (audience) id — **required for login** |
| `VKAI_INSURANCE_PROVIDER_API_ENTRA_REVIEWER_GROUP_ID` | Entra group id mapped to the `Reviewer` role |
| `VKAI_INSURANCE_PROVIDER_API_ENTRA_APPROVER_GROUP_ID` | Entra group id mapped to the `Approver` role |
| `VKAI_INSURANCE_PROVIDER_API_SYNC_KEY` | Shared secret for cross-cloud routes |
| `VKAI_INSURANCE_CLIENT_API_BASE_URL` | Base URL of the client-side API (default `http://localhost:4000`) |
| `VKAI_INSURANCE_PROVIDER_API_ALLOWED_ORIGIN` | CORS origin (default `http://localhost:5174`) |
| `VKAI_INSURANCE_PROVIDER_API_LOG_LEVEL` | pino log level (default `info`) |

> ⚠️ **Entra ID login requires the real registration values to be configured.** The
> **"VKAI Insurance Provider Portal"** app registration exists in Entra ID, with its
> redirect URIs, the Reviewer/Approver security groups, and the exposed `access_as_user`
> API scope all set up. The verification logic is built against the Azure AD v2 token
> contract; each environment must set `VKAI_INSURANCE_PROVIDER_API_ENTRA_TENANT_ID`,
> `..._ENTRA_CLIENT_ID`, and the Reviewer/Approver group ids from that registration before
> its ops-authenticated routes will accept a token.
>
> The cross-cloud sync routes and the `/health` endpoint do **not** depend on Entra ID and
> are fully testable now (set `VKAI_INSURANCE_PROVIDER_API_SYNC_KEY`).

---

## Roles

Ops users are upserted from token claims on first request. Group membership maps to a role
via the two group-id env vars:

- **Reviewer** — can move a claim to *Under Review*.
- **Approver** — everything a Reviewer can do, plus create/edit catalog plans, activate
  policies, and approve/reject/mark-paid claims.

> Note: a Reviewer touching a claim first is **not** enforced — any Approver can act on a
> claim regardless of its review history (deliberate scope decision).

---

## API routes

### Ops-authenticated (require `Authorization: Bearer <Entra ID JWT>`)

| Method & path | Role | Description |
| ------------- | ---- | ----------- |
| `GET /v1/policy-catalog` | any | List all catalog entries |
| `POST /v1/policy-catalog` | Approver | Create a plan |
| `PATCH /v1/policy-catalog/:id` | Approver | Edit / deactivate a plan |
| `GET /v1/policies` | any | List enrollments; `?status=pending` for the pending queue |
| `POST /v1/policies/:id/activate` | Approver | Set `active`, then push status to client |
| `GET /v1/premiums` | any | List premium records (view only) |
| `GET /v1/claims` | any | List claims; `?status=<value>` filter |
| `POST /v1/claims/:id/review` | Reviewer / Approver | Set `Under Review`, `reviewed_by`, sync |
| `POST /v1/claims/:id/approve` | Approver | Set `Approved`, `approved_by`, sync |
| `POST /v1/claims/:id/reject` | Approver | Set `Rejected`, `approved_by`, sync |
| `POST /v1/claims/:id/mark-paid` | Approver | Only if currently `Approved`; set `Paid`, sync |
| `GET /v1/sync-issues` | any | All rows with `sync_status = failed` |

### Cross-cloud (require `X-VKAI-Sync-Key`, **not** the ops JWT)

| Method & path | Description |
| ------------- | ----------- |
| `GET /v1/catalog/policies` | Active `policy_catalog` rows the client side pulls |
| `POST /v1/sync/policies` | Inbound: client pushes a new enrollment → `policies` (pending) |
| `POST /v1/sync/premiums` | Inbound: client pushes a premium payment → `premiums` |
| `POST /v1/sync/claims` | Inbound: client pushes a new claim → `claims` (Submitted) |

All inbound sync routes are **idempotent**: a retried delivery is deduped on the incoming
`event_id` (premiums) or the business key `client_policy_id` / `client_claim_id`
(policies / claims), so it never creates a duplicate row.

---

## Cross-cloud sync

### Outbound (provider → client)

`src/services/clientSync.js` exposes `syncToClient(endpointPath, payload, opts)`, which:

1. Wraps the payload in the standard envelope
   `{ event_id, event_type, occurred_at, source: "provider", payload }`.
2. POSTs to `${VKAI_INSURANCE_CLIENT_API_BASE_URL}${endpointPath}` with the
   `X-VKAI-Sync-Key` and `X-VKAI-Correlation-Id` headers.
3. **Never throws** — returns `{ ok, eventId, ... }`. The caller sets `sync_status` to
   `synced` on success, or `failed` (incrementing `sync_attempts`) on failure, so the ops
   action still succeeds locally even when the push fails.

It is called after **policy activation** (`POST /v1/sync/policies/status` on the client) and
**every claim status change** (`POST /v1/sync/claims/status` on the client).

### Background retry job

`src/jobs/retrySync.js` runs every **5 minutes** via `node-cron`. It re-pushes policies and
claims where `sync_status IN ('pending','failed')` and `sync_attempts < 5`, reusing the
stored `event_id` so the client can dedupe.

---

## Data model

Prisma models in [`prisma/schema.prisma`](prisma/schema.prisma) map to snake_case, plural
tables: `ops_users`, `policy_catalog`, `policies`, `premiums`, `claims`. `sync_status`,
`sync_attempts`, and `event_id` are built into every synced table from the start.
`policy_catalog` is the **source of truth** for plans; the client side caches a read-only
copy via `GET /v1/catalog/policies`.

---

## Logging

Structured JSON via pino. Every line carries `timestamp`, `env`, `service`
(`vkai-insurance-provider-api`), `level`, `message`, and — on request-scoped loggers —
`correlationId`. The correlation id is read from `X-VKAI-Correlation-Id` or generated, and
echoed back on the response and propagated on outbound sync calls.

---

## Deployment

The API is deployed live on an **Azure VM**, running under Docker with **Nginx** as a
reverse proxy and **Let's Encrypt** for SSL.

### Continuous deployment

Pushing to **`main`** triggers automatic deployment to the production Azure VM via GitHub
Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). The workflow SSHes
into the VM and: pulls the latest code, rebuilds the Docker containers
(`docker compose down` then `docker compose up --build -d`), and verifies the deployment by
polling the `/health` endpoint (with a wait and retry loop) — failing the run if the service
doesn't come back healthy. Manual SSH deployment is still possible, but no longer required
for a normal release.

The workflow relies on three per-repo GitHub Actions secrets — `DEPLOY_HOST`, `DEPLOY_USER`,
and `DEPLOY_SSH_KEY` — which must be configured in the repo's Actions settings before the
pipeline can run.

## Out of scope for this repo

- The provider frontend (`vkai-insurance-provider`)
