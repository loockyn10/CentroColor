# Estado actual

Sprint 5 — sincronización eventual de Customer implementada en código el 20 de septiembre de 2026. Según el estado comunicado por el usuario, Customers de Sprint 4 funciona en Web/Supabase y Desktop/SQLite, y su migración Cloud ya fue aplicada. Esta sesión no probó credenciales reales ni aplicó la nueva migración Cloud de Sprint 5.

- Desktop sigue usando SQLite como fuente primaria para listar, buscar, crear, editar y cambiar estado de Customers. Esas operaciones funcionan con el contexto `offline-authenticated` sin esperar Cloud.
- La migración SQLite 0005 añade `sync_outbox`, `customer_sync_cursor` y metadata local de Customer. Los triggers crean o compactan una operación `upsert` en la misma sentencia de escritura local. Customers previos entran al outbox. Aplicar cambios remotos no produce nuevas operaciones pendientes.
- Con sesión Supabase actual y membership activo del negocio, Desktop envía pendientes con el mismo UUID y compara `cloud_updated_at` antes de actualizar. RLS permanece activa; no hay claves privadas en el cliente.
- Desktop descarga Customers Cloud por páginas usando cursor `(updated_at, id)` persistido por negocio. Altas, ediciones y desactivaciones de Web llegan a SQLite. La nueva migración Cloud `20260922000000_customer_sync_timestamps.sql` hace que PostgreSQL gestione `updated_at` y agrega el índice del cursor; sigue pendiente de aplicación remota.
- Si Cloud y Desktop modifican el mismo Customer desde la última versión conocida, la edición local queda guardada y la operación pasa a conflicto con una instantánea remota. La UI Desktop muestra el estado y permite elegir conservar la versión local o la versión Web tras consultar Cloud nuevamente.
- Desktop intenta sincronizar tras login online, con una sesión válida al iniciar, al volver la conectividad, cada dos minutos y mediante `Sincronizar ahora`. Sin sesión Cloud, la sincronización se pausa y la operación local continúa.
- Web/PWA sigue usando directamente `SupabaseCustomerRepository`; no usa el orquestador Desktop. Solo Customer se sincroniza. No se implementaron otros módulos, Realtime ni borrado físico.
- `seed.sql` es únicamente de desarrollo. El bootstrap de producción de CentroColor, Sucursal principal y primer owner fue manual.

El dry run remoto informó únicamente `20260922000000_customer_sync_timestamps.sql` pendiente. Las verificaciones y límites se detallan en `HANDOFF.md`.
