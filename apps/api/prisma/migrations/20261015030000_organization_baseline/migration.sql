BEGIN;
CREATE TABLE "organizations" (
  "id" UUID NOT NULL, "code" VARCHAR(32) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'VND', "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_currency_check" CHECK ("currency" = 'VND')
);
CREATE TABLE "branches" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "code" VARCHAR(32) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branches_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");
COMMIT;
