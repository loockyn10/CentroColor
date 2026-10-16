CREATE TABLE work_payments (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN('event','frame_job','photo_job')),
  event_id TEXT,
  frame_job_id TEXT,
  photo_job_id TEXT,
  payment_kind TEXT NOT NULL CHECK(payment_kind IN('deposit','payment','refund')),
  payment_method TEXT NOT NULL CHECK(payment_method IN('cash','transfer','debit_card','credit_card','mercado_pago','other')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  occurred_at TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN('posted','voided')),
  created_by TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_origin TEXT NOT NULL DEFAULT 'local' CHECK(sync_origin IN('local','remote')),
  local_revision INTEGER NOT NULL DEFAULT 1,
  cloud_updated_at TEXT,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,event_id) REFERENCES events(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,frame_job_id) REFERENCES frame_jobs(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,photo_job_id) REFERENCES photo_jobs(business_id,id) ON DELETE RESTRICT,
  CHECK(
    (source_type='event' AND event_id IS NOT NULL AND frame_job_id IS NULL AND photo_job_id IS NULL) OR
    (source_type='frame_job' AND event_id IS NULL AND frame_job_id IS NOT NULL AND photo_job_id IS NULL) OR
    (source_type='photo_job' AND event_id IS NULL AND frame_job_id IS NULL AND photo_job_id IS NOT NULL)
  ),
  CHECK(
    (status='posted' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR
    (status='voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(void_reason)) > 0)
  )
);
CREATE INDEX work_payments_source_idx ON work_payments(business_id,source_type,event_id,frame_job_id,photo_job_id,occurred_at DESC);
CREATE INDEX work_payments_customer_idx ON work_payments(business_id,customer_id,occurred_at DESC);
CREATE INDEX work_payments_sync_idx ON work_payments(business_id,updated_at,id);

CREATE TRIGGER work_payment_validate_insert BEFORE INSERT ON work_payments BEGIN
  SELECT CASE WHEN NEW.sync_origin='local' AND NOT EXISTS (
    SELECT 1 FROM authorized_context a WHERE a.slot=1 AND a.business_id=NEW.business_id AND a.branch_id=NEW.branch_id AND a.user_id=NEW.created_by
  ) THEN RAISE(ABORT,'El pago no corresponde al contexto autorizado.') END;
  SELECT CASE WHEN NEW.source_type='event' AND NOT EXISTS (
    SELECT 1 FROM events e WHERE e.business_id=NEW.business_id AND e.id=NEW.event_id AND e.branch_id=NEW.branch_id AND e.customer_id=NEW.customer_id
  ) THEN RAISE(ABORT,'Evento, cliente o sucursal no corresponden al pago.') END;
  SELECT CASE WHEN NEW.source_type='frame_job' AND NOT EXISTS (
    SELECT 1 FROM frame_jobs j WHERE j.business_id=NEW.business_id AND j.id=NEW.frame_job_id AND j.branch_id=NEW.branch_id AND j.customer_id=NEW.customer_id
  ) THEN RAISE(ABORT,'Trabajo de marquetería, cliente o sucursal no corresponden al pago.') END;
  SELECT CASE WHEN NEW.source_type='photo_job' AND NOT EXISTS (
    SELECT 1 FROM photo_jobs j WHERE j.business_id=NEW.business_id AND j.id=NEW.photo_job_id AND j.branch_id=NEW.branch_id AND j.customer_id=NEW.customer_id
  ) THEN RAISE(ABORT,'Trabajo fotográfico, cliente o sucursal no corresponden al pago.') END;
  SELECT CASE WHEN NEW.sync_origin='local' AND NEW.payment_kind IN('deposit','payment') AND NEW.amount_cents > (
    CASE NEW.source_type
      WHEN 'event' THEN (SELECT COALESCE((SELECT sum(total_cents) FROM event_service_items WHERE business_id=NEW.business_id AND event_id=NEW.event_id AND is_active=1),0)+COALESCE((SELECT sum(price_cents) FROM resource_reservations WHERE business_id=NEW.business_id AND event_id=NEW.event_id AND is_active=1),0))
      WHEN 'frame_job' THEN (SELECT q.total_cents FROM frame_jobs j JOIN frame_quotes q ON q.business_id=j.business_id AND q.id=j.quote_id WHERE j.business_id=NEW.business_id AND j.id=NEW.frame_job_id)
      ELSE (SELECT COALESCE(sum(total_cents),0) FROM photo_job_items WHERE business_id=NEW.business_id AND photo_job_id=NEW.photo_job_id AND is_active=1)
    END
    - COALESCE((SELECT sum(CASE WHEN payment_kind='refund' THEN -amount_cents ELSE amount_cents END) FROM work_payments p WHERE p.business_id=NEW.business_id AND p.status='posted' AND NOT EXISTS(SELECT 1 FROM work_payment_sync_outbox o WHERE o.business_id=p.business_id AND o.payment_id=p.id AND o.status='conflict') AND ((NEW.source_type='event' AND p.event_id=NEW.event_id) OR (NEW.source_type='frame_job' AND p.frame_job_id=NEW.frame_job_id) OR (NEW.source_type='photo_job' AND p.photo_job_id=NEW.photo_job_id))),0)
  ) THEN RAISE(ABORT,'El importe supera el saldo máximo cobrable.') END;
  SELECT CASE WHEN NEW.sync_origin='local' AND NEW.payment_kind='refund' AND NEW.amount_cents > COALESCE((
    SELECT sum(CASE WHEN payment_kind='refund' THEN -amount_cents ELSE amount_cents END) FROM work_payments p WHERE p.business_id=NEW.business_id AND p.status='posted' AND NOT EXISTS(SELECT 1 FROM work_payment_sync_outbox o WHERE o.business_id=p.business_id AND o.payment_id=p.id AND o.status='conflict') AND ((NEW.source_type='event' AND p.event_id=NEW.event_id) OR (NEW.source_type='frame_job' AND p.frame_job_id=NEW.frame_job_id) OR (NEW.source_type='photo_job' AND p.photo_job_id=NEW.photo_job_id))
  ),0) THEN RAISE(ABORT,'La devolución supera el neto efectivamente pagado.') END;
END;

CREATE TRIGGER work_payment_immutable BEFORE UPDATE ON work_payments BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.business_id<>OLD.business_id OR NEW.branch_id<>OLD.branch_id OR NEW.customer_id<>OLD.customer_id OR NEW.source_type<>OLD.source_type OR NEW.event_id IS NOT OLD.event_id OR NEW.frame_job_id IS NOT OLD.frame_job_id OR NEW.photo_job_id IS NOT OLD.photo_job_id OR NEW.payment_kind<>OLD.payment_kind OR NEW.payment_method<>OLD.payment_method OR NEW.amount_cents<>OLD.amount_cents OR NEW.occurred_at<>OLD.occurred_at OR NEW.notes IS NOT OLD.notes OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE(ABORT,'Los datos históricos del pago son inmutables.') END;
  SELECT CASE WHEN OLD.status='voided' AND NEW.status<>'voided' THEN RAISE(ABORT,'Un pago anulado no puede reactivarse.') END;
  SELECT CASE WHEN NEW.status='voided' AND NEW.sync_origin='local' AND NOT EXISTS (
    SELECT 1 FROM authorized_context a WHERE a.slot=1 AND a.business_id=NEW.business_id AND a.user_id=NEW.voided_by AND a.role IN('owner','admin')
  ) THEN RAISE(ABORT,'Sólo owner/admin puede anular pagos.') END;
  SELECT CASE WHEN NEW.status='voided' AND OLD.status='posted' AND NEW.sync_origin='local' AND COALESCE((
    SELECT sum(CASE WHEN payment_kind='refund' THEN -amount_cents ELSE amount_cents END) FROM work_payments p WHERE p.business_id=OLD.business_id AND p.id<>OLD.id AND p.status='posted' AND NOT EXISTS(SELECT 1 FROM work_payment_sync_outbox o WHERE o.business_id=p.business_id AND o.payment_id=p.id AND o.status='conflict') AND ((OLD.source_type='event' AND p.event_id=OLD.event_id) OR (OLD.source_type='frame_job' AND p.frame_job_id=OLD.frame_job_id) OR (OLD.source_type='photo_job' AND p.photo_job_id=OLD.photo_job_id))
  ),0) < 0 THEN RAISE(ABORT,'La anulación dejaría devoluciones sin pago que las respalde.') END;
  SELECT CASE WHEN NEW.status='voided' AND OLD.status='posted' AND NEW.sync_origin='local' AND COALESCE((
    SELECT sum(CASE WHEN payment_kind='refund' THEN -amount_cents ELSE amount_cents END) FROM work_payments p WHERE p.business_id=OLD.business_id AND p.id<>OLD.id AND p.status='posted' AND NOT EXISTS(SELECT 1 FROM work_payment_sync_outbox o WHERE o.business_id=p.business_id AND o.payment_id=p.id AND o.status='conflict') AND ((OLD.source_type='event' AND p.event_id=OLD.event_id) OR (OLD.source_type='frame_job' AND p.frame_job_id=OLD.frame_job_id) OR (OLD.source_type='photo_job' AND p.photo_job_id=OLD.photo_job_id))
  ),0) > (CASE OLD.source_type
    WHEN 'event' THEN (SELECT COALESCE((SELECT sum(total_cents) FROM event_service_items WHERE business_id=OLD.business_id AND event_id=OLD.event_id AND is_active=1),0)+COALESCE((SELECT sum(price_cents) FROM resource_reservations WHERE business_id=OLD.business_id AND event_id=OLD.event_id AND is_active=1),0))
    WHEN 'frame_job' THEN (SELECT q.total_cents FROM frame_jobs j JOIN frame_quotes q ON q.business_id=j.business_id AND q.id=j.quote_id WHERE j.business_id=OLD.business_id AND j.id=OLD.frame_job_id)
    ELSE (SELECT COALESCE(sum(total_cents),0) FROM photo_job_items WHERE business_id=OLD.business_id AND photo_job_id=OLD.photo_job_id AND is_active=1)
  END) THEN RAISE(ABORT,'La anulación dejaría el trabajo con sobrepago.') END;
END;

CREATE TABLE work_payment_sync_outbox (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  local_revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','conflict')),
  UNIQUE(business_id,payment_id)
);
CREATE TABLE work_payment_sync_cursor (
  business_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  last_success_at TEXT NOT NULL
);
CREATE TRIGGER work_payment_outbox_insert AFTER INSERT ON work_payments WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO work_payment_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending')
  ON CONFLICT(business_id,payment_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER work_payment_outbox_void AFTER UPDATE OF status ON work_payments WHEN NEW.sync_origin='local' BEGIN
  INSERT INTO work_payment_sync_outbox VALUES(lower(hex(randomblob(16))),NEW.business_id,NEW.id,NEW.updated_at,NEW.local_revision,0,NULL,'pending')
  ON CONFLICT(business_id,payment_id) DO UPDATE SET local_revision=excluded.local_revision,created_at=excluded.created_at,status='pending',attempts=0,last_error=NULL;
END;
