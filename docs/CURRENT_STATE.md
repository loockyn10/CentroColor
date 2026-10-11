# Estado actual

Sprint 8 Agenda + Turnos implementado en código el 11 de octubre de 2026. Desktop y Web/PWA comparten Calendario Día/Semana, Turnos, Tipos de turno, formulario, alta rápida de Customer, estados, superposiciones y tarjeta real de Inicio. Desktop persiste y opera offline en SQLite; Web usa Supabase. **Las migraciones Cloud `20260925000000_inventory.sql` y `20261011000000_appointments.sql` están pendientes de aplicar**; no se hizo push real. Agenda Web y el sync de turnos no estarán operativos en el remoto hasta aplicar la migración nueva.

## Hechos verificados

- `AppointmentType` contiene nombre, duración predeterminada y estado activo. Owner/admin puede crear, editar, activar y desactivar. No contiene precio ni servicio.
- `Appointment` conserva UUID al editar o reprogramar; vincula Business, Branch, Customer y tipo opcional. El título es obligatorio e independiente del tipo. Cancelar, completar y ausente son updates, no DELETE.
- Calendario permite Día/Semana, anterior/hoy/siguiente, filtro simple y creación desde el día. Turnos agrega búsqueda por cliente/título y período/estado. La CSS adapta semana, formularios y listados a móvil.
- El formulario reutiliza `CustomerRepository`, permite alta rápida y selecciona el Customer creado. Elegir tipo copia su nombre cuando corresponde y calcula el fin por duración; el fin sigue editable.
- Overlap consulta solo `scheduled` de la Branch actual con intervalo semiabierto. Advierte y exige una segunda confirmación, pero no bloquea. Cancelados no participan.
- Inicio consulta el día actual de la Branch, muestra cantidad de programados y próximos tres.
- SQLite 0009 crea `appointment_types`, `appointments`, outbox y cursores. Triggers validan Customer/AppointmentType del mismo Business, compactan updates y no encolan pulls con `sync_origin='remote'`.
- Cloud `20261011000000_appointments.sql` prepara FK compuestas, índices, reloj monotónico, RLS y permisos. Owner/admin gestiona tipos y transiciones hacia/desde cancelado; staff ve, crea, edita, completa y marca ausente. No concede DELETE ni usa `service_role`.
- Desktop sincroniza `appointment_type` y `appointment` después de Customer. Usa UUID estable, comparación por `cloud_updated_at`, cursor `(updated_at,id)` y resolución “este equipo/Web” con ambas versiones visibles.
- Entrada `datetime-local` se transforma a ISO UTC; Cloud usa `timestamptz` y SQLite texto. No hay offsets hardcodeados. Una zona IANA por Business no existe aún.
- Events, reservas de recursos, cabina/pantalla, marquetería, notificaciones y pagos de turnos no fueron implementados.

## Verificación de esta sesión

- `pnpm typecheck`: pasa en domain, application, features, web y desktop.
- `pnpm lint`: pasa.
- `pnpm test`: 59 pruebas en 22 archivos, pasa. Incluye dominio de turnos, duración, end > start, overlap/cancelados, push/pull sin loop, conflicto concurrente y sync de estado.
- `tests/appointments_sqlite.py`: pasa; cubre tipo activar/desactivar, create, reprogram mismo UUID, cancel/complete/no_show, overlap, UTC, pull sin outbox, referencias multiempresa y Branch.
- `tests/appointments_cloud_sql.py`: pasa; verifica estáticamente FK multiempresa, RLS, roles, reloj de sync y ausencia de DELETE/service_role.
- `tests/customer_sync_sqlite.py`, `tests/pos_sqlite.py`, `tests/pos_sync_sqlite.py`, `tests/pos_cloud_fk.py`, `tests/inventory_sqlite.py`: pasan. La prueba Customer requirió ejecución fuera del sandbox para usar su directorio temporal.
- `pnpm build`: pasa para Web PWA y Desktop Vite. Advierte chunks JS mayores a 500 kB.
- `pnpm format:check`: pasa.
- `pnpm build:desktop`: pasa después de permitir la descarga de NSIS; genera `CentroColor_0.1.0_x64-setup.exe`.
- `supabase migration list` y `pnpm exec supabase db push --dry-run`: ambos fallan antes de consultar/planificar migraciones. El endpoint de rol de login responde `403` por privilegios insuficientes de la cuenta vinculada. No se ejecutó SQL ni push.

## Límites y pendientes

No hubo PostgreSQL local porque este entorno no dispone de una instancia Supabase/Docker validada. La migración Cloud de Agenda requiere revisión y aplicación administrativa junto con la de inventario; luego hacen falta pruebas RLS reales con owner/admin/staff, referencias entre negocios/sucursales, flujo móvil, Desktop offline→reconexión y conflicto simultáneo. La búsqueda Web filtra como máximo 500 turnos del período ya acotado; si crece el volumen conviene mover la búsqueda combinada Customer/título a una RPC o vista indexada. El bundle creció por encima del umbral de 500 kB y queda pendiente code-splitting.

La autorización offline Desktop continúa dependiendo de la última copia local validada; una revocación remota no se conoce hasta reconectar. Appointment muestra horario en la zona del dispositivo: una futura operación multi-zona necesita `business_timezone` IANA antes de asumir que todos los usuarios comparten zona.
