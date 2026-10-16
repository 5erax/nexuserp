BEGIN;

ALTER TABLE stock_adjustments ADD COLUMN decision_reason VARCHAR(1000);
ALTER TABLE stock_adjustments DROP CONSTRAINT adjustments_status_valid;
ALTER TABLE stock_adjustments
  ADD CONSTRAINT adjustments_status_valid CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED','REJECTED')),
  ADD CONSTRAINT adjustments_rejection_reason CHECK (status <> 'REJECTED' OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0));
ALTER TABLE stock_adjustment_items
  ADD CONSTRAINT adjustment_items_outbound_cost_null CHECK (quantity_delta > 0 OR unit_cost IS NULL);

CREATE FUNCTION protect_posted_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted stock adjustments are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_adjustments_immutable BEFORE UPDATE OR DELETE ON stock_adjustments
FOR EACH ROW EXECUTE FUNCTION protect_posted_adjustment();

CREATE FUNCTION protect_adjustment_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  old_parent UUID;
  new_parent UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_parent := OLD.adjustment_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_parent := NEW.adjustment_id; END IF;
  FOR parent IN SELECT id, status, kind FROM stock_adjustments
    WHERE id IN (old_parent, new_parent) ORDER BY id FOR UPDATE
  LOOP
    IF parent.status = 'POSTED' THEN
      RAISE EXCEPTION 'Posted stock adjustment items are immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF parent.id = new_parent AND parent.kind = 'OPENING' AND NEW.quantity_delta <= 0 THEN
        RAISE EXCEPTION 'Opening stock must be positive' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_adjustment_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON stock_adjustment_items
FOR EACH ROW EXECUTE FUNCTION protect_adjustment_items();

COMMIT;
