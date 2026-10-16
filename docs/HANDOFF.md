# Handoff

## Punto de reanudación

Sprint 12 WorkPayment quedó implementado en código el 16/10/2026. Los archivos principales son `packages/domain/src/payment.ts`, `packages/application/src/payment.ts`, `packages/application/src/payment-sync.ts`, `packages/features/src/payments.tsx`, los adaptadores `*work-payment*` de Desktop/Web, SQLite `0014_work_payments.sql` y Cloud `20261016000000_work_payments.sql`.

No aplicar migraciones ni ejecutar `db push` real sin autorización. El dry-run remoto del 16/10/2026 conectó correctamente y propuso sólo `20261016000000_work_payments.sql`; las migraciones previas ya son reconocidas por el proyecto vinculado.

Con autorización administrativa:

1. Revisar y aplicar únicamente `20261016000000_work_payments.sql`.
2. Validar owner/admin/staff: todos leen cuentas y registran pagos; sólo owner/admin anula.
3. Probar Event $500.000 con seña $100.000 y pago $400.000; FrameJob $80.000 con seña $30.000; PhotoJob $10.000 con pago total.
4. Verificar refund, refund anulado, pago anulado con motivo y persistencia visual del historial.
5. Abrir Web y otro Web/Desktop sobre el último saldo: Cloud debe aceptar uno y rechazar el segundo sin sobrepago.
6. Repetir con Desktop offline: al reconectar, el pago rechazado debe quedar “Conflicto Cloud”; owner/admin puede “Descartar conflicto”, que lo anula localmente sin borrarlo.
7. Cancelar una fuente con dinero recibido y confirmar la advertencia sin devolución automática.
8. Revisar Customer account y Dashboard owner/admin con datos reales y volumen representativo.

## Garantías y límites

WorkPayment es un ledger común para Event/FrameJob/PhotoJob con FK reales y una sola fuente. Deposit/payment suman, refund resta y voided no cuenta. Cloud es autoridad final del saldo y serializa por fuente. Sale/POS no fue modificado ni integrado. No hay DELETE físico, facturación fiscal, caja, contabilidad, bancos ni cuenta corriente manual.

Los checks locales pasan: typecheck, lint, 79 tests, regresión Python completa, build, format, build Desktop y `git diff --check`. El instalador está en `apps/desktop/src-tauri/target/release/bundle/nsis/CentroColor_0.1.0_x64-setup.exe`. El dry-run remoto pasa y propone sólo la migración de WorkPayment. Ver `CURRENT_STATE.md` para resultados exactos y deuda técnica.
