-- VKAI-009: add a STORED `enrolment_date` to premiums. It is sourced from the
-- client premium-sync payload (`enrolled_at`), falling back to the linked policy's
-- `enrolled_at` when the payload field is absent. Nullable to stay
-- backward-compatible with premiums synced before this column existed.

-- AlterTable
ALTER TABLE "premiums" ADD COLUMN "enrolment_date" TIMESTAMP(3);

-- One-time backfill for existing rows ("apply to all existing records"): derive
-- each premium's enrolment_date from the already-mirrored policies.enrolled_at via
-- the policy_id join. Idempotent and safe to re-run: it only fills rows where the
-- column is still NULL, so it never overwrites a value set from a real payload.
UPDATE "premiums" AS p
SET "enrolment_date" = pol."enrolled_at"
FROM "policies" AS pol
WHERE p."policy_id" = pol."id"
  AND p."enrolment_date" IS NULL;
