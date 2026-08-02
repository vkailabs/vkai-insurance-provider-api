-- Add a derived, unique "key" to the policy catalog (source of truth).
-- Added nullable first, backfilled for existing rows, then made NOT NULL + UNIQUE.

-- AlterTable: add the column as nullable so existing rows can be backfilled.
ALTER TABLE "policy_catalog" ADD COLUMN "key" TEXT;

-- Backfill: derive a key for every existing row using the same algorithm as the
-- application (first char of each whitespace-delimited token, uppercased,
-- concatenated), enforcing uniqueness with a readable "-N" suffix scheme.
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT "id", "name" FROM "policy_catalog" WHERE "key" IS NULL ORDER BY "created_at" ASC
  LOOP
    SELECT string_agg(upper(left(t.tok, 1)), '' ORDER BY t.ord)
      INTO base
      FROM regexp_split_to_table(trim(coalesce(r."name", '')), '\s+')
        WITH ORDINALITY AS t(tok, ord)
      WHERE t.tok <> '';

    IF base IS NULL OR base = '' THEN
      base := 'PLAN';
    END IF;

    candidate := base;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM "policy_catalog" WHERE "key" = candidate) LOOP
      candidate := base || '-' || n;
      n := n + 1;
    END LOOP;

    UPDATE "policy_catalog" SET "key" = candidate WHERE "id" = r."id";
  END LOOP;
END $$;

-- Now that every row has a value, enforce NOT NULL.
ALTER TABLE "policy_catalog" ALTER COLUMN "key" SET NOT NULL;

-- CreateIndex: enforce uniqueness at the database level.
CREATE UNIQUE INDEX "policy_catalog_key_key" ON "policy_catalog"("key");
