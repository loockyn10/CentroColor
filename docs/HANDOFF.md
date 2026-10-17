# Handoff

## Punto de reanudación

Sprint 13 quedó implementado y verificado localmente el 16/10/2026. No aplicar migraciones ni desplegar funciones sin autorización. El dry-run remoto propone, en orden, `20261016000000_work_payments.sql` y `20261017000000_photo_file_intake.sql`; ninguna fue aplicada por esta tarea.

El 17/10/2026 se corrigió `_shared/supabase.ts`: la membresía administrativa se lee con el cliente autenticado/RLS, los errores de lectura ya no se confunden con ausencia de membresía y una política pura valida usuario, Business, estado y rol. Como el helper se empaqueta dentro de cada función, redesplegar exactamente `photo-file-admin` y `google-drive-oauth-start`; no cambiaron migraciones ni datos.

Ese mismo día se corrigió el lifecycle del OAuth state. El TTL siempre fue 600.000 ms; el mensaje inmediato provenía de ignorar el resultado de persistencia/lookup y tratar cualquier fila ausente como expirada. Start ahora confirma el INSERT y callback conserva el state hasta que tokens, Vault, carpeta e integración terminan correctamente. Hay logs seguros con fingerprint truncado y tiempos, sin secretos. Redesplegar `google-drive-oauth-start` y `google-drive-oauth-callback`; no hay migración nueva.

Los puntos principales son `packages/domain/src/photo.ts`, `packages/features/src/photo.tsx`, `apps/web/src/photo-upload-portal.tsx`, `supabase/migrations/20261017000000_photo_file_intake.sql`, `supabase/functions/` y SQLite `0015_photo_file_intake.sql`. La guía operativa exacta está en `docs/GOOGLE_DRIVE_SETUP.md`.

## Próxima validación autorizada

1. Revisar y aplicar primero WorkPayment y luego Photo File Intake con `supabase db push`; no incluir seed.
2. Configurar Google Cloud Drive API, consent screen, scope `drive.file`, OAuth Web Client y redirect URI exacta documentada.
3. Configurar secrets y desplegar las siete Edge Functions con los flags de JWT documentados.
4. Owner/admin conecta Drive y confirma cuenta/carpeta raíz; staff no puede administrar integración ni links.
5. Probar casos A/B/C: 10x15 con copies, Restauración y Job mixto. Verificar carpetas, metadata, `PEDIDO.txt`, intake y colas.
6. Probar token inválido/expirado/revocado/submitted, Google desconectado y refresh token revocado.
7. Cortar una carga grande, reintentar desde la misma pestaña y confirmar que sólo falla/reintenta ese archivo.
8. Abrir Desktop, sincronizar metadata, comprobar counts/IDs/colas y que no existan binarios en SQLite.

## Garantías y límites

Drive es almacenamiento primario; Supabase/SQLite sólo guardan metadata. El token real no se persiste, las credenciales Google son server-side y el portal no tiene acceso anon a tablas. Finalize verifica Drive y submit/manifest son idempotentes. Reabrir exige regenerar link y revoca el anterior.

No se implementaron login/galería/entrega digital del cliente, IA, Google Photos, Photoshop/Lightroom, impresión automática, WhatsApp/email, Event/FrameJob files ni duplicación en Supabase Storage. Ver CURRENT_STATE para checks y deuda.
