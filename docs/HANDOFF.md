# Handoff

## Punto de reanudación

Sprint 13 quedó implementado y verificado localmente. Según el runtime informado el 17/10/2026, Sprint 12/13 ya está aplicado y desplegado. No aplicar migraciones ni desplegar funciones sin autorización. El dry-run remoto actual propone únicamente `20261017010000_google_drive_oauth_hardening.sql`.

El 17/10/2026 se corrigió `_shared/supabase.ts`: la membresía administrativa se lee con el cliente autenticado/RLS, los errores de lectura ya no se confunden con ausencia de membresía y una política pura valida usuario, Business, estado y rol. Como el helper se empaqueta dentro de cada función, redesplegar exactamente `photo-file-admin` y `google-drive-oauth-start`; no cambiaron migraciones ni datos.

Ese mismo día se completó la auditoría OAuth. El TTL siempre fue 600.000 ms; el 403 de start era el INSERT server-side sin grant DML explícito para `service_role`, cuyo error se ocultaba y se clasificaba incorrectamente. La migración incremental agrega los grants, `consumed_at` y la RPC atómica `cc_complete_google_drive_oauth`. Start confirma persistencia; callback valida token exchange/Vault/root/upsert, conserva retry antes del consumo y registra logs seguros. Aplicar primero la migración y después redesplegar exactamente `google-drive-oauth-start` y `google-drive-oauth-callback`.

Los puntos principales son `packages/domain/src/photo.ts`, `packages/features/src/photo.tsx`, `apps/web/src/photo-upload-portal.tsx`, `supabase/migrations/20261017000000_photo_file_intake.sql`, `supabase/functions/` y SQLite `0015_photo_file_intake.sql`. La guía operativa exacta está en `docs/GOOGLE_DRIVE_SETUP.md`.

## Próxima validación autorizada

1. Revisar y aplicar `20261017010000_google_drive_oauth_hardening.sql` con `supabase db push`; no incluir seed.
2. Redesplegar start autenticado y callback con `--no-verify-jwt`.
3. Owner conecta Drive y confirma retorno a Configuración con estado conectado y una sola carpeta raíz `CentroColor`.
4. Verificar en logs el mismo fingerprint truncado entre start/callback, `differenceMs > 0`, token/Vault/root/upsert exitosos y `stateConsumed: true`.
5. Probar casos A/B/C: 10x15 con copies, Restauración y Job mixto. Verificar carpetas, metadata, `PEDIDO.txt`, intake y colas.
6. Probar token inválido/expirado/revocado/submitted, Google desconectado y refresh token revocado.
7. Cortar una carga grande, reintentar desde la misma pestaña y confirmar que sólo falla/reintenta ese archivo.
8. Abrir Desktop, sincronizar metadata, comprobar counts/IDs/colas y que no existan binarios en SQLite.

## Garantías y límites

Drive es almacenamiento primario; Supabase/SQLite sólo guardan metadata. El token real no se persiste, las credenciales Google son server-side y el portal no tiene acceso anon a tablas. Finalize verifica Drive y submit/manifest son idempotentes. Reabrir exige regenerar link y revoca el anterior.

No se implementaron login/galería/entrega digital del cliente, IA, Google Photos, Photoshop/Lightroom, impresión automática, WhatsApp/email, Event/FrameJob files ni duplicación en Supabase Storage. Ver CURRENT_STATE para checks y deuda.
