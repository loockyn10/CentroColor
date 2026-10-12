# Estado actual

Sprint 9 Eventos + Recursos reservables implementado en código el 11 de octubre de 2026. Desktop y Web/PWA comparten modelo, casos de uso y pantallas. Desktop persiste en SQLite, opera offline y sincroniza con Cloud; Web usa Supabase online-first. **Las migraciones Cloud `20260925000000_inventory.sql`, `20261011000000_appointments.sql` y `20261012000000_events_resources.sql` están pendientes de aplicar**; no se hizo push real.

## Hechos implementados

- `EventType` es configurable y activable/desactivable por owner/admin. No hay valores cerrados ni DELETE.
- `Event` es independiente de Appointment, vincula Business, Branch, Customer y tipo opcional, admite cruce de medianoche y estados `inquiry`, `quoted`, `reserved`, `completed`, `cancelled`.
- `EventServiceItem` conserva snapshot de nombre, descripción, cantidad y precio. `source_service_id` queda nullable para un catálogo futuro. Los importes se guardan en centavos enteros.
- `Resource` representa una unidad física reservable, no Product ni stock. Owner/admin puede crear, editar y activar/desactivar.
- `ResourceReservation` posee intervalo y precio propios. Los intervalos son semiabiertos: contiguos no solapan. Sólo Events `reserved` y `completed` bloquean; `cancelled` libera sin borrar historial y `quoted` no bloquea.
- La ficha/editor permite buscar Customer, alta rápida, lugar, notas, servicios, recursos y cambios de estado. Un alquiler sin servicios es válido. Listado, búsqueda, filtros, próximos eventos, disponibilidad Día/Semana y dashboard existen en Desktop y Web con layout responsive.
- Subtotal de servicios, subtotal de recursos y total general se derivan de líneas activas; no se modelaron pagos ni señas.
- SQLite 0010 agrega las cinco entidades, validaciones, metadata local, outbox y cursores. Pull remoto usa `sync_origin='remote'` y no genera outbox.
- Desktop sincroniza Customer antes de `EventType → Resource → Event → EventServiceItem → ResourceReservation`, conservando UUID y usando cursor `(updated_at,id)`, comparación optimista y retry idempotente.
- Cloud `20261012000000_events_resources.sql` agrega FK compuestas, RLS, grants sin DELETE, reloj monotónico y validación transaccional de disponibilidad. Un advisory lock por Business+Resource serializa Web y sync Desktop; la transición del Event a estado bloqueante valida sus reservas en orden.
- Si un Desktop offline no conocía una reserva Cloud, la autoridad final rechaza el push y el outbox conserva conflicto de disponibilidad y snapshot remoto. No hay override silencioso.
- Appointment continúa separado de Event; Product/Inventory continúan separados de Resource. No se implementaron Marquetería, pagos, contratos, WhatsApp, proveedores/compras, galerías ni logística avanzada.

## Verificación de esta sesión

- `pnpm typecheck`: pasa en domain, UI, application, features, Web y Desktop.
- `pnpm lint`: pasa.
- `pnpm test`: 67 pruebas en 24 archivos, pasa. Sprint 9 cubre intervalos y cruce de medianoche, estados, totales, overlap/contiguas/recursos distintos, sync idempotente, pull y conflicto de disponibilidad.
- La regresión Python completa pasa: Customer Sync, POS, POS Sync/FK Cloud, Inventory, Appointments SQLite/Cloud y Events SQLite/Cloud. `events_sqlite.py` cubre recurso activo/inactivo, alquiler puro, cancelación, aislamiento, Branch autorizada, outbox offline y pull sin loop; `events_cloud_sql.py` verifica FK, RLS, search path, locks, estados bloqueantes y ausencia de DELETE/service_role.
- `pnpm build`: pasa para Web PWA y Desktop Vite. Mantiene warnings no bloqueantes por chunks mayores a 500 kB (Web 559.08 kB; Desktop 638.70 kB).
- `pnpm format:check`: pasa.
- `pnpm build:desktop`: pasa; genera `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. Rust informa sólo el warning del linker al crear la import library.
- `supabase migration list` y `pnpm exec supabase db push --dry-run`: fallan antes de consultar o planificar. Resultado exacto: `LegacyDbConfigLoginRoleStatusError`, `unexpected login role status 403`, porque la cuenta no tiene privilegios para ese endpoint. Por lo tanto no hubo lista remota ni plan de dry-run actualizado.
- `git diff --check`: sin errores de whitespace; Git sólo avisa la conversión LF→CRLF propia del checkout Windows.

No se ejecutó SQL manual, `supabase db push` real ni seed.

## Límites y pendientes

La migración Cloud necesita aplicación administrativa y validación real con owner/admin/staff, RLS, concurrencia Web y reconexión Desktop. El guardado Web de un bundle se realiza en pasos idempotentes: si una operación intermedia falla, el Event queda recuperable pero puede requerir reabrir y completar líneas. La búsqueda Web enriquece y filtra hasta 500 Events por consulta; a mayor volumen conviene una vista/RPC server-side. La zona se presenta según el dispositivo, igual que Appointment; una operación multi-zona futura requiere `business_timezone` IANA. Los Events `completed` conservan el bloqueo histórico por decisión del sprint.
