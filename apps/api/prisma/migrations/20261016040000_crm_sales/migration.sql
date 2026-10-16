BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM stock_reservations WHERE status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Release Phase 2 ACTIVE reservations through Inventory before applying the Sales migration';
  END IF;
END;
$$;
-- AlterTable
ALTER TABLE "stock_reservations" ADD COLUMN     "order_item_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "address" VARCHAR(1000),
    "notes" VARCHAR(2000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "subtotal" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "discount_type" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "discount_value" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "note" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(20,0) NOT NULL,
    "line_total" DECIMAL(20,0) NOT NULL,
    "delivered_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "external_reference" VARCHAR(200),
    "reason" VARCHAR(1000) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "lock_token" UUID,
    "published_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_branch_id_name_idx" ON "customers"("organization_id", "branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_branch_id_id_key" ON "customers"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_branch_id_status_created_at_id_idx" ON "sales_orders"("organization_id", "branch_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "sales_orders_organization_id_created_by_idx" ON "sales_orders"("organization_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_id_key" ON "sales_orders"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_branch_id_id_key" ON "sales_orders"("organization_id", "branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_order_number_key" ON "sales_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "sales_order_items_organization_id_variant_id_idx" ON "sales_order_items"("organization_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_organization_id_id_key" ON "sales_order_items"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_organization_id_order_id_id_key" ON "sales_order_items"("organization_id", "order_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_organization_id_order_id_variant_id_key" ON "sales_order_items"("organization_id", "order_id", "variant_id");

-- CreateIndex
CREATE INDEX "shipments_organization_id_created_at_idx" ON "shipments"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_organization_id_order_id_id_key" ON "shipments"("organization_id", "order_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_one_active_per_order" ON "shipments"("organization_id", "order_id") WHERE (((status)::text = 'DRAFT'::text) OR ((status)::text = 'POSTED'::text));

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_organization_id_shipment_id_order_item_id_key" ON "shipment_items"("organization_id", "shipment_id", "order_item_id");

-- CreateIndex
CREATE INDEX "order_events_organization_id_order_id_created_at_id_idx" ON "order_events"("organization_id", "order_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "payments_organization_id_sales_order_id_created_at_id_idx" ON "payments"("organization_id", "sales_order_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_unique_external_reference" ON "payments"("organization_id", "method", "external_reference") WHERE (external_reference IS NOT NULL);

-- CreateIndex
CREATE INDEX "outbox_events_unpublished" ON "outbox_events"("available_at", "id") WHERE (published_at IS NULL);

-- CreateIndex
CREATE INDEX "stock_reservations_organization_id_order_item_id_idx" ON "stock_reservations"("organization_id", "order_item_id");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organization_id_order_item_id_fkey" FOREIGN KEY ("organization_id", "order_item_id") REFERENCES "sales_order_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_branch_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_branch_id_customer_id_fkey" FOREIGN KEY ("organization_id", "branch_id", "customer_id") REFERENCES "customers"("organization_id", "branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "sales_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_organization_id_variant_id_fkey" FOREIGN KEY ("organization_id", "variant_id") REFERENCES "product_variants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "sales_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_organization_id_order_id_shipment_id_fkey" FOREIGN KEY ("organization_id", "order_id", "shipment_id") REFERENCES "shipments"("organization_id", "order_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_organization_id_order_id_order_item_id_fkey" FOREIGN KEY ("organization_id", "order_id", "order_item_id") REFERENCES "sales_order_items"("organization_id", "order_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organization_id_order_id_fkey" FOREIGN KEY ("organization_id", "order_id") REFERENCES "sales_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organization_id_actor_id_fkey" FOREIGN KEY ("organization_id", "actor_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_sales_order_id_fkey" FOREIGN KEY ("organization_id", "sales_order_id") REFERENCES "sales_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE stock_reservations ADD CONSTRAINT reservations_active_order_item
  CHECK (status <> 'ACTIVE' OR order_item_id IS NOT NULL);
ALTER TABLE customers
  ADD CONSTRAINT customers_name_valid CHECK (name = btrim(name) AND length(name) > 0),
  ADD CONSTRAINT customers_status_valid CHECK (status IN ('ACTIVE','INACTIVE')),
  ADD CONSTRAINT customers_email_canonical CHECK (email IS NULL OR (email = lower(btrim(email)) AND length(email) > 0));
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_number_valid CHECK (order_number = upper(btrim(order_number)) AND length(order_number) > 0),
  ADD CONSTRAINT sales_orders_status_valid CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED','FULFILLED')),
  ADD CONSTRAINT sales_orders_currency_vnd CHECK (currency = 'VND'),
  ADD CONSTRAINT sales_orders_version_nonnegative CHECK (version >= 0),
  ADD CONSTRAINT sales_orders_totals_valid CHECK (subtotal >= 0 AND discount_total >= 0 AND discount_total <= subtotal AND tax_total = 0 AND grand_total = subtotal - discount_total),
  ADD CONSTRAINT sales_orders_discount_valid CHECK (
    (discount_type = 'NONE' AND discount_value = 0 AND discount_total = 0)
    OR (discount_type = 'AMOUNT' AND discount_value >= 0 AND discount_value = trunc(discount_value) AND discount_total = discount_value)
    OR (discount_type = 'PERCENT' AND discount_value BETWEEN 0 AND 100 AND discount_value = round(discount_value, 2) AND discount_total = round(subtotal * discount_value / 100))
  );
ALTER TABLE sales_order_items
  ADD CONSTRAINT sales_order_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT sales_order_items_prices_nonnegative CHECK (unit_price >= 0 AND line_total >= 0 AND line_total = round(quantity * unit_price)),
  ADD CONSTRAINT sales_order_items_delivered_valid CHECK (delivered_quantity >= 0 AND delivered_quantity <= quantity),
  ADD CONSTRAINT sales_order_items_snapshot_valid CHECK (length(btrim(sku)) > 0 AND length(btrim(product_name)) > 0);
ALTER TABLE shipments
  ADD CONSTRAINT shipments_status_valid CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  ADD CONSTRAINT shipments_posted_valid CHECK ((status = 'POSTED') = (posted_at IS NOT NULL));
ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE order_events
  ADD CONSTRAINT order_events_action_valid CHECK (length(btrim(action)) > 0),
  ADD CONSTRAINT order_events_payload_size CHECK (octet_length(payload::text) <= 16384);
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payments_method_valid CHECK (method IN ('CASH','BANK_TRANSFER')),
  ADD CONSTRAINT payments_reason_valid CHECK (length(btrim(reason)) > 0),
  ADD CONSTRAINT payments_reference_valid CHECK (
    (external_reference IS NULL OR (external_reference = upper(btrim(external_reference)) AND length(external_reference) > 0))
    AND (method <> 'BANK_TRANSFER' OR external_reference IS NOT NULL)
  );
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_status_valid CHECK (status IN ('PENDING','PROCESSING','PUBLISHED','DEAD')),
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK (attempts >= 0),
  ADD CONSTRAINT outbox_payload_size CHECK (octet_length(payload::text) <= 16384),
  ADD CONSTRAINT outbox_lease_valid CHECK ((status = 'PROCESSING' AND locked_until IS NOT NULL AND lock_token IS NOT NULL) OR (status <> 'PROCESSING' AND locked_until IS NULL AND lock_token IS NULL)),
  ADD CONSTRAINT outbox_published_valid CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL));

CREATE FUNCTION protect_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('CANCELLED','FULFILLED') THEN
    RAISE EXCEPTION 'Terminal sales orders are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Confirmed orders cannot be deleted' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id,NEW.organization_id,NEW.branch_id,NEW.warehouse_id,NEW.created_by,NEW.order_number,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.branch_id,OLD.warehouse_id,OLD.created_by,OLD.order_number,OLD.created_at) THEN
    RAISE EXCEPTION 'Order identity and warehouse snapshot are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'CONFIRMED' THEN
    IF NEW.status NOT IN ('CONFIRMED','CANCELLED','FULFILLED') OR
      ROW(NEW.customer_id,NEW.currency,NEW.subtotal,NEW.discount_type,NEW.discount_value,NEW.discount_total,NEW.tax_total,NEW.grand_total,NEW.note)
      IS DISTINCT FROM ROW(OLD.customer_id,OLD.currency,OLD.subtotal,OLD.discount_type,OLD.discount_value,OLD.discount_total,OLD.tax_total,OLD.grand_total,OLD.note) THEN
      RAISE EXCEPTION 'Confirmed order snapshots are immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status = 'FULFILLED' THEN
    RAISE EXCEPTION 'Draft orders cannot be fulfilled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_orders_immutable BEFORE UPDATE OR DELETE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION protect_sales_order();

CREATE FUNCTION protect_sales_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  old_parent UUID;
  new_parent UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_parent := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_parent := NEW.order_id; END IF;
  FOR parent IN SELECT id,status FROM sales_orders WHERE id IN (old_parent,new_parent) ORDER BY id FOR UPDATE
  LOOP
    IF parent.status <> 'DRAFT' THEN
      IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Confirmed order lines are immutable' USING ERRCODE = '55000'; END IF;
      IF parent.id IS DISTINCT FROM old_parent OR parent.id IS DISTINCT FROM new_parent OR parent.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Confirmed order lines are immutable' USING ERRCODE = '55000';
      END IF;
      IF ROW(NEW.id,NEW.organization_id,NEW.order_id,NEW.variant_id,NEW.sku,NEW.product_name,NEW.quantity,NEW.unit_price,NEW.line_total,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.order_id,OLD.variant_id,OLD.sku,OLD.product_name,OLD.quantity,OLD.unit_price,OLD.line_total,OLD.created_at)
        OR NEW.delivered_quantity < OLD.delivered_quantity THEN
        RAISE EXCEPTION 'Confirmed order snapshots are immutable' USING ERRCODE = '55000';
      END IF;
    ELSIF TG_OP <> 'DELETE' THEN
      IF parent.id = new_parent AND NEW.delivered_quantity <> 0 THEN
        RAISE EXCEPTION 'Draft order lines cannot be delivered' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_order_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_order_items
FOR EACH ROW EXECUTE FUNCTION protect_sales_order_item();

CREATE FUNCTION protect_shipment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Committed shipments are immutable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF ROW(NEW.id,NEW.organization_id,NEW.order_id,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.order_id,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'Shipment identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shipments_immutable BEFORE UPDATE OR DELETE ON shipments
FOR EACH ROW EXECUTE FUNCTION protect_shipment();

CREATE FUNCTION protect_shipment_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  old_parent UUID;
  new_parent UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_parent := OLD.shipment_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_parent := NEW.shipment_id; END IF;
  FOR parent IN SELECT id,status FROM shipments WHERE id IN (old_parent,new_parent) ORDER BY id FOR UPDATE
  LOOP
    IF parent.status <> 'DRAFT' THEN RAISE EXCEPTION 'Committed shipment lines are immutable' USING ERRCODE = '55000'; END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shipment_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON shipment_items
FOR EACH ROW EXECUTE FUNCTION protect_shipment_item();

CREATE FUNCTION reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER order_events_immutable BEFORE UPDATE OR DELETE ON order_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION protect_transacted_sku() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sku IS DISTINCT FROM OLD.sku AND (
    EXISTS (SELECT 1 FROM stock_movements WHERE organization_id = OLD.organization_id AND variant_id = OLD.id)
    OR EXISTS (SELECT 1 FROM sales_order_items WHERE organization_id = OLD.organization_id AND variant_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'SKU with stock history or sales history cannot change' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
