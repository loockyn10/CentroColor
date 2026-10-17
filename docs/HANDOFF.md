# Handoff

## Punto de reanudación

Sprint 13 está implementado y auditado. El 17/10/2026 se encontró y corrigió en código la causa raíz del error al generar el link (sin privilegios DML de `service_role` y un trigger de Sprint 11 que hacía fallar todo UPDATE de PhotoJob/PhotoJobItem/PhotoService); ver CURRENT_STATE. **Nada de esto está aplicado ni desplegado todavía**: no se ejecutó `db push` real ni `functions deploy`.

Arquitectura Edge actual: handlers con dependencias inyectadas en `supabase/functions/_shared`, entrypoints de una línea, errores curados con código y `requestId`, store de una sola capa, test de contrato de grants y `stack.e2e.test.ts` (ver ARCHITECTURE y decisiones 67–72). Los puntos principales siguen en `packages/domain/src/photo.ts`, `packages/features/src/photo.tsx`, `apps/web/src/photo-upload-client.ts`, `photo-upload-portal.tsx`, `photo-file-intake.ts` y `edge-functions.ts`, las migraciones `20261017000000`, `20261017010000` y `20261017020000`, y SQLite `0015_photo_file_intake.sql`.

## Próximos pasos (en este orden)

1. `pnpm exec supabase db push --dry-run` debe listar sólo `20261017020000_photo_file_intake_stabilization.sql`; luego `db push`. Comandos exactos en `docs/GOOGLE_DRIVE_SETUP.md`.
2. Redesplegar `photo-file-admin`, `photo-upload-context`, `photo-upload-session`, `photo-upload-finalize` y `photo-upload-submit`. No redesplegar `google-drive-oauth-callback` ni `google-drive-oauth-start`.
3. Publicar la Web en Vercel (helper de errores, portal con reintentos, link visible).
4. Verificar `PHOTO_UPLOAD_MAX_BYTES` (su digest no coincide con 2147483648): reconfigurarlo si es necesario.
5. Prueba manual única: owner abre un Job con un servicio que requiere archivos → Generar link → abrir el link en una ventana privada → subir 2-3 fotos (una de ≥ 10 MB) a Laboratorio y una a Edición → “Terminé”. Comprobar carpetas, `PEDIDO.txt`, colas de Producción y que el Job quede `submitted`. Opcional antes: `node scripts/smoke-photo-intake.mjs --link <url> --upload`.
6. Pruebas posteriores: link expirado/revocado/enviado, Drive desconectado, refresh revocado, corte de una carga grande y reintento, Desktop (sync de metadata, sin binarios en SQLite).

## Garantías y límites

Drive es almacenamiento primario; Supabase/SQLite sólo guardan metadata. El token real no se persiste, las credenciales Google son server-side y el portal no tiene acceso anon a tablas. Finalize verifica Drive y submit/manifest son idempotentes. Reabrir exige regenerar link y revoca el anterior.

No se implementaron login/galería/entrega digital del cliente, IA, Google Photos, Photoshop/Lightroom, impresión automática, WhatsApp/email, Event/FrameJob files ni duplicación en Supabase Storage. Ver CURRENT_STATE para checks y deuda.
