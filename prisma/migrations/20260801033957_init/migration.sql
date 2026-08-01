-- CreateTable
CREATE TABLE "ops_users" (
    "id" UUID NOT NULL,
    "entra_object_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_catalog" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "premium_amount" DECIMAL(12,2) NOT NULL,
    "coverage_amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "policy_catalog_id" UUID NOT NULL,
    "client_policy_id" UUID NOT NULL,
    "client_user_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "enrolled_at" TIMESTAMP(3) NOT NULL,
    "expiry_date" DATE NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "event_id" UUID,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premiums" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'synced',
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "event_id" UUID,

    CONSTRAINT "premiums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "client_claim_id" UUID NOT NULL,
    "amount_claimed" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "reviewed_by" UUID,
    "approved_by" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "event_id" UUID,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_users_entra_object_id_key" ON "ops_users"("entra_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "ops_users_email_key" ON "ops_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "policies_client_policy_id_key" ON "policies"("client_policy_id");

-- CreateIndex
CREATE INDEX "policies_status_idx" ON "policies"("status");

-- CreateIndex
CREATE INDEX "policies_sync_status_idx" ON "policies"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "premiums_event_id_key" ON "premiums"("event_id");

-- CreateIndex
CREATE INDEX "premiums_sync_status_idx" ON "premiums"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "claims_client_claim_id_key" ON "claims"("client_claim_id");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claims_sync_status_idx" ON "claims"("sync_status");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_policy_catalog_id_fkey" FOREIGN KEY ("policy_catalog_id") REFERENCES "policy_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premiums" ADD CONSTRAINT "premiums_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "ops_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "ops_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
