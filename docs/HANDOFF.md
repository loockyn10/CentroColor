# Handoff

## Punto de reanudación

Sprint 9 Eventos + Recursos reservables está implementado en código. **No aplicar automáticamente** `supabase/migrations/20260925000000_inventory.sql`, `supabase/migrations/20261011000000_appointments.sql` ni `supabase/migrations/20261012000000_events_resources.sql`. No hubo push real. El último historial remoto confirmado sigue siendo el del 21/9/2026: migraciones `20260919000000` a `20260924000000` aplicadas. En esta sesión `migration list` y `db push --dry-run` volvieron a fallar antes de consultar/planificar con `LegacyDbConfigLoginRoleStatusError` 403, de modo que el estado remoto actual no pudo reconfirmarse.

Con acceso administrativo, repetir `supabase migration list` y `pnpm exec supabase db push --dry-run`, revisar el plan exacto y aplicar únicamente con autorización humana. Después validar con usuarios reales:

1. PWA crea un casamiento que cruza medianoche con Fotografía, Video y Cabina; Desktop recibe el bundle completo.
2. Una reserva Web superpuesta del mismo Resource queda bloqueada; una contigua u otro Resource se acepta.
3. Cancelar el Event libera la disponibilidad sin borrar la reserva.
4. Un alquiler de Pantalla sin servicios se guarda y sincroniza.
5. Owner/admin gestiona EventTypes/Resources; staff opera Events pero no configuración.
6. Desktop crea offline mientras Web reserva el mismo recurso; al reconectar, Cloud conserva su reserva y Desktop muestra el conflicto local para editar/desactivar.
7. Customer, Branch, EventType, Event o Resource de otro Business son rechazados.

## Implementación

`packages/domain/src/event.ts` define modelos y reglas. `packages/application/src/event.ts` contiene el puerto/casos de uso y `event-sync.ts` el ciclo incremental. `packages/features/src/events.tsx` implementa listado, ficha/editor, alta rápida de Customer, tipos, catálogo, disponibilidad y dashboard. Los adaptadores concretos están en `apps/desktop/src/*event*` y `apps/web/src/supabase-event-repository.ts`.

SQLite 0010 almacena entidades, metadata local, outbox y cursores. Cloud `20261012000000_events_resources.sql` agrega tablas, reloj monotónico, FK compuestas, RLS y guards transaccionales con advisory locks. El orden Desktop respeta Customer antes de EventType/Resource/Event/items/reservas. Pull remoto no genera outbox. Conflictos de versión permiten elegir Desktop/Web; conflictos físicos conservan ambas reservas y requieren editar/desactivar la local.

Event no es Appointment. Resource no es Product. No se agregaron pagos, señas, contratos, Marquetería ni otros módulos fuera de Sprint 9.

## Verificación y deuda

Ver `CURRENT_STATE.md` para resultados exactos. Typecheck, lint, 67 unit tests, regresión Python, build Web/Desktop, formato e instalador NSIS pasan. El SQL Cloud nuevo no se ejecutó contra PostgreSQL y el dry-run no produjo plan por el 403. Deuda conocida: prueba E2E/RLS real contra PostgreSQL, validación de carrera concurrente con dos sesiones reales, transacción/RPC opcional para guardar todo el bundle Web en una sola operación, búsqueda server-side al superar 500 filas, timezone IANA por Business y code-splitting por el warning de bundle.
