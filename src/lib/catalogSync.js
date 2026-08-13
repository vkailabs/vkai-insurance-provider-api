'use strict';

// Shared constants + payload shape for the outbound policy-catalog push (VKAI-003).
//
// The provider is the source of truth for the catalog; whenever a plan is created
// or edited/deactivated we push the full row to the client so its cached copy
// reflects immediately (the client's periodic GET /v1/catalog/policies pull stays
// as the fallback). Both the route push and the cron retry MUST send an identical
// payload, so the shape lives here in one place to prevent drift.
//
// Payload field names are camelCase on purpose: they mirror the GET
// /v1/catalog/policies pull response one-for-one, because the client feeds the
// SAME cached-catalog copy from both the pull and this push. (The envelope itself
// — event_id/event_type/occurred_at/source/payload — stays snake_case as usual.)
//
// Idempotency: the client upserts on the provider catalog `id` (payload.id), so a
// re-delivered or retried push is naturally idempotent regardless of event_id.

const CATALOG_SYNC_PATH = '/v1/sync/catalog';
const CATALOG_EVENT_TYPE = 'catalog.upserted';

function buildCatalogSyncPayload(row) {
  return {
    id: row.id, // provider catalog UUID — business/idempotency key the client dedupes on
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    premiumAmount: row.premiumAmount,
    coverageAmount: row.coverageAmount,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

module.exports = { CATALOG_SYNC_PATH, CATALOG_EVENT_TYPE, buildCatalogSyncPayload };
