# Handoff

## Configuración → Precios — Fases A/B (27/10/2026)

Web y Desktop ya muestran una sola entrada **Configuración → Precios**. La pantalla comparte una lista seleccionada entre Laboratorio, Plotter, LED, pantallas de tela y servicios de eventos; la administración de listas vive en una hoja lateral. La portada es una grilla de familias y sólo abre el editor elegido. Marquetería enlaza a su configuración propia; Fotografía/Video queda explícitamente pendiente de Fase C. Los alias internos `price-lists` y `photo-services` se conservan, sin entradas duplicadas en la navegación.

Recursos ahora se describe y opera como catálogo de equipamiento físico reservable: alta/edición bajo demanda, sin precio visible y con el campo legado preservado. La capacidad técnica LED (pool, controladores y presets) está en Recursos; Precios contiene sólo su tarifa comercial. No hubo cambios de esquema, dominio, RLS, SQLite, outboxes ni backend remoto.

Verificación local: lint, typecheck, 563/563 pruebas, build de todo el workspace y build Tauri/NSIS pasan. Instalador: `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. No hubo commit, push ni SQL remoto. El siguiente punto de producto es **Fase C únicamente con una solicitud nueva**: diseñar el catálogo real de Fotografía/Video; no usar `PhotoService` ni ofertas de eventos como sustituto accidental.

## Reorganización funcional de navegación (26/10/2026)

Implementadas las etapas 1–3 sin cambios de esquema, migraciones, SQL remoto, reglas de negocio ni sync. La navegación compartida Web/Desktop queda en Inicio, Mostrador, Laboratorio, Servicios, Taller y Configuración; `PhotoJob` se muestra como Pedido, `Event` como Presupuesto o reserva y Producción como vista operativa de Pedidos. Catálogo desaparece como contenedor. Tipos de turno/reserva se agrupan en Configuración; materiales de Plotter, varillas y otros materiales de marquetería comparten el módulo Materiales; Drive/WhatsApp quedan en Integraciones. Se conservaron los IDs históricos y se agregó sólo el ID de vista `plotter-materials`.

Verificación local: typecheck, lint, build Web/Desktop y empaquetado NSIS pasan; la suite completa tuvo 562/563 verdes y un `EPERM` transitorio al listar `supabase/migrations`, cuyo archivo de 51 pruebas pasó completo al reintentarlo. No se hizo commit ni push. Deuda deliberada: agenda transversal Appointment+Event, catálogo extensible de servicios y PlotterJob.

## Limpieza de datos operativos de prueba (26/10/2026)

Auditoría estática completa, sin SQL remoto ni borrados. Informe: `docs/OPERATIONAL_TEST_DATA_CLEANUP.md`; consulta de sólo lectura para FK/conteos: `docs/sql/customer_test_data_audit.sql`; propuesta transaccional: `docs/sql/customer_test_data_cleanup.sql` (termina en `ROLLBACK`, `COMMIT` comentado). Alcance propuesto: todos los Customers del Business `centrocolor` y sólo sus dependencias operativas. Antes de ejecutar: obtener y revisar conteos reales, confirmar que el preflight reconoce todas las tablas, cerrar Desktop y diseñar la limpieza SQLite/outboxes para evitar datos residuales o re-subidas. No hay decisión arquitectónica nueva ni cambios en `DECISIONS.md`.

## SERVICIOS-01 (24/10/2026)

Implementado y verificado en código (detalle en `docs/CURRENT_STATE.md`, decisiones 93–98). **Estado remoto verificado el 25/10/2026**: las migraciones `20261024*` ya figuran aplicadas, pero `public-photo-catalog` y las otras tres funciones públicas seguían en su versión 1 del 17/10. No volver a empujar esas migraciones basándose en notas históricas. Para que `/imprimir` use las variantes todavía corresponde verificar/redesplegar `public-photo-catalog` y `public-photo-order-start` y publicar cada tamaño desde Configuración → Precios → Laboratorio → «Publicar en /imprimir». Después, cargar los datos listados en CURRENT_STATE y probar sync Desktop↔Cloud y un pedido `/imprimir` con Mate y Brillo. No hay commit de este trabajo.

## Punto de reanudación

Las Fases A/B de Precios están terminadas localmente. Para retomarlas, empezar por `packages/features/src/services.tsx`, `event-service-catalog.tsx`, `resource-capacity.tsx`, `events.tsx` y `photo.tsx`; la composición/alias vive en `packages/ui/src/navigation.ts` y en los `main.tsx` de Web/Desktop. La próxima ampliación autorizable es Fase C (catálogo de Fotografía/Video) y requiere una solicitud y decisión de modelo propias. Antes de esa fase conviene hacer una prueba manual con datos reales en Web y en la ventana Tauri, especialmente cambio de lista, persistencia de tarifas y edición de capacidad LED.

Los pendientes remotos históricos de Sprint 14/SERVICIOS-01 siguen separados de esta entrega de UI. Confirmar siempre el estado remoto actual antes de ejecutar migraciones o despliegues; las migraciones `20261024*` constaban aplicadas al 25/10/2026.

## Pendientes operativos históricos (confirmar estado remoto antes de ejecutar)

1. Consultar primero la lista de migraciones remotas y ejecutar `pnpm exec supabase db push --dry-run`; no asumir que las notas de octubre reflejan el estado actual. Sólo con autorización explícita, aplicar lo que el dry-run confirme pendiente. Comandos: `docs/PUBLIC_ORDERS_SETUP.md`.
2. Desplegar las funciones nuevas y **redesplegar** `photo-file-admin`, `photo-upload-context`, `photo-upload-session`, `photo-upload-finalize` y `photo-upload-submit` (obligatorio: ahora distinguen links de subida y de seguimiento y aplican los límites del pedido anónimo). No tocar las dos de OAuth.
3. Publicar la Web en Vercel (sin variables nuevas).
4. En Configuración → Precios → Laboratorio publicar los tamaños correspondientes y revisar la lista en `/imprimir`.
5. Prueba humo de pedido (checklist de `docs/PUBLIC_ORDERS_SETUP.md`) desde un celular real, incluyendo una foto grande y el PUT resumable de Google desde el navegador.
6. WhatsApp (opcional, no bloquea los pedidos): seguir `docs/WHATSAPP_SETUP.md` (app Meta, número, token permanente, plantilla `pedido_listo` de utilidad, secrets, secretos de Vault para `pg_net`, webhook) y probar con un número verificado: Listo → aviso → reintento → reenvío. Probar también Desktop: marcar Listo sin conexión, sincronizar y ver que sale un solo aviso.
7. Definir la política de abandono (retención) y, si se desea, programar `cc_public_order_mark_abandoned`.

## Escáner global

Detector, coordinador y proveedor en `packages/features/src/scan-*.ts` y `global-scanner.tsx` (detalle en `docs/CURRENT_STATE.md`). Falta probarlo con un lector físico en Web y en la ventana Tauri.

## Garantías y límites

El navegador nunca decide un precio ni autoriza con un UUID; los borradores no llegan a Producción ni a Desktop; el aviso de «listo» es único por trabajo y depende del estado Cloud; el token de WhatsApp sólo vive en Vault. Drive sigue siendo la autoridad binaria (Sprint 13) y Desktop sigue sin binarios.

No se implementaron: editor Polaroid/plantillas/recorte/texto, Gmail (sólo se reserva `future_gmail`), galería, IA, impresión automática, pago online, envíos, promociones, cuentas de clientes, marketing por WhatsApp ni emails automáticos. Deuda técnica y no verificado contra servicios reales: ver `docs/CURRENT_STATE.md`.

## UX/UI (DESIGN-02 adoptado)

La app real (Web y Desktop) ya usa el sistema visual de DESIGN-02: tokens y componentes en `packages/ui` (`styles.css` agrega `tokens`, `base`, `compat`, `components`, `shell`, `legacy` y `panel`), navegación por módulos con pestañas en `packages/ui/src/navigation.ts`, `PanelShell`/`GlobalSearch`/`useNavAttention` en `packages/features` y el portal en `apps/web/src/public-order/` (`public-order.css`). Estado, diferencias respecto de la preview y deuda: `docs/CURRENT_STATE.md`; decisiones 87–91 en `docs/DECISIONS.md`. `apps/design-preview` **se conserva** como referencia histórica (`pnpm --filter @centrocolor/design-preview dev`) y no se usa en producción.

Pendiente de producto/diseño antes de dar por cerrado el portal: (1) implementar el **gate de backend** del pago por transferencia (el portal ya comunica alias y «impresión una vez acreditado el pago»; falta estado de pago/acreditación), (2) revisión legal de que no haya casilla de consentimiento de WhatsApp, (3) logo vectorial/plano para fondos oscuros, (4) probar Producción en la tablet real de laboratorio (~10") y Desktop en su ventana Tauri, y (5) pasada con lector de pantalla. Para revisar visualmente sin backend se usó un arnés temporal con repositorios en memoria (no versionado): se puede recrear montando `PanelShell` con repositorios falsos.
