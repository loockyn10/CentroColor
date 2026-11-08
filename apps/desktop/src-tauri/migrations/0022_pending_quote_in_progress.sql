-- Un pedido «pendiente de presupuestar» tampoco pasa a «En proceso» desde Desktop: primero se presupuesta
-- (en la Web) y después sigue producción. Reemplaza el trigger de 0021, que sólo bloqueaba listo/entregado
-- (gemela de supabase/migrations/20261108010000_professional_requests_hardening.sql). Cancelar sigue
-- permitido y lo que llega de la nube por sincronización (sync_origin distinto de 'local') no se bloquea.

DROP TRIGGER photo_job_pending_quote_status_guard;

CREATE TRIGGER photo_job_pending_quote_status_guard BEFORE UPDATE OF status ON photo_jobs
WHEN NEW.quote_status = 'pending_quote' AND NEW.status IN ('in_progress','ready','delivered') AND NEW.sync_origin = 'local'
BEGIN
  SELECT RAISE(ABORT, 'El pedido está pendiente de presupuestar: presupuestalo antes de pasarlo a «En proceso», listo o entregado.');
END;
