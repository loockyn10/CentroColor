# Estado actual

Sprint 11 Trabajos / Pedidos fotográficos está implementado en código al 16 de octubre de 2026. Desktop y Web/PWA comparten dominio, contratos y pantallas; Desktop persiste en SQLite y sincroniza al recuperar sesión Cloud, mientras Web usa Supabase. No se ejecutó ningún push real ni SQL manual.

Las migraciones Cloud posteriores a POS continúan pendientes según el último historial remoto confirmado del 21/9/2026: `20260925000000_inventory.sql`, `20261011000000_appointments.sql`, `20261012000000_events_resources.sql`, `20261013000000_framing.sql`, `20261014000000_framing_sync_rls.sql` y la nueva `20261015000000_photo_jobs.sql`. El estado remoto no pudo reconfirmarse: `supabase migration list` y `pnpm exec supabase db push --dry-run` respondieron `LegacyDbConfigLoginRoleStatusError`, `unexpected login role status 403`.

## Sprint 11 implementado

- `PhotoService` es un catálogo configurable con tipo, dimensiones opcionales, precio en centavos y activación. Owner/admin administra; staff consulta. No es Product.
- `PhotoJob` requiere Customer y Branch, conserva usuario creador, prioridad `normal`/`urgent`, fecha prometida, notas y referencias opcionales a Appointment/Event. Estados: `received`, `in_progress`, `ready`, `delivered`, `cancelled`; no existe DELETE.
- `PhotoJobItem` admite PhotoService o concepto custom, congela nombre, dimensiones y precio, exige cantidad positiva y deriva `total_cents`. El total del trabajo suma items activos.
- Nuevo trabajo permite buscar/crear Customer, agregar varios servicios, sobrescribir precio, crear línea personalizada y guardar con UUID estable. La ficha permite editar fecha, prioridad, notas, cantidad/precio de líneas, desactivar líneas y cambiar estados.
- La cola responsive filtra activos/estado/urgentes/histórico, busca por cliente, teléfono, servicio y notas, y ordena urgente → atrasado → fecha prometida → creación. `ready` se destaca como “Listo para entregar”.
- Dashboard muestra pendientes (`received` + `in_progress`), urgentes, listos y los próximos tres trabajos.
- Desktop registra las tres entidades en SQLite mediante migración 0013, opera offline y conserva historial. Web usa el repositorio Supabase con la misma feature.
- Sync incremental usa `photo_sync_outbox` y `photo_sync_cursor` en orden `PhotoService → PhotoJob → PhotoJobItem`, después de Customer/Appointment/Event. Pull remoto no genera outbox. La comparación optimista registra snapshot remoto y deja la fila local en conflicto ante una divergencia, incluidos cambios de estado concurrentes.
- Cloud `20261015000000_photo_jobs.sql` incluye tablas, checks monetarios/dimensionales, FK compuestas Business-aware, índices, reloj monotónico, RLS y permisos sin DELETE/service_role.
- Appointment/Event integration queda preparada mediante `source_appointment_id` y `source_event_id` y se muestra en detalle; no se agregó conversión automática ni se modificaron Agenda/Eventos.

## Verificación de esta sesión

- `pnpm typecheck`: pasa en los seis paquetes/apps compilables.
- `pnpm lint`: pasa.
- `pnpm test`: 74 pruebas en 28 archivos, pasa. Incluye dominio Photo y orquestador de sync.
- Regresión Python completa: Customer Sync, POS, POS Sync/FK Cloud, Inventory, Appointments SQLite/Cloud, Events SQLite/Cloud y Photo SQLite/Cloud, pasa.
- `pnpm build`: pasa. Warnings no bloqueantes por chunks mayores a 500 kB: Web 602.75 kB; Desktop 707.87 kB.
- `pnpm format:check`: pasa.
- `pnpm build:desktop`: pasa tras permitir la descarga oficial de NSIS; genera `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. Rust informa solo el warning del linker al crear la import library.
- `git diff --check`: sin errores; solo avisos LF→CRLF del checkout Windows.
- `pnpm exec supabase db push --dry-run`: falla antes de producir plan. Resultado exacto: `LegacyDbConfigLoginRoleStatusError`, `unexpected login role status 403: {"message":"Your account does not have the necessary privileges to access this endpoint. For more details, refer to our documentation https://supabase.com/docs/guides/platform/access-control"}`.
- `pnpm exec supabase migration list`: falla con el mismo 403; no se inventa el estado remoto.

## Límites y deuda

La migración Cloud no fue ejecutada ni validada contra PostgreSQL real. Falta probar RLS con owner/admin/staff, dos clientes reales y reconexión offline con conflicto de estado. El guardado Web del job y sus items no usa todavía una RPC transaccional; un fallo intermedio puede dejar el job sin todas sus líneas y requiere reabrir/corregir, por lo que conviene migrarlo a una operación bundle idempotente. Los conflictos Photo se conservan en outbox, pero todavía no tienen un panel de resolución específico como Customer/POS. La búsqueda Web filtra hasta 200 trabajos cargados; a mayor volumen conviene vista/RPC server-side. Customer detail no incorpora aún un bloque PhotoJobs. Appointment/Event tienen vínculo preparado, sin botón “Crear trabajo fotográfico”.

No se implementaron almacenamiento/upload de fotos, galería, selección online, edición real, integración Lightroom/Photoshop, impresión/drivers, pagos/señas, facturación, WhatsApp/notificaciones, proveedores/compras, consumibles, integración PhotoJob→POS/Sale ni postproducción avanzada.
