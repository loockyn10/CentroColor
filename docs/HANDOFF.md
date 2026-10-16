# Handoff

## Punto de reanudación

Sprint 11 Trabajos fotográficos quedó implementado en código el 16/10/2026. Los archivos principales son `packages/domain/src/photo.ts`, `packages/application/src/photo.ts`, `packages/application/src/photo-sync.ts`, `packages/features/src/photo.tsx`, los adaptadores `*photo*` de Desktop/Web, SQLite `0013_photo_jobs.sql` y Cloud `20261015000000_photo_jobs.sql`.

No aplicar migraciones ni ejecutar `db push` real sin autorización. El último remoto confirmado (21/9/2026) solo llegaba a POS. Inventario, Agenda, Eventos, Marquetería y Fotografía figuran pendientes en el repositorio; `migration list` y el dry-run actuales no pudieron reconfirmarlo porque el endpoint de login role devolvió `LegacyDbConfigLoginRoleStatusError` 403.

Con acceso administrativo:

1. Ejecutar `pnpm exec supabase migration list` y `pnpm exec supabase db push --dry-run`.
2. Revisar el plan exacto, en especial las seis migraciones desde `20260925000000` hasta `20261015000000`.
3. Aplicar únicamente con autorización humana.
4. Validar owner/admin/staff: catálogo PhotoService, alta Web/Desktop, estados y aislamiento por Business.
5. Crear offline un trabajo con varios items, cerrar/reabrir Desktop, cambiarlo a `in_progress`, reconectar y comprobar UUID/snapshots en Web.
6. Provocar `received → in_progress` en Desktop offline y `received → ready` en Web; comprobar que el outbox queda en conflicto y no pierde silenciosamente un estado.
7. Verificar Dashboard/cola mobile y `ready → delivered` con un teléfono real.

## Garantías y límites

Appointment != Event != PhotoJob != FrameJob. Product != PhotoService. El catálogo no altera precios históricos. Customer es obligatorio. Los totales usan centavos enteros y se derivan de items activos. No hay DELETE físico, pagos, archivos/fotos, notificaciones ni integración POS.

Los checks locales pasan: typecheck, lint, 74 tests, regresión Python completa, build, format, build Desktop y `git diff --check`. El instalador está en `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. Ver `CURRENT_STATE.md` para resultados exactos y deuda técnica.
