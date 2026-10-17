# Handoff

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

## Garantías y límites

El navegador nunca decide un precio ni autoriza con un UUID; los borradores no llegan a Producción ni a Desktop; el aviso de «listo» es único por trabajo y depende del estado Cloud; el token de WhatsApp sólo vive en Vault. Drive sigue siendo la autoridad binaria (Sprint 13) y Desktop sigue sin binarios.

No se implementaron: editor Polaroid/plantillas/recorte/texto, Gmail (sólo se reserva `future_gmail`), galería, IA, impresión automática, pago online, envíos, promociones, cuentas de clientes, marketing por WhatsApp ni emails automáticos. Deuda técnica y no verificado contra servicios reales: ver `docs/CURRENT_STATE.md`.

## Rama de diseño (DESIGN-01/02)

Existe `apps/design-preview` (ver `docs/DESIGN_PREVIEW.md`): propuesta visual completa con mocks, **no aplicada** a la app. Antes de adoptarla hay que decidir tres cosas de producto/diseño: (1) el pago por transferencia previo a imprimir (hoy el pago es en el local), (2) el logo vectorial, (3) la regla de varilla de marquetería (`faceWidthMm`). Ejecutar con `pnpm --filter @centrocolor/design-preview dev`. DESIGN-02 (simplificación) está resumido en `docs/DESIGN_PREVIEW.md` §15; la capa de estilos del panel es `apps/design-preview/src/styles/calm.css`.
