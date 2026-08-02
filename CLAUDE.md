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

### Env vars must be in TWO places

- CORS is configured via `VKAI_INSURANCE_PROVIDER_API_ALLOWED_ORIGIN` and was included in
  [docker-compose.yml](docker-compose.yml)'s explicit `environment:` list **from the start**
  (a deliberate fix for an earlier client-side gotcha where an env var was missing at
  runtime). When adding **any** new env var, add it to **BOTH**
  [.env.example](.env.example) **AND** the `api` service's `environment:` block in
  `docker-compose.yml` — otherwise it will be silently missing inside the container.

## Git workflow

- Always work on the **`dev`** branch. **Never commit directly to `main`.**
- Commit and push to **`dev` only**. **Do not open or merge PRs** — the human handles all PR
  review and merges into `main`.

## Related repos (independent — do not assume knowledge of or edit from here)

- **`vkai-insurance-provider`** — this API's own frontend (Azure).
- **`vkai-insurance-client`** + **`vkai-insurance-client-api`** — the fully independent GCP
  client side. Different cloud, different database, no shared code. Never make changes to
  those repos from here, and don't assume their internals.
