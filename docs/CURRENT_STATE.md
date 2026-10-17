# Estado actual

Sprint 13 — Portal de clientes + Google Drive + flujo de archivos quedó implementado en código el 16 de octubre de 2026. No se ejecutó Docker, SQL manual, deploy de Edge Functions ni `db push` real.

El 17 de octubre de 2026 se corrigió la autorización administrativa de las Edge Functions de Drive: el helper compartido ahora consulta `business_memberships` con el JWT autenticado y la RLS existente, valida explícitamente `user_id`, `business_id`, `is_active` y rol `owner`/`admin`, y recién después entrega el cliente service-role. Antes consultaba con el cliente service-role e ignoraba el error de PostgREST, convirtiéndolo incorrectamente en una membresía ausente. `staff`, otro Business y ausencia/inactividad continúan devolviendo 403. Requiere redesplegar `photo-file-admin` y `google-drive-oauth-start`.

## Implementado

- `PhotoService` configura `workflow_route` (`none`, `lab`, `editing`, `other`) y `requires_customer_files`; owner/admin edita y staff consulta.
- `PhotoJob.file_intake_status` es independiente del estado productivo. Los estados son `not_required`, `not_requested`, `awaiting_files`, `receiving` y `submitted`.
- Google Drive es autoridad binaria. Supabase y SQLite guardan sólo metadata/IDs; no existe copia en Storage, PostgreSQL ni SQLite.
- `GoogleDriveIntegration` es por Business. OAuth server-side solicita `drive.file` y acceso offline; Client Secret/access token/refresh token no llegan al cliente. El refresh token se referencia por UUID y vive en Supabase Vault.
- La ruta pública `/enviar/:token` queda fuera de Auth administrativa. El token usa 32 bytes aleatorios, URL-safe, SHA-256 en base, expiración configurable, revocación y scope de un solo PhotoJob.
- El portal muestra sólo negocio, primer nombre, código y destinos opacos por PhotoJobItem. Permite selección múltiple, copies, progreso por archivo, retry/resume individual mientras la pestaña conserva la sesión, resumen y advertencia no bloqueante de copies.
- El browser sube chunks directamente a una URL resumable de Drive. La capability queda sólo en memoria. Edge valida token/item/Business/integración/formato/MIME/tamaño, crea metadata pending, abre sesión y pasa a uploading.
- Finalize vuelve a consultar Drive y valida ID consultado, parent, nombre y tamaño antes de `uploaded`; es idempotente. Submit rechaza pendientes, actualiza `PEDIDO.txt`, marca Job `submitted` y cierra el link; repetirlo no duplica.
- Carpetas deterministas por ID/appProperties: `CentroColor/Trabajos/YYYY/Mes/CC-XXXXXXXX - Cliente/{Para imprimir|Para editar|Otros}/Servicio` y `Editadas` para edición. Renombrar carpetas no rompe identidad.
- PhotoJob muestra estado, link, regeneración/revocación, resumen por item y accesos Drive. Configuración Web gestiona conectar/reconectar/abrir/desconectar Google Drive.
- Producción separa Laboratorio y Edición con submitted, Job activo, urgencia/atraso/fecha y accesos a Drive/Job.
- Desktop sincroniza nuevos campos y hace pull incremental de PhotoJobFile. No crea outbox de archivos ni cachea binarios; abrir Drive requiere Internet.
- Migraciones nuevas: SQLite `0015_photo_file_intake.sql` y Cloud `20261017000000_photo_file_intake.sql`. Siete Edge Functions y helpers compartidos implementan OAuth, administración, contexto, sesión, finalize y submit.

## Verificación

- `pnpm typecheck`: pasa.
- `pnpm lint`: pasa.
- `pnpm test`: 96 pruebas en 36 archivos, pasa. Incluye autorización explícita de owner/admin y rechazo 403 de staff, otro Business, otro usuario, membresía inactiva o ausente, además de token, expiración/revocación, Drive finalize, OAuth refresh mock, carpetas, routing, copies, resumable retry y sync metadata.
- Regresión Python completa: 14 scripts Customer/POS/Inventory/Agenda/Events/Photo/Payments/Sprint 13, pasa. SQLite 0015 aplica y el pull de metadata no genera outbox.
- `pnpm build`: pasa. Warnings no bloqueantes por chunks >500 kB: Web 633.94 kB y Desktop 738.53 kB.
- `pnpm build:desktop`: pasa; instalador `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. Sólo warning informativo del linker.
- `pnpm exec supabase db push --dry-run`: pasa, no aplica nada y propone exactamente `20261016000000_work_payments.sql` y `20261017000000_photo_file_intake.sql`.
- `git diff --check`: sin errores; avisos LF→CRLF del checkout Windows.

## Pendiente operativo y deuda

Las migraciones WorkPayment/Sprint 13 no están aplicadas. Faltan configurar Google Cloud/consent/client, secrets Supabase, desplegar siete Edge Functions y validar OAuth/Drive real con owner/admin/staff y teléfonos reales. Deno no está instalado en este equipo; las funciones se cubrieron con pruebas puras y auditoría estructural, pero su bundle/deploy real continúa pendiente.

El rate limit implementado es por Job (30 sesiones/minuto y 500 archivos); una política distribuida por IP requeriría gateway externo. La reanudación conserva sesión mientras la pestaña sigue abierta; tras cerrar/recargar, el navegador no puede recuperar el `File` local y debe seleccionar/reintentar ese archivo. Los PhotoJobItem custom sin PhotoService no se ofrecen como destino porque no poseen configuración de workflow. No hay detección automática de archivos en `Editadas`, UI administrativa de rechazo/removal, Photoshop/Lightroom, login/galería/entrega digital de cliente, Event/FrameJob files, WhatsApp, email, IA ni impresión automática.

Ver `docs/GOOGLE_DRIVE_SETUP.md` para la puesta en marcha exacta.
