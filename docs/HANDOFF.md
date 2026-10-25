# Handoff

## SERVICIOS-01 (24/10/2026)

Implementado y verificado en código (detalle en `docs/CURRENT_STATE.md`, decisiones 93–97). **Estado remoto verificado el 25/10/2026**: las migraciones `20261024*` ya figuran aplicadas, pero `public-photo-catalog` y las otras tres funciones públicas siguen en su versión 1 del 17/10 (sin código de SERVICIOS-01). Para que `/imprimir` muestre las variantes hay que redesplegar `public-photo-catalog` y `public-photo-order-start` (`submit` y `track` no usan el catálogo) y publicar cada tamaño desde Catálogo → Laboratorio → «Publicar en /imprimir» (decisión 98). **Nada aplicado ni desplegado**: pendientes `db push` de `20261024000000_service_catalog.sql`, `20261024010000_public_lab_tiers.sql` y `20261024020000_event_services.sql` (primero `--dry-run`: debe sumarse a las dos `20261018*` si tampoco están aplicadas), redeploy de las funciones del pedido público (`public-order-*` usan `cc_public_lab_catalog`) y publicar la Web; Desktop recibe `0017`/`0018` al actualizar el instalador. Después cargar los datos listados en CURRENT_STATE (precios de Laboratorio/Plotter público/Eventos, anchos de rollo, capacidad del Nova VX600) y probar el sync Desktop↔Cloud y un pedido `/imprimir` con Mate y Brillo. No hay commit de este trabajo.

## Punto de reanudación

Sprint 14 está implementado y verificado en código (ver `docs/CURRENT_STATE.md`). **Nada está aplicado ni desplegado**: no se ejecutó `db push` real ni `functions deploy`, no hay credenciales de Meta cargadas y la Web no se publicó. El dry-run del 17/10/2026 propone únicamente `20261018000000_public_photo_orders.sql` y `20261018010000_whatsapp_notifications.sql` (la estabilización de Sprint 13 ya figura aplicada en el remoto).

Puntos de entrada: pedido público en `apps/web/src/public-order/`, funciones en `supabase/functions/_shared/public-order-*.ts`, `whatsapp-*.ts`, `meta-client.ts`, migraciones `20261018*`, SQLite `0016_public_orders.sql`, puertos en `packages/application/src/whatsapp.ts` y UI administrativa en `packages/features/src/photo.tsx`. Arquitectura y decisiones 73–84 en `docs/ARCHITECTURE.md` y `docs/DECISIONS.md`.

## Próximos pasos (en este orden)

1. `pnpm exec supabase db push --dry-run` (debe listar sólo las dos migraciones `20261018*`) y, con autorización, `db push`. Comandos exactos: `docs/PUBLIC_ORDERS_SETUP.md`.
2. Desplegar las funciones nuevas y **redesplegar** `photo-file-admin`, `photo-upload-context`, `photo-upload-session`, `photo-upload-finalize` y `photo-upload-submit` (obligatorio: ahora distinguen links de subida y de seguimiento y aplican los límites del pedido anónimo). No tocar las dos de OAuth.
3. Publicar la Web en Vercel (sin variables nuevas).
4. En Fotografía → Servicios marcar los tamaños públicos (Laboratorio + requiere archivos → «Mostrar en la web» + «Aceptar pedidos directos») y revisar la lista en `/imprimir`.
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
