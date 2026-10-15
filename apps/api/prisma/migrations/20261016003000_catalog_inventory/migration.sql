BEGIN;

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100),
    "description" VARCHAR(2000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "selling_price" DECIMAL(20,0) NOT NULL,
    "low_stock_threshold" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "on_hand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "balance_id" UUID NOT NULL,
    "reference_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(20,6),
    "reference_type" VARCHAR(24) NOT NULL,
    "reference_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(1000) NOT NULL,
    "approval_threshold" DECIMAL(18,3) NOT NULL DEFAULT 10,
    "approved_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(20,6),

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("organization_id","kind","year")
);

-- CreateIndex
CREATE INDEX "products_organization_id_status_name_idx" ON "products"("organization_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE INDEX "product_variants_organization_id_product_id_status_idx" ON "product_variants"("organization_id", "product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organization_id_id_key" ON "product_variants"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organization_id_sku_key" ON "product_variants"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_branch_id_status_idx" ON "warehouses"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_id_key" ON "warehouses"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_branch_id_id_key" ON "warehouses"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_one_active_default" ON "warehouses"("organization_id", "branch_id") WHERE (is_default AND status = 'ACTIVE');

-- CreateIndex
CREATE INDEX "stock_balances_organization_id_variant_id_idx" ON "stock_balances"("organization_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_organization_id_id_key" ON "stock_balances"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_organization_id_warehouse_id_variant_id_key" ON "stock_balances"("organization_id", "warehouse_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_reservations_organization_id_balance_id_status_idx" ON "stock_reservations"("organization_id", "balance_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_organization_id_balance_id_reference_id_key" ON "stock_reservations"("organization_id", "balance_id", "reference_id");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_warehouse_id_created_at_id_idx" ON "stock_movements"("organization_id", "warehouse_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_variant_id_created_at_id_idx" ON "stock_movements"("organization_id", "variant_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_organization_id_reference_type_reference_id_key" ON "stock_movements"("organization_id", "reference_type", "reference_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_one_opening" ON "stock_movements"("organization_id", "warehouse_id", "variant_id") WHERE (reference_type = 'OPENING');

-- CreateIndex
CREATE INDEX "stock_adjustments_organization_id_warehouse_id_status_creat_idx" ON "stock_adjustments"("organization_id", "warehouse_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_organization_id_id_key" ON "stock_adjustments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_organization_id_variant_id_idx" ON "stock_adjustment_items"("organization_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_items_organization_id_adjustment_id_varian_key" ON "stock_adjustment_items"("organization_id", "adjustment_id", "variant_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organization_id_balance_id_fkey" FOREIGN KEY ("organization_id", "balance_id") REFERENCES "stock_balances"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_approved_by_fkey" FOREIGN KEY ("organization_id", "approved_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_organization_id_adjustment_id_fkey" FOREIGN KEY ("organization_id", "adjustment_id") REFERENCES "stock_adjustments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE products ADD CONSTRAINT products_status_valid CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE product_variants
  ADD CONSTRAINT variants_status_valid CHECK (status IN ('ACTIVE','INACTIVE')),
  ADD CONSTRAINT variants_sku_canonical CHECK (sku = upper(btrim(sku)) AND sku <> ''),
  ADD CONSTRAINT variants_price_nonnegative CHECK (selling_price >= 0),
  ADD CONSTRAINT variants_threshold_nonnegative CHECK (low_stock_threshold >= 0);
ALTER TABLE warehouses
  ADD CONSTRAINT warehouses_status_valid CHECK (status IN ('ACTIVE','INACTIVE')),
  ADD CONSTRAINT warehouses_code_canonical CHECK (code = upper(btrim(code)) AND code <> '');
ALTER TABLE stock_balances
  ADD CONSTRAINT balances_on_hand_nonnegative CHECK (on_hand >= 0),
  ADD CONSTRAINT balances_reserved_valid CHECK (reserved >= 0 AND reserved <= on_hand),
  ADD CONSTRAINT balances_version_nonnegative CHECK (version >= 0);
ALTER TABLE stock_reservations
  ADD CONSTRAINT reservations_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT reservations_status_valid CHECK (status IN ('ACTIVE','RELEASED','CONSUMED'));
ALTER TABLE stock_movements
  ADD CONSTRAINT movements_type_quantity_valid CHECK (
    (reference_type IN ('OPENING','ADJUSTMENT_IN') AND quantity_delta > 0) OR
    (reference_type IN ('ADJUSTMENT_OUT','SHIPMENT_OUT') AND quantity_delta < 0)
  ),
  ADD CONSTRAINT movements_unit_cost_valid CHECK (
    (unit_cost IS NULL OR unit_cost >= 0) AND
    (reference_type IN ('OPENING','ADJUSTMENT_IN') OR unit_cost IS NULL)
  );
ALTER TABLE stock_adjustments
  ADD CONSTRAINT adjustments_kind_valid CHECK (kind IN ('OPENING','ADJUSTMENT')),
  ADD CONSTRAINT adjustments_status_valid CHECK (status IN ('DRAFT','APPROVED','POSTED','CANCELLED')),
  ADD CONSTRAINT adjustments_reason_required CHECK (length(btrim(reason)) > 0),
  ADD CONSTRAINT adjustments_threshold_valid CHECK (approval_threshold >= 0),
  ADD CONSTRAINT adjustments_different_approver CHECK (approved_by IS NULL OR approved_by <> created_by),
  ADD CONSTRAINT adjustments_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  ADD CONSTRAINT adjustments_approved_actor CHECK (status <> 'APPROVED' OR approved_by IS NOT NULL),
  ADD CONSTRAINT adjustments_posted_timestamp CHECK ((status = 'POSTED') = (posted_at IS NOT NULL));
ALTER TABLE stock_adjustment_items
  ADD CONSTRAINT adjustment_items_quantity_nonzero CHECK (quantity_delta <> 0),
  ADD CONSTRAINT adjustment_items_cost_valid CHECK (unit_cost IS NULL OR unit_cost >= 0);
ALTER TABLE document_sequences
  ADD CONSTRAINT sequences_kind_valid CHECK (kind IN ('SO','ADJ','SHIP')),
  ADD CONSTRAINT sequences_year_valid CHECK (year BETWEEN 1 AND 9999),
  ADD CONSTRAINT sequences_value_positive CHECK (next_value > 0);

CREATE FUNCTION reject_stock_movement_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_changes();

CREATE FUNCTION protect_transacted_sku() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sku IS DISTINCT FROM OLD.sku AND EXISTS (
    SELECT 1 FROM stock_movements WHERE organization_id = OLD.organization_id AND variant_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'SKU with stock history cannot change' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_variants_sku_immutable BEFORE UPDATE OF sku ON product_variants
FOR EACH ROW EXECUTE FUNCTION protect_transacted_sku();

COMMIT;

