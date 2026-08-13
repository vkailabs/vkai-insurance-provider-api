-- VKAI-003: extend the outbound-sync reliability trio to the policy catalog so a
-- catalog create/edit can be PUSHED to the client cache immediately (with the
-- existing 5-minute retry sweep as backstop). The client's periodic
-- GET /v1/catalog/policies pull remains unchanged as the fallback.

-- AlterTable: mirror the sync_status / sync_attempts / event_id fields already
-- present on policies & claims.
ALTER TABLE "policy_catalog" ADD COLUMN "sync_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "policy_catalog" ADD COLUMN "sync_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "policy_catalog" ADD COLUMN "event_id" UUID;

-- Existing catalog rows predate push-sync and are already reflected in the client
-- cache via the pull endpoint. Mark them 'synced' so the retry sweep does not
-- immediately re-push the entire pre-existing catalog on first deploy. New rows
-- created/edited after this migration start at 'pending' and are pushed normally.
UPDATE "policy_catalog" SET "sync_status" = 'synced';

-- CreateIndex
CREATE INDEX "policy_catalog_sync_status_idx" ON "policy_catalog"("sync_status");
