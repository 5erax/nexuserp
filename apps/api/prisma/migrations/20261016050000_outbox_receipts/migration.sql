BEGIN;

-- CreateTable
CREATE TABLE "outbox_receipts" (
    "event_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_receipts_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_receipts_organization_id_event_id_key" ON "outbox_receipts"("organization_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_organization_id_id_key" ON "outbox_events"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "outbox_receipts" ADD CONSTRAINT "outbox_receipts_organization_id_event_id_fkey" FOREIGN KEY ("organization_id", "event_id") REFERENCES "outbox_events"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER outbox_receipts_immutable BEFORE UPDATE OR DELETE ON outbox_receipts
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

COMMIT;
