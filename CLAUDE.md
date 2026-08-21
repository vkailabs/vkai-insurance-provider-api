# CLAUDE.md — project context for `vkai-insurance-provider-api`

Context for future Claude Code sessions working in this repo. Read this before making
changes — several items below are hard-won gotchas that are easy to reintroduce.

## What this repo is

The backend API for the **provider / ops side** of *VK AI Labs Insurance* (Azure). It serves
the `vkai-insurance-provider` frontend and owns the policy catalog, enrollments, premiums,
and the claims workflow. It has its **own Postgres database** and syncs with the GCP client
side over HTTPS with an event envelope. See [BUSINESS_REQUIREMENTS.md](BUSINESS_REQUIREMENTS.md)
for the full domain model and [README.md](README.md) for setup.

## Naming conventions

- **Env vars:** prefix everything with `VKAI_INSURANCE_PROVIDER_API_*` (the one exception is
  `VKAI_INSURANCE_CLIENT_API_BASE_URL`, shared across repos).
- **Prisma model fields & JSON responses:** `camelCase` (same as the client-api side). The
  Prisma schema maps camelCase fields to `snake_case`, plural DB tables via `@map` / `@@map`;
  API request/response bodies stay camelCase.
- **API routes:** `/v1/<resource>`, kebab-case, plural nouns.

## CRITICAL gotchas — do not reintroduce these

### Entra ID (Azure AD) auth

- **Audience must accept BOTH forms.** Azure may issue tokens with an `aud` of either the
  bare client ID *or* the `api://<client-id>` URI form, depending on how the token was
  requested (the latter when the exposed `access_as_user` scope is used). The verification in
  [src/middleware/entraAuth.js](src/middleware/entraAuth.js) passes an **array** to
  `jsonwebtoken`'s `audience` option: `[clientId, "api://" + clientId]`. **Never hardcode a
  single expected audience value** — doing so breaks every request with a
  `jwt audience invalid` error.
- **Token version must be pinned to v2.** The app registration must set
  `requestedAccessTokenVersion: 2` in the **new Microsoft Graph app manifest**. Do *not* use
  the old, deprecating AAD Graph manifest — it uses a differently-named field, and without
  the v2 pin the issued tokens carry the wrong issuer format (the issuer check expects
  `https://login.microsoftonline.com/<tenant>/v2.0`). This is a Portal step, not code, but
  the code depends on it.

### Prisma + Docker on Alpine

- The [Dockerfile](Dockerfile) **pins Prisma `binaryTargets`** (in
  [prisma/schema.prisma](prisma/schema.prisma): `native`, `linux-musl-openssl-3.0.x`,
  `linux-musl-arm64-openssl-3.0.x`) **and installs `openssl` in the build stage**. This
  avoids an OpenSSL version mismatch on Alpine where Prisma otherwise generates a
  `1.1.x` engine but the runtime needs `3.0.x`, crashing the container on boot with
  "Prisma Client could not locate the Query Engine". **Do not remove either of these** if you
  touch the Dockerfile or schema generator block.

### Deployed-VM fixes are invisible to git

- Any fix made **directly on a deployed VM** (via `nano`/`ssh`) is **LOCAL-ONLY** and
  invisible to git. It will be silently lost on the next deploy and is not reproducible.
  **Never leave a fix living only on a VM's disk** — always bring it back into the repo and
  push it through the normal `dev` → PR → `main` workflow.

### Sync envelope

- Outbound and inbound sync routes must wrap/unwrap the standard envelope
  `{ event_id, event_type, occurred_at, source, payload }`. Outbound wrapping lives in
  [src/services/clientSync.js](src/services/clientSync.js); inbound unwrapping uses the
  `unwrap()` helper in [src/routes/crossCloud.js](src/routes/crossCloud.js) (which also
  tolerates a flat body). **Preserve this pattern in any new sync route** — read
  `event_id`/`payload` via `unwrap()`, never assume a flat body.

### Inbound client → provider status push (VKAI-010)

- **`POST /v1/sync/policies/status`** is the **first client → provider status push** — all prior
  status flow was provider → client (activation). The client emits `policy.cancelled` when a
  customer cancels a still-pending policy; this route matches the policy by
  **`payload.client_policy_id`** (against the stored `clientPolicyId`) and sets `status =
  'cancelled'`. It is **idempotent** (already-`cancelled` → 200 `{ status: 'duplicate' }`),
  404s on an unknown `client_policy_id`, 400s on missing `client_policy_id`/`status`, and
  400s on any `status` other than `cancelled` (kept deliberately tight to the current
  contract — extend explicitly, don't blindly apply arbitrary statuses). **It is an inbound
  AUTHORITATIVE change — never echo it back out** to the client (that would loop).
- **Note the symmetric path name:** the provider's *outbound* activation push targets the
  client's `POST /v1/sync/policies/status`; this new route is the provider's *own* inbound
  same-named endpoint on a different host. Same path, opposite direction, different server —
  not a conflict.
- **Activation guard.** `POST /v1/policies/:id/activate` now **409s** on any policy whose
  `status !== 'pending'` (e.g. a `cancelled` one) and performs no state change or outbound
  push. This makes "a cancelled policy can no longer be approved" true server-side, not just
  because the UI hid it. The Approver role-gate and the happy-path activation of genuinely
  pending policies are unchanged.
- **`cancelled` is a new free-string `Policy.status` value** (`pending | active | expired |
  cancelled`). No enum, so no migration — just the value + schema comment/doc.

### Outbound catalog push (VKAI-003)

- The **policy catalog is the source of truth** and was originally not an outbound-synced
  table. VKAI-003 added the reliability trio (`sync_status` / `sync_attempts` / `event_id`,
  see the `*_add_policy_catalog_sync` migration) to `policy_catalog` and pushes every
  create/edit to the client's `POST /v1/sync/catalog`. Reuse this same mechanism for any
  future catalog-affecting sync — **don't** invent a parallel outbox.
- **Migration backfills existing rows to `sync_status = 'synced'`** on purpose: they predate
  push-sync and are already in the client cache via the pull, so this stops the 5-min retry
  sweep from re-pushing the entire pre-existing catalog on first deploy.
- **The catalog push payload is camelCase**, unlike the other outbound payloads
  (`client_claim_id` etc. are snake_case). This is deliberate: the catalog payload mirrors the
  `GET /v1/catalog/policies` pull response one-for-one, because the client feeds the SAME
  cached-catalog copy from both the pull and the push. The envelope itself stays snake_case.
  The shared shape lives in [src/lib/catalogSync.js](src/lib/catalogSync.js) so the route push
  and the cron retry can't drift. Client dedupes/upserts on `payload.id` (provider catalog UUID).
- **Event type is `catalog.upserted`** (single event covers create, edit, and deactivate) so
  the client handler is a plain upsert with no branching; a deactivate is just `isActive:false`.

### Policy catalog `key` — generation + deliberate cross-cloud exclusion

- **Generation algorithm (keep in lockstep).** Each policy catalog entry has an
  auto-generated `key`: split the plan name on whitespace, take the **first character of each
  token uppercased**, and concatenate (`"Premium Gold 2024"` → `"PG2"`; a numeric token
  contributes its first digit). Uniqueness is enforced with a **readable dash-numeric suffix
  starting at 2** on collision (`"PG2"` → `"PG2-2"` → `"PG2-3"` …). The shared helpers live in
  [src/lib/policyKey.js](src/lib/policyKey.js): `derivePolicyKey` (pure derivation) and
  `makeUniquePolicyKey` (DB-checked uniqueness). This algorithm is duplicated in the SQL
  backfill of the `*_add_policy_catalog_key` migration — **any change must update both.**
- **`key` IS included in the cross-cloud `GET /v1/catalog/policies`** (the client cache
  pull) via the explicit Prisma `select` in
  [src/routes/crossCloud.js](src/routes/crossCloud.js). **(SUPERSEDED by VKAI-002.)** VKAI-001
  originally excluded `key` from this route so it would not leak to the client side; VKAI-002
  reversed that decision and `key` now flows to the client on purpose. **Keep the explicit
  `select`** — do not switch it back to a bare `findMany` or a wildcard select. The response
  shape stays intentional; `key` is just one of the selected fields.
- **`key` DOES appear on the ops-authenticated `GET /v1/policies`** because that route nests
  the full `policyCatalog` object (`include: { policyCatalog: true }`). This is
  provider-internal and intentional — **not** a leak, since that route is behind the Entra ID
  ops JWT.

### Env vars must be in TWO places

- CORS is configured via `VKAI_INSURANCE_PROVIDER_API_ALLOWED_ORIGIN` and was included in
  [docker-compose.yml](docker-compose.yml)'s explicit `environment:` list **from the start**
  (a deliberate fix for an earlier client-side gotcha where an env var was missing at
  runtime). When adding **any** new env var, add it to **BOTH**
  [.env.example](.env.example) **AND** the `api` service's `environment:` block in
  `docker-compose.yml` — otherwise it will be silently missing inside the container.

### CI/CD deploy pipeline (`.github/workflows/deploy.yml`)

Pushing to **`main`** auto-deploys to the production Azure VM via GitHub Actions
(`appleboy/ssh-action`). Hard-won gotchas from building this pipeline:

- **Use absolute paths, never `~`.** The deploy script `cd`s to
  `/home/vkaiadmin/vkai-insurance-provider-api` — **not** `~/vkai-insurance-provider-api`.
  Tilde does **not** reliably expand in this SSH action's non-interactive shell, so a `~`
  path silently lands in the wrong place and the deploy fails confusingly.
- **The health check needs a real wait + retry loop.** Postgres healthcheck + Prisma
  `migrate deploy` + API startup takes longer than a few seconds, so a single immediate
  `curl` races the boot and false-fails. The script waits **20s**, then retries the `/health`
  poll **5 times, 5s apart**, before giving up. Do not collapse this back to one early check.
- **Required per-repo secrets:** `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`. These are
  **this repo's own** secrets — **do NOT copy-paste them from the sibling client-api repo's
  values.** That mix-up happened once during setup (wrong host/key) and caused confusing
  early failures. Each repo deploys to its own VM with its own key.

## Keep documentation current

- If a change is **significant** — a new field, a new business rule, a new architectural
  decision, new infrastructure/pipeline, or a newly discovered gotcha — update this repo's
  own [BUSINESS_REQUIREMENTS.md](BUSINESS_REQUIREMENTS.md) and/or [README.md](README.md) **as
  part of the same commit**, not as a separate afterthought. Minor or purely cosmetic changes
  don't need a doc update.

## Git workflow

- Always work on the **`dev`** branch. **Never commit directly to `main`.**
- Commit and push to **`dev` only**. **Do not open or merge PRs** — the human handles all PR
  review and merges into `main`.

## Related repos (independent — do not assume knowledge of or edit from here)

- **`vkai-insurance-provider`** — this API's own frontend (Azure).
- **`vkai-insurance-client`** + **`vkai-insurance-client-api`** — the fully independent GCP
  client side. Different cloud, different database, no shared code. Never make changes to
  those repos from here, and don't assume their internals.
