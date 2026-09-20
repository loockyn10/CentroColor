# Handoff

## Punto de reanudación

Sprint 4 — Clientes está implementado en código para Web/Supabase y Desktop/SQLite con dominio, application y UI compartidos. Antes de usar Clientes en Web de producción, revisar el dry run, aplicar manualmente `20260921000000_customers.sql` mediante el flujo administrativo y probar con una cuenta real de membership activo. No aplicar el seed de desarrollo al remoto. La migración Desktop 0004 se registra en Tauri y se aplica incrementalmente al abrir una versión nueva.

Según el usuario, Sprint 3 ya está operativo en producción y CentroColor, Sucursal principal y al menos un owner fueron creados manualmente. Esta sesión no revalidó ese estado mediante credenciales reales.

## Sincronización pendiente

Clientes de Desktop quedan en SQLite y Clientes de Web en Supabase. No existen `sync_state` ni `sync_outbox`. Para sincronizar hará falta diseñar y probar una cola durable de cambios locales, autenticación de subida, descarga incremental, checkpoint, reintentos, idempotencia, identidad de dispositivo y reglas para ediciones concurrentes. No inferir sincronización de los UUID compartidos.

## Verificación

El 20 de septiembre pasaron `pnpm typecheck` en seis paquetes, `pnpm lint`, `pnpm test` (24 tests), `pnpm build`, `pnpm format:check` y `pnpm build:desktop` (ejecutable, MSI y NSIS). La migración SQLite 0004 se ejecutó en memoria y se verificaron inserción, búsqueda acotada por negocio en los cuatro campos, orden por estado y actualización. El build nativo emitió un aviso del linker de Windows, sin fallar.

`pnpm exec supabase db push --dry-run` conectó al remoto e informó **solo** `20260921000000_customers.sql` pendiente, sin seeds ni roles. No ejecutó la migración ni comprobó sus policies con usuarios reales. La instalación local de dependencias requirió acceso al cache y al registro por el control de paquetes de esta sesión; el lockfile conserva únicamente la nueva dependencia workspace de features. No se realizó prueba manual de UI en un dispositivo móvil ni de Web con usuario real.

## Próximo sprint

Recomendar sincronización de Clientes antes que Catálogo: Clientes ya es la primera entidad operativa con dos persistencias que divergen y sirve para validar una ruta de sincronización acotada antes de sumar nuevas entidades. La decisión corresponde al responsable del proyecto.
