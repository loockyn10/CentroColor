# Handoff

## Punto de reanudación

Sprint 8 Agenda + Turnos está implementado en código. **No aplicar automáticamente** `supabase/migrations/20260925000000_inventory.sql` ni `supabase/migrations/20261011000000_appointments.sql`. El 11/10/2026 `supabase migration list` y `supabase db push --dry-run` fallaron antes de planificar porque el endpoint de rol de login devolvió 403 por privilegios insuficientes. No hubo push real. El último historial remoto verificado sigue siendo el del 21/9/2026: migraciones `20260919000000` a `20260924000000` aplicadas.

Resolver el acceso administrativo de Supabase, repetir `migration list` y `db push --dry-run`, revisar que enumere exactamente inventario y agenda, y aplicar por el flujo habitual solo con autorización humana. Después probar con usuarios reales:

1. owner/admin crea tipos, turno Web 10:00–10:15 y cancela;
2. staff ve/crea/edita/completa/no-show, pero no gestiona tipos ni cancela;
3. Desktop recibe Web, crea offline y sincroniza al reconectar;
4. Customer y tipo de otro Business son rechazados y Branch queda aislada;
5. reprogramación simultánea Web/Desktop produce conflicto y ambas opciones resuelven sin perder silenciosamente el cambio;
6. horario local se mantiene idéntico en Desktop y Web.

## Implementación

`packages/domain/src/appointment.ts` define modelos y reglas. `packages/application/src/appointment.ts` contiene el puerto/casos de uso y `appointment-sync.ts` el ciclo incremental. `packages/features/src/appointments.tsx` implementa Calendario, Turnos, Tipos, editor/alta rápida y dashboard. Los adaptadores concretos están en `apps/desktop/src/*appointment*` y `apps/web/src/supabase-appointment-repository.ts`.

SQLite 0009 almacena entidades, metadata local, outbox y cursores. Cloud `20261011000000_appointments.sql` agrega tablas, reloj monotónico, FK compuestas, RLS y grants. El orden Desktop es Customer → POS/Stock → AppointmentType → Appointment. Un pull remoto usa `sync_origin='remote'` y no genera loop. Reprogramar y estados conservan el UUID. El panel de sync suma pendientes/conflictos de agenda y permite conservar Desktop o Web.

Appointment es deliberadamente distinto de Event y ResourceReservation. No se implementaron casamientos/15 como eventos, cabina/pantalla, recursos, marquetería, notificaciones ni pagos.

## Verificación y límites

Ver `CURRENT_STATE.md` para resultados exactos. Los checks TypeScript, lint, 59 unit tests, pruebas SQLite, builds Web/Desktop, formato y bundle NSIS pasan. El SQL Cloud nuevo no fue ejecutado contra PostgreSQL. El dry-run no produjo una lista debido al 403. Pendientes técnicos: prueba E2E/RLS real, zona IANA explícita por Business si habrá operación multi-zona, búsqueda Web server-side combinada al superar 500 filas por período y code-splitting por warning de bundle.
