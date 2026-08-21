# Business Requirements — vkai-insurance-provider-api

## Overview

This is the backend API for the **provider / ops side** of *VK AI Labs Insurance*, a
personal portfolio project. It is the system of record for the insurance operations team and
serves the provider frontend (`vkai-insurance-provider`). It runs on **Azure**.

The platform is split across two fully independent clouds that never share a database:

- **Provider side (Azure)** — *this repo* and its frontend. Ops staff (Reviewers/Approvers)
  manage the plan catalog and work claims here.
- **Client side (GCP)** — `vkai-insurance-client` + `vkai-insurance-client-api`. Policy
  holders enroll, pay premiums, and file claims there.

The two sides stay consistent by exchanging **event-enveloped HTTPS sync calls** — there is
no shared storage, no cross-cloud database link, and no shared runtime. Each side owns its
own Postgres instance.

## Responsibilities

This API owns the following provider-side concerns:

1. **Ops user authentication** — verifies Entra ID (Azure AD) JWTs on every ops request and
   upserts an `ops_users` record from the token claims. Group membership maps to an internal
   role (**Reviewer** or **Approver**).
2. **Policy catalog** — the **source of truth** for insurance plans. The client side only
   caches a read-only copy. It **pulls** that copy periodically from this API
   (`GET /v1/catalog/policies`) **and** — as of **VKAI-003** — receives an immediate
   **push** whenever a plan is created or edited/deactivated here, so its cache reflects with
   no wait. The pull remains the fallback; the push is best-effort with retry (see the
   outbound sync table below). Plans are created and edited/deactivated here.

   - **Auto-generated, locked plan key.** Every policy catalog entry carries a short `key`,
     generated **server-side on plan creation**. It is derived from the plan name by taking
     the **first character of each whitespace-separated token, uppercased, and concatenated**
     (e.g. `"Premium Gold 2024"` → `"PG2"`). On collision the key is made unique with a
     dash-numeric suffix (`"-2"`, `"-3"`, …). The key is **non-editable** once created and is
     displayed as a **prefix to the plan name** wherever the catalog is shown. As of
     **VKAI-002**, `key` is part of the cross-cloud catalog payload the client caches (see
     `GET /v1/catalog/policies` below); it is no longer provider-only.
3. **Enrollment processing** — enrollment instances originate on the client side and are
   mirrored into this API's `policies` table via inbound sync. Ops activates them, which
   pushes the new status back to the client.

   - **Provider Policy status values** are `pending | active | expired | cancelled`
     (free-string, no enum — adding a value needs no migration).
   - **Customer-initiated cancellation (VKAI-010 / VJS-49).** A customer may cancel a
     still-**pending** policy on the client portal before it is approved. This is the **first
     client → provider status push** (previously status changes only flowed provider → client
     on activation). The client emits `policy.cancelled` to the inbound
     `POST /v1/sync/policies/status` route (see cross-cloud table below); this API matches the
     policy by `client_policy_id` and sets its status to `cancelled`. This is an **authoritative
     inbound change** — it is **not** echoed back out to the client (that would loop). Once a
     policy is `cancelled`, **ops can no longer activate it**: `POST /v1/policies/:id/activate`
     refuses any non-`pending` policy with a **409** and performs no state change or push.
4. **Premium records** — premium payments are recorded on the client side and pushed here
   for visibility. They are stored passively; no outbound push back is required.

   - **`policyName` enrichment (VKAI-004).** `GET /v1/premiums` returns each premium enriched
     with a `policyName` field (string, or `null`), resolved **entirely from provider-local
     data** via the relational join `premium -> policy -> policyCatalog` (the catalog `name`).
     No cross-cloud call is made — the provider owns the catalog as source of truth. When the
     name can't be resolved (no linked policy, or no matching catalog row) `policyName` is
     `null` and the frontend renders the literal "Unknown plan". A deactivated-but-present plan
     (`isActive=false`) still has a catalog row and resolves to its real name normally — that is
     not a fallback case. This is read-only enrichment: no schema, sync-payload, or auth change.

   - **Stored `enrolment_date` on premiums (VKAI-009 / VJS-48).** Premiums now carry a **stored**
     `enrolment_date` column (Prisma `enrolmentDate DateTime?`, nullable). It is **sourced from
     the client premium-sync payload**: `POST /v1/sync/premiums` accepts a new **optional**
     snake_case field `enrolled_at` and persists it into `enrolment_date`. The handler stays
     idempotent on `event_id` and **tolerant of `enrolled_at` being absent** — a premium synced
     before the client change still succeeds: when `enrolled_at` is missing it falls back to the
     linked policy's `enrolledAt` (mirrored on the `policies` table), else `null` (never throws).
     `GET /v1/premiums` returns a new `enrolmentDate` field (ISO date string, or `null`):
     it prefers the stored `premium.enrolmentDate`, falls back to `premium.policy.enrolledAt`,
     else `null` — the same provider-local pattern as the VKAI-004 `policyName` enrichment
     (which is unchanged). A **one-time backfill** in the migration set `enrolment_date` for all
     existing premiums from `policies.enrolled_at` via the `policy_id` join ("apply to all
     existing records"); the backfill only touches rows still `NULL`, so it is safe to re-run.
     Contract field names (client-api and provider-UI depend on these exactly): inbound payload
     `enrolled_at`, stored column `enrolment_date`, response field `enrolmentDate`.
5. **Claims workflow** — the full claim lifecycle worked by ops:
   `Submitted → Under Review → Approved / Rejected → Paid`. Each transition is role-gated and
   pushes the resulting status back to the client side.

   - **`policyName` enrichment (VKAI-007).** `GET /v1/claims` returns each claim enriched with
     a `policyName` field (string, or `null`), resolved **entirely from provider-local data**
     via the relational join `claim -> policy -> policyCatalog` (the catalog `name`) — the same
     approach as the VKAI-004 premiums enrichment. No cross-cloud call is made — the provider
     owns the catalog as source of truth. When the name can't be resolved (no linked policy, or
     no matching catalog row) `policyName` is `null` and the frontend renders the literal
     "Unknown plan". A deactivated-but-present plan (`isActive=false`) still has a catalog row
     and resolves to its real name normally — that is not a fallback case. It is resolved
     per-request (not a stored/persisted column), so **new claims automatically get a Policy
     Name** with no backfill. This is read-only enrichment: no schema, sync-payload, or auth
     change, and the claims workflow endpoints are untouched.

## Data ownership & cross-cloud model

- This API maintains its **own independent Postgres database**, entirely separate from the
  client side's. No foreign keys cross the cloud boundary — client-side references are
  stored as opaque values (`client_user_ref`, `client_policy_id`, `client_claim_id`).
- Synchronization uses the **same event-enveloped pattern documented on the client-api
  side**. Every sync message is wrapped in a standard envelope:

  ```json
  {
    "event_id": "<uuid>",
    "event_type": "policy.activated",
    "occurred_at": "<iso-8601>",
    "source": "provider",
    "payload": { }
  }
  ```

- Reliability is built into every synced table via three fields — `sync_status`
  (`pending` / `synced` / `failed`), `sync_attempts`, and `event_id`:
  - **Idempotency** — inbound routes dedupe on `event_id` (or the business key
    `client_policy_id` / `client_claim_id`), so a retried delivery never creates a duplicate
    row.
  - **Retry** — a background job (every 5 minutes) re-pushes outbound rows still in
    `pending`/`failed` with `sync_attempts < 5`, reusing the stored `event_id` so the far
    side can dedupe.
  - **Resilience** — an ops action always succeeds locally even if its outbound sync push
    fails; the push is simply marked `failed` and retried later.

## Endpoint categories

### 1. Ops-authenticated routes (`Authorization: Bearer <Entra ID JWT>`)

Consumed by the provider frontend. Every request must carry a valid Entra ID token; the auth
middleware verifies it and attaches the resolved `ops_users` record. Sensitive actions are
**role-gated** via a `requireRole('Approver')` helper.

| Route | Access | Purpose |
| ----- | ------ | ------- |
| `GET /v1/policy-catalog` | any ops user | List plans |
| `POST /v1/policy-catalog` | **Approver** | Create a plan |
| `PATCH /v1/policy-catalog/:id` | **Approver** | Edit / deactivate a plan |
| `GET /v1/policies` | any ops user | List enrollments (`?status=pending` queue) |
| `POST /v1/policies/:id/activate` | **Approver** | Activate → push status to client (409 if the policy is not `pending`, e.g. `cancelled`, VKAI-010) |
| `GET /v1/premiums` | any ops user | View premium records (each row enriched with `policyName` and `enrolmentDate`, see notes below) |
| `GET /v1/claims` | any ops user | List claims (`?status=` filter; each row enriched with `policyName`, see note below) |
| `POST /v1/claims/:id/review` | Reviewer / Approver | → Under Review, push status |
| `POST /v1/claims/:id/approve` | **Approver** | → Approved, push status |
| `POST /v1/claims/:id/reject` | **Approver** | → Rejected, push status |
| `POST /v1/claims/:id/mark-paid` | **Approver** | → Paid (only from Approved), push status |
| `GET /v1/sync-issues` | any ops user | Rows where `sync_status = failed` |

> A Reviewer touching a claim before an Approver acts is **not** enforced — any Approver may
> act on a claim regardless of its review history (deliberate scope decision).

### 2. Cross-cloud routes (`X-VKAI-Sync-Key` shared secret)

**Not** protected by the ops JWT. These are the machine-to-machine boundary between the two
clouds, protected instead by a shared secret header. The client side calls **into** these,
and this API's own outbound sync calls back **into** the client side's equivalent routes
using the same key.

| Route | Direction | Purpose |
| ----- | --------- | ------- |
| `GET /v1/catalog/policies` | client **pulls** from provider | Active catalog rows to cache (includes `key` as of VKAI-002) |
| `POST /v1/sync/policies` | client **pushes** to provider | New enrollment → `policies` (pending) |
| `POST /v1/sync/premiums` | client **pushes** to provider | Premium payment → `premiums` (accepts optional `enrolled_at` → `enrolment_date`, VKAI-009) |
| `POST /v1/sync/claims` | client **pushes** to provider | New claim → `claims` (Submitted) |
| `POST /v1/sync/policies/status` | client **pushes** to provider | Customer-initiated policy status change → `policies` (VKAI-010). Only `policy.cancelled` is accepted today: matched by `client_policy_id`, sets status to `cancelled`; idempotent on already-`cancelled`; not echoed back |

Outbound (provider → client), triggered by ops actions:

| Called after | Target on client side | Event type |
| ------------ | --------------------- | ---------- |
| Policy activation | `POST /v1/sync/policies/status` | `policy.activated` |
| Any claim status change | `POST /v1/sync/claims/status` | `claim.<status>` |
| Catalog create or edit/deactivate | `POST /v1/sync/catalog` | `catalog.upserted` |

The **catalog push** (VKAI-003) uses the same reliability trio as the other outbound rows:
`sync_status` / `sync_attempts` / `event_id` now live on `policy_catalog` too, the 5-minute
retry job re-pushes any catalog row not confirmed `synced`, and the ops create/edit always
succeeds locally even if the push fails. The payload is the full catalog row the client
upserts into its cache — camelCase, mirroring the `GET /v1/catalog/policies` pull shape:
`{ id, key, name, description, premiumAmount, coverageAmount, isActive, createdAt }`. The
client **dedupes/upserts on `payload.id`** (the provider catalog UUID). A deactivation is
pushed as a normal `catalog.upserted` with `isActive: false`.

## Infrastructure

- Deployed live on an **Azure VM** under Docker, fronted by **Nginx** with **Let's Encrypt**
  SSL. Pushing to `main` auto-deploys via GitHub Actions (pull, rebuild containers, health
  check). See [README.md](README.md#deployment) for details.

## Non-goals (this repo)

- No provider frontend code (separate repo, `vkai-insurance-provider`).
- No creation of the actual Entra ID app registration (manual Azure Portal step).
- No knowledge of or changes to the GCP client-side repos.
