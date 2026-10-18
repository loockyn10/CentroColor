# Estado actual

## UX/UI — DESIGN-02 adoptado en la aplicación real (17/10/2026)

Pasada integral de UX/UI sobre Web/PWA y Desktop: el sistema visual aprobado en `apps/design-preview` ya es el de producción. **No cambió ninguna función de negocio ni backend** (Supabase, RLS, Edge Functions, sync, migraciones, Drive, WhatsApp, pagos, intake, ciclo de PhotoJob). La única corrección de dominio autorizada fue la fórmula de marquetería (abajo). La preview sigue como referencia histórica.

- **Sistema visual** en `packages/ui` (única hoja `styles.css`): `tokens.css` (paleta amarillo/grafito/crema/rojo, Bricolage Grotesque + Figtree + DM Mono alojadas en el paquete, escala, radios, sombras), `base.css`, `compat.css`, `components.css` (Button, Badge/StateLine, Card, Metric, Tabs, Segmented, Chip, Sheet, filas `oprow`, formularios, stepper), `shell.css`, `panel.css` (pantallas) y `legacy.css` (reglas previas de las features, con la paleta verde reemplazada por tokens y las reglas muertas podadas). Sin colores literales fuera de tokens/alfas. Logo real (192/512) en `packages/ui/src/assets`, íconos del set propio. Web y Desktop comparten exactamente los mismos componentes y CSS; Desktop no inlinea assets (la CSP de Tauri no admite `data:`).
- **Shell y navegación**: sidebar grafito ≥ 1100 px, riel de 92 px en tablet, barra superior + tab bar de 5 y hoja «Más» en móvil; 11 módulos agrupados (Hoy · Mostrador · Taller · Agenda · Catálogo · Sistema) con **pestañas de submódulo** para no perder ninguna vista (Cobrar → Nueva venta/Ventas; Trabajos → Trabajos/Nuevo trabajo/Servicios; Marquetería → Trabajos/Nueva cotización/Varillas/Materiales; Agenda → Calendario/Turnos/Tipos; Eventos → Eventos/Disponibilidad/Recursos; Productos → Productos/Stock). Buscador global (clientes y trabajos, `/` enfoca), menú «Nuevo» y contadores **sólo de atención real**: Trabajos atrasados (rojo), Cobros con trabajo terminado y saldo, Productos sin stock. `PanelShell` (features) es común a Web y Desktop.
- **Pantallas**: Inicio (4 KPI + «Para resolver ahora» protagonista + turnos y seguimiento compactos, datos reales), POS (misma lógica; carrito con peso visual), Clientes (maestro-detalle, WhatsApp y Nuevo trabajo destacados, cuenta, trabajos, edición, activar/desactivar), **Cobros** (bandeja nueva sobre `WorkPaymentRepository.listOutstanding`; abre la cuenta real con Total/Pagado/Saldo/Historial), Trabajos (Lista por defecto, Tablero alternativo, detalle en panel lateral), Producción (Laboratorio/Edición, una fila por trabajo con **En proceso / Listo**, Drive, Abrir; objetivos de 52 px para tablet de laboratorio), Marquetería (cotizador con desglose), Agenda (controles y estados), Eventos (tablero Consulta/Presupuestado/Reservado + lista; disponibilidad como matriz recurso × día), Productos/Stock (KPI, filtros, estados «Sin stock»/«Negativo»), Configuración (Drive y WhatsApp como integraciones con estado), Login y estados de acceso con la marca.
- **Portal público** (`/imprimir`, `/imprimir/recibido`, `/pedido/:token`, y el link `/enviar/:token` de Sprint 13): hero amarillo + cinta de película, tamaños con proporción real, grupos de fotos con copias, resumen oscuro (barra inferior con total en móvil), pedido recibido y seguimiento con línea de tiempo y **LISTO PARA RETIRAR** a pantalla completa. Copy mínimo según la regla DESIGN-02. `/imprimir/recibido` es la dirección que se muestra tras confirmar; si se recarga, lleva al seguimiento del último pedido de ese navegador.
- **Fórmula de marquetería corregida** (único cambio de dominio): `mouldingLengthMm = 2 × (ancho + alto)` más merma; `faceWidthMm` quedó como metadata descriptiva y ya no suma. 30 × 40 cm → 1400 mm (140 cm) de varilla y 0,12 m² de vidrio/fondo (tests en `packages/domain/src/framing.test.ts`). Los presupuestos ya guardados conservan su snapshot; los nuevos se calculan con la regla correcta.

### Verificación (17/10/2026)

`pnpm typecheck`, `pnpm lint`, `pnpm test` (**507 pruebas** en 58 archivos: 493 previas + fórmula de marquetería, navegación sin pérdida de módulos, rutas públicas sin login, shell responsive, WhatsApp de la ficha y modo de pago del portal), `pnpm build`, `pnpm format:check`, `pnpm build:desktop` (instalador `CentroColor_0.1.0_x64-setup.exe`) y `git diff --check` pasan. Revisión visual real en el navegador integrado con repositorios en memoria (arnés temporal, no versionado) a 390 / 768 / 1024 / 1440 px: 29 rutas × 4 anchos sin desbordes horizontales, objetivos táctiles ≥ 44 px, foco visible y `prefers-reduced-motion`. **No verificado**: lector de pantalla real, dispositivos físicos, la ventana real de Tauri (sólo el mismo bundle en el navegador), datos de producción.

### Diferencias necesarias respecto de DESIGN-02 y deuda

- **Pago**: el backend no implementa «transferencia antes de imprimir». El portal conserva el texto verdadero («El pago se realiza en el local al retirar tu pedido») y el paso 3 del hero dice «Confirmá» en vez de «Transferí». El copy de DESIGN-02 queda preparado tras `PAYMENT_MODE` en `apps/web/src/public-order/model.ts`; no activarlo hasta que exista el gate y el modelo de datos. Cobros no inventa transferencias ni «Confirmar transferencia».
- **Consentimiento de WhatsApp**: DESIGN-02 quitó la casilla; producción **conserva la existente** (registra el opt-in). Sin cambios de consentimiento ni backend.
- **Footer/portal**: sin dirección, horario ni teléfono del local (el catálogo no los provee); sin editor Polaroid ni «Personalizar».
- **Clientes**: «compras/historial» no existe en el dominio (`Sale` no referencia a `Customer`); la ficha muestra cuenta, trabajos y datos.
- **Inicio/atención**: sin avisos de WhatsApp/Drive (requeriría nuevos puertos); Desktop muestra «Configuración» informativa (Drive/WhatsApp son sólo Web).
- **Stock**: no existe «mínimo» en el dominio; el estado crítico es «Sin stock»/«Negativo».
- **Servicios (Catálogo)**: la vista placeholder `services` sigue resoluble pero ya no tiene entrada de menú; Servicios fotográficos vive en Trabajos → Servicios.
- Deuda: logo raster (pedir SVG/PDF); íconos de la app de escritorio generados desde el PNG; CSS de features aún conserva clases por feature en `legacy.css` (migrar de a poco a componentes); un solo chunk JS (> 500 kB, sin cambios); `Tablero` de Trabajos agrupa sólo lo cargado; sin modo oscuro ni impresión de comprobantes.

---

## DESIGN-01/02 — Preview de rediseño (referencia histórica, 17/10/2026)

`apps/design-preview` contiene la preview aislada con datos simulados que originó el rediseño (ya adoptado arriba): portal `/imprimir` → `/imprimir/recibido` → `/pedido/demo` y 11 módulos del panel. A la fecha de DESIGN-01/02 no se había tocado `apps/web`, `apps/desktop` ni `packages/*`. Detalle, rutas, paleta y pendientes: `docs/DESIGN_PREVIEW.md`. DESIGN-02 simplificó la preview: portal con mínimo texto, panel más tranquilo (capa `calm.css`), Trabajos en Lista, Cobros como bandeja y Eventos como tablero.

---

## Sprint 14 — Pedidos públicos autoservicio + seguimiento + WhatsApp (17/10/2026)

Implementado en código y verificado localmente. **Nada está aplicado ni desplegado**: falta `db push` de dos migraciones, `functions deploy`, la configuración de Meta y publicar la Web (ver `docs/HANDOFF.md`, `docs/PUBLIC_ORDERS_SETUP.md` y `docs/WHATSAPP_SETUP.md`).

### Implementado

- **Portal público** `/imprimir` (sin login, mobile-first, sin navegación administrativa): elegir tamaños → subir fotos con copias por foto → datos (nombre, WhatsApp, email y notas opcionales, consentimiento) → confirmar. Total dinámico en pantalla; la cantidad de cada tamaño es la suma de las copias de sus fotos. Páginas `PEDIDO RECIBIDO` y `/pedido/:token` (seguimiento: recibido → en preparación → listo para retirar → entregado / cancelado). Funciona en la PWA instalada y en el navegador; no exige instalar nada.
- **Catálogo público = `PhotoService`** (sin catálogo duplicado): `is_public`, `public_name`, `public_description`, `public_sort_order`, `public_order_enabled` (exige público + Laboratorio + archivos del cliente). Se muestran sólo servicios activos + públicos + con pedido directo; owner/admin los edita en Fotografía → Servicios (Web y Desktop, con sync).
- **Backend de pedidos** (4 Edge Functions anónimas): `public-photo-catalog`, `public-photo-order-start`, `public-photo-order-submit`, `public-photo-order-track`. El inicio crea en **una transacción** Customer (reutiliza el del negocio con el mismo teléfono, sin tocarlo) + PhotoJob borrador + PhotoJobItems con snapshot de precio leído de `photo_services` + link de subida; el navegador sube con las funciones `photo-upload-*` de Sprint 13 (Drive, carpetas, resumable) sin cambios de flujo. La confirmación deriva cada cantidad de `sum(copies)`, libera el borrador, marca `submitted`, escribe `PEDIDO.txt` y emite un link de seguimiento de sólo lectura. Idempotente por clave del navegador.
- **Seguridad de precios**: el navegador envía sólo identificadores y cantidades; el servidor relee el catálogo, calcula y vuelve a verificar dentro de la transacción (`cc_error:price_changed` si cambió). `unit_price`/`total` enviados se ignoran.
- **Borradores**: `photo_jobs.is_draft` oculta el trabajo, sus items y archivos a todo rol cliente por RLS (Producción, Trabajos, Dashboard y sync Desktop sólo ven pedidos confirmados). Nada se borra; `cc_public_order_mark_abandoned(interval)` marca y revoca links (no programada).
- **Capabilities separadas**: `photo_job_upload_links.purpose` = `upload` (muta archivos, 14 días) o `tracking` (sólo lectura, 180 días). Los endpoints de subida rechazan tokens de seguimiento y viceversa; token aleatorio de 32 bytes, sólo SHA-256 en base, revocable.
- **WhatsApp Cloud API (Meta, directo)**: `whatsapp_integrations` por negocio (token sólo en Vault), pantalla Configuración → Integraciones → WhatsApp (owner/admin: configurar, probar conexión, desconectar), plantilla de utilidad configurable (`pedido_listo`/`es_AR`), `outbound_notifications` + auditoría (`outbound_notification_events`), clave única `photo_job:<id>:ready:whatsapp`. Un trigger de PostgreSQL encola **un** aviso al pasar a `ready` sin importar quién cambia el estado (Web, Desktop al sincronizar, SQL); nunca bloquea el cambio. Envío, reintento y reenvío manual auditado en `whatsapp-send`/`whatsapp-dispatch`; recibos de Meta en `whatsapp-webhook` (firma HMAC; `delivered`/`read` sólo con recibo real).
- **UI administrativa**: `ORIGEN: WEB` en listado, ficha y Producción; panel WhatsApp en la ficha (`✓ Aviso enviado` + `Reenviar aviso`, o `⚠ No pudo enviarse` + `Reintentar`); Desktop muestra una nota (el envío lo hace la nube).
- Migraciones nuevas: Cloud `20261018000000_public_photo_orders.sql` y `20261018010000_whatsapp_notifications.sql`; SQLite `0016_public_orders.sql`.

### Verificación (17/10/2026)

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` y `pnpm build:desktop`: pasan (instalador `CentroColor_0.1.0_x64-setup.exe`; warnings de chunks > 500 kB sin cambios).
- `pnpm test`: **493 pruebas en 55 archivos** (antes 264 en 45), todas verdes. Novedad de método: las migraciones reales se ejecutan en **PGlite** (PostgreSQL embebido) y las pruebas ejercen RPC, triggers, RLS y grants SQL reales; los stores reales de las Edge Functions corren contra esa base mediante un adaptador con el rol `service_role`/`authenticated`, el Drive real contra un Google emulado y los handlers reales. Cubren catálogo, precios manipulados, doble envío, cliente nuevo/existente, normalización de teléfonos, consentimiento, borradores invisibles, confirmación, seguimiento por estado, enumeración, aislamiento entre negocios, una sola notificación por `ready`, retry/reenvío, errores de Meta, token fuera de la base, webhook, el contrato Web ↔ funciones (cliente real) y Desktop offline → sync real → aviso exactamente una vez.
- Python: `public_orders_cloud_sql.py`, `whatsapp_cloud_sql.py` y `public_orders_sqlite.py` se suman a los 17 anteriores.
- `pnpm exec supabase db push --dry-run`: propone **únicamente** `20261018000000_public_photo_orders.sql` y `20261018010000_whatsapp_notifications.sql` (la estabilización `20261017020000` ya figura aplicada en el remoto). No se ejecutó `db push`.
- Verificación visual en el navegador integrado (móvil 375 px y escritorio) con un backend local real (handlers + PGlite): selección de tamaños, subida de 3 fotos, confirmación, página de seguimiento en `Recibido` y `LISTO PARA RETIRAR`, link inválido, y el panel WhatsApp/Servicios/Configuración con repositorios de prueba.

### Pendiente operativo y deuda

- Aplicar migraciones, redesplegar `photo-file-admin` y las cuatro `photo-upload-*` (**obligatorio**: distinguen el propósito del link), desplegar las 8 funciones nuevas, crear los secrets/Vault, configurar Meta y publicar la Web. Prueba real con un número verificado.
- No verificado contra servicios reales: Meta Cloud API, CORS del PUT resumable de Google desde un navegador real, `pg_net` en el proyecto, aprobación de la plantilla (una URL en el cuerpo podría exigir un botón de URL dinámica). Deno no está instalado: sin bundle/deploy local; las dependencias `npm:` se resuelven en el despliegue.
- El emisor se despierta desde la base con `pg_net` + 2 secretos de Vault (SQL en `docs/WHATSAPP_SETUP.md`); sin ellos el aviso queda `pending` hasta que alguien lo despache (la Web lo hace al marcar Listo). No hay reintento automático de fallos transitorios (se reintenta con un clic).
- Un pedido iniciado crea el Customer (reutilizado por teléfono): un abandono deja un cliente sin pedido confirmado. El match usa los últimos 10 dígitos: teléfonos históricos con «15» intercalado pueden duplicarse. Rate limits por hora (global, por IP y por teléfono) y tope por pedido (200 fotos, 100 MB, sólo JPG/PNG/HEIC/TIFF); no hay cuota diaria de almacenamiento por visitante.
- `photo_jobs.created_by` es NOT NULL (y espejado en SQLite): el creador técnico de un pedido web es el owner. Si en el futuro se admite NULL hay que rehacer la tabla local.
- Desktop no muestra el estado de los avisos (sólo Web); la configuración de WhatsApp es sólo Web, igual que Google Drive.
- Fuera de alcance, no implementado: editor Polaroid/plantillas/recorte/texto, Gmail, galería, IA, impresión automática, pago online, envíos, promociones, cuentas de clientes, marketing por WhatsApp y emails automáticos. `source_channel = 'future_gmail'` sólo reserva el valor.

---

## Sprint 13 (referencia) — Portal de clientes + Google Drive + flujo de archivos quedó implementado el 16 de octubre de 2026 y se **auditó y estabilizó el 17 de octubre** sin agregar funcionalidades. Las migraciones Sprint 12/13 y `20261017010000_google_drive_oauth_hardening.sql` ya están aplicadas; OAuth funciona (owner conecta, carpeta `CentroColor` creada). La corrección descrita aquí está **verificada en código y contra la base real (sólo lectura y transacciones revertidas) pero todavía no aplicada ni desplegada**: falta `db push` de `20261017020000_photo_file_intake_stabilization.sql`, redesplegar cinco funciones y publicar la Web (ver `docs/HANDOFF.md`).

## Causa raíz de “Edge Function returned a non-2xx status code” al generar el link

Dos defectos independientes, ambos reproducidos contra el proyecto vinculado:

1. `service_role` no tenía DML sobre ninguna tabla nueva (sólo REFERENCES/TRIGGER/TRUNCATE): leer `photo_jobs` devolvía vacío (“No se encontró el trabajo”) y el INSERT del link fallaba con 42501. El error de base se convertía en un mensaje genérico 400 y la UI sólo mostraba “non-2xx”.
2. Latente desde Sprint 11: el trigger compartido `photo_guard_immutable_identity` hacía fallar con 42703 **todo UPDATE** de PhotoJob/PhotoJobItem/PhotoService. Aun con los grants, `create_link` (estado `awaiting_files`), la sesión (`receiving`) y el submit habrían fallado después.

Además, el estado de intake podía ser pisado por un push de Web/Desktop con datos viejos; ahora es de servidor. Otros hallazgos corregidos: errores de lectura ignorados en todas las funciones, `appProperties` de Drive con `original_filename` (> 124 bytes con nombres largos), sesión resumable sin `Origin` (el PUT del navegador podía fallar por CORS), rate limit de 30 sesiones/minuto que cortaba cargas secuenciales de ~30+ fotos, intentos `failed` consumiendo el cupo de 500, finalize que respondía ok sin cambiar nada, `reconnect_required` ante cualquier fallo de refresh (incluida mala configuración), link anterior revocado antes de insertar el nuevo, copiar al portapapeles que ocultaba un link ya creado y mensajes del portal sin detalle de red.

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

## Verificación (17/10/2026)

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` y `pnpm build:desktop`: pasan (instalador `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`; warnings de chunks >500 kB sin cambios).
- `pnpm test`: 264 pruebas en 45 archivos, pasan (antes 116). Nuevas: handlers admin y portal con store/Drive de prueba, gateway Drive contra un Drive emulado (jerarquía, idempotencia, errores), config, `errorResponse`, helper Web de errores, reintentos de chunks y dos contratos entre capas: `service-grants.contract.test.ts` (tablas/RPC del código vs GRANT de migraciones; falla 8 veces sin la migración nueva) y `stack.e2e.test.ts` (UI/portal reales → handlers reales).
- Edge Functions: chequeo de tipos con `tsc` y stubs de Deno (Deno no está instalado, no se hizo bundle real).
- Python: 17 scripts pasan, incluido `photo_file_intake_stabilization_sql.py`.
- `pnpm exec supabase db push --dry-run`: propone únicamente `20261017020000_photo_file_intake_stabilization.sql`. No se aplicó.
- Base real (revertido con ROLLBACK, sin datos persistidos): sin la migración, el flujo link→archivo→submit falla en `link_insert` con 42501; con ella todos los pasos pasan (incluido UPDATE de PhotoJob por `service_role` y por un miembro autenticado, que conserva las columnas de intake).
- Secrets presentes: `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`, `PUBLIC_WEB_URL`, `WEB_APP_URL`, `PHOTO_UPLOAD_SIGNING_SECRET`, `PHOTO_UPLOAD_LINK_DAYS`, `PHOTO_UPLOAD_MAX_BYTES`. Por digest, `WEB_APP_URL`/`PUBLIC_WEB_URL` (sin barra final), `REDIRECT_URI` y `LINK_DAYS=14` coinciden con lo documentado; el digest de `PHOTO_UPLOAD_MAX_BYTES` **no** coincide con `2147483648`. Ahora se valida en runtime y el error nombra la variable; si es inválida, reconfigurarla (ver GOOGLE_DRIVE_SETUP).
- `git diff --check`: sin errores; avisos LF→CRLF del checkout Windows.

## Pendiente operativo y deuda

- Aplicar la migración, redesplegar `photo-file-admin` y las cuatro `photo-upload-*`, publicar la Web y hacer la prueba manual única de `docs/HANDOFF.md`.
- No verificado en navegador real: CORS del PUT resumable de Google (se reenvía `Origin` al abrir la sesión; `scripts/smoke-photo-intake.mjs --upload` lo comprueba) y si Google expone `Range` en los 308 (el cliente tolera que no).
- Deno no está instalado: sin bundle/deploy local de las funciones. Las pruebas usan dobles de store y de Drive; la capa `store-supabase.ts` sólo está cubierta por el contrato de grants y por las sondas revertidas.
- Carreras conocidas y aceptadas: dos pestañas del mismo link creando la misma carpeta a la vez pueden duplicar una carpeta en Drive (el mapa conserva una); un archivo cuya carga se reintentó tras completarse en Drive queda huérfano en la carpeta; una carpeta del mapa enviada a la papelera de Drive no se detecta hasta el próximo error.
- Refresh de access token en cada request de sesión/finalize (sin caché por isolate) y rate limit sólo por Job; una política por IP requeriría gateway externo.
- La reanudación conserva sesión mientras la pestaña sigue abierta; tras recargar hay que reseleccionar el archivo. Los PhotoJobItem custom sin PhotoService no se ofrecen como destino.
- Fuera de alcance: detección automática en `Editadas`, UI de rechazo/removal, Photoshop/Lightroom, login/galería/entrega digital, Event/FrameJob files, WhatsApp, email, IA, impresión automática.

Ver `docs/GOOGLE_DRIVE_SETUP.md` para la puesta en marcha exacta.
