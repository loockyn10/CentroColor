-- Pedidos «pendientes de presupuestar» (gemela de supabase/migrations/20261108000000_professional_requests.sql).
-- `quote_status` lo fija sólo la nube (un pedido de /profesionales sin cuenta nace `pending_quote` y deja de
-- serlo cuando CentroColor lo presupuesta); Desktop lo recibe por sincronización y nunca lo escribe.
-- Mientras está pendiente, sus ítems guardan un cero de relleno que no es un precio: no se puede cobrar ni
-- poner un importe a mano, y la interfaz lo muestra como «Pendiente de presupuestar», nunca como $0.

ALTER TABLE photo_jobs ADD COLUMN quote_status TEXT NOT NULL DEFAULT 'quoted'
  CHECK(quote_status IN ('quoted','pending_quote'));

CREATE TRIGGER work_payment_pending_quote_guard BEFORE INSERT ON work_payments
WHEN NEW.source_type = 'photo_job' AND EXISTS(
  SELECT 1 FROM photo_jobs j WHERE j.business_id = NEW.business_id AND j.id = NEW.photo_job_id AND j.quote_status = 'pending_quote')
BEGIN
  SELECT RAISE(ABORT, 'El pedido está pendiente de presupuestar: todavía no tiene un importe para cobrar.');
END;

CREATE TRIGGER photo_item_pending_quote_guard BEFORE UPDATE OF unit_price_cents,total_cents,price_list_id ON photo_job_items
WHEN NEW.sync_origin = 'local' AND (NEW.unit_price_cents <> 0 OR NEW.total_cents <> 0 OR NEW.price_list_id IS NOT NULL) AND EXISTS(
  SELECT 1 FROM photo_jobs j WHERE j.business_id = NEW.business_id AND j.id = NEW.photo_job_id AND j.quote_status = 'pending_quote')
BEGIN
  SELECT RAISE(ABORT, 'El pedido está pendiente de presupuestar: el importe lo fija CentroColor al presupuestarlo.');
END;

CREATE TRIGGER photo_job_pending_quote_status_guard BEFORE UPDATE OF status ON photo_jobs
WHEN NEW.quote_status = 'pending_quote' AND NEW.status IN ('ready','delivered') AND NEW.sync_origin = 'local'
BEGIN
  SELECT RAISE(ABORT, 'El pedido está pendiente de presupuestar: presupuestalo antes de marcarlo listo o entregado.');
END;
