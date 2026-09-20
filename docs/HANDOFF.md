# Handoff

## Punto de reanudación

Sprint 5 implementa sincronización eventual exclusivamente de Customer entre Desktop SQLite y Supabase. La nueva migración Cloud `20260922000000_customer_sync_timestamps.sql` está pendiente; `pnpm exec supabase db push --dry-run` conectó al remoto y mostró solo ese archivo, sin seeds ni roles. Revisar y aplicar manualmente mediante el flujo administrativo; después probar con una cuenta real los casos offline→push, Web→pull y conflicto. No ejecutar `--include-seed` en producción. Según el usuario, la migración Cloud de Customer de Sprint 4 ya fue aplicada.

## Flujo implementado

SQLite 0005 registra cambios locales mediante triggers en `sync_outbox` y compacta una operación `upsert` por Customer y negocio. La escritura del Customer y el pendiente son atómicos. La migración encola Customers locales anteriores. Application orquesta push y pull; adaptadores Desktop concretan SQLite y Supabase. El push usa la sesión Supabase actual, membership activo, RLS y comparación de versión `updated_at`. El pull pagina por `(updated_at, id)`, persiste cursor por negocio y aplica cambios remotos sin outbox. Si ambas plataformas modifican la misma versión, queda un conflicto local; el indicador Desktop permite elegir versión local o Web tras una nueva lectura Cloud.

`offline-authenticated` permite seguir usando SQLite, pero no autoriza llamadas Cloud. Desktop no guarda tokens; revalidar requiere login. Se intenta sincronizar tras login online, cuando haya una sesión válida al iniciar, al volver la conectividad, cada dos minutos y con `Sincronizar ahora`. Web sigue usando Supabase directamente. Ninguna otra entidad se sincroniza.

## Verificación

Pasaron `pnpm typecheck` en seis paquetes, `pnpm lint`, `pnpm test` (32 pruebas), `pnpm build`, `pnpm format:check` y `pnpm build:desktop` (ejecutable, MSI y NSIS). También pasó `tests/customer_sync_sqlite.py`: ejecutó las migraciones 0004 y 0005, comprobó backfill, outbox atómico/compactado, supresión de eco remoto y persistencia tras reabrir SQLite. El build nativo emitió un aviso del linker de Windows sin fallar.

`pnpm exec supabase db push --dry-run` conectó al remoto e informó exclusivamente `20260922000000_customer_sync_timestamps.sql` pendiente, sin seeds ni roles; no ejecutó el SQL. No se realizó prueba de extremo a extremo con cuentas reales ni se aplicó la nueva migración Cloud. La sintaxis y el comportamiento del trigger PostgreSQL deberán verificarse al aplicar la migración mediante el flujo administrativo.

## Límite y próxima etapa

El cursor compuesto cubre filas con igual timestamp de la migración inicial. La tabla privada `customer_sync_clock` serializa las escrituras Cloud por negocio para mantener el orden de versiones; medir su contención si el volumen crece. La UI resuelve conflictos por Customer completo, sin combinación campo por campo. Probar manualmente Desktop y Web con una cuenta real después de aplicar la migración. Sprint 6 no se inició.
