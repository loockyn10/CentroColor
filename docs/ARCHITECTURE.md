# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. SQLite local es la fuente primaria durante la operación y permite iniciar sin Cloud. El adaptador local almacena Business, Branch y Device.
- `apps/web`: React/Vite configurada como PWA. Tiene cliente y repositorios Supabase aislados en su propia capa de infraestructura. Supabase/PostgreSQL es la fuente primaria prevista para Web; las consultas protegidas requieren autenticación y políticas RLS futuras.
- `packages/domain`: TypeScript puro para Business, Branch y Device; no depende de infraestructura ni UI.
- `packages/application`: contratos de repositorios y resolución del contexto actual. Los adaptadores de cada cliente implementan sus puertos; la UI compartida no consulta SQLite ni Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: pantallas compartidas; solo Inicio y una pantalla placeholder en este sprint.

El adaptador SQLite reside en Desktop y el adaptador Supabase en Web. No existe todavía persistencia de operaciones de negocio ni sincronización. La integración remota requiere vincular el proyecto existente y aplicar la migración versionada; el repositorio no está vinculado actualmente.

## Identidad estructural

Desktop crea una sola vez un `installation_id` con `crypto.randomUUID()`, lo guarda en `app_meta` y reutiliza ese valor en cada inicio. El bootstrap provisional, activo también en el build de producción hasta que exista onboarding, crea si faltan CentroColor, Sucursal principal y un Device local; guarda la selección actual en `app_meta`. `AppContext` concentra `businessId`, `branchId`, `deviceId` e `installationId`. Los IDs no están hardcodeados y la inicialización no borra datos existentes.

Cloud y SQLite representan las mismas entidades del dominio. Los adaptadores traducen entre columnas `snake_case` y tipos TypeScript `camelCase`. Los IDs son UUID generables sin conexión. Cloud usa `timestamptz` y SQLite guarda instantes UTC ISO 8601 como texto; `created_at` se fija al insertar y los futuros escritores deberán actualizar `updated_at` en cada modificación. No hay versionado ni resolución de conflictos.

Las tres tablas Cloud tienen RLS habilitado y los roles cliente `anon` y `authenticated` carecen de permisos y políticas de acceso. Las operaciones Web protegidas quedan pendientes de autenticación y políticas por negocio/sucursal. El chequeo de configuración en desarrollo distingue conexión disponible de autorización pendiente, sin mostrar detalles técnicos en producción.

## Offline first y futura sincronización

Desktop SQLite ↔ futuro Sync Engine ↔ Supabase/PostgreSQL. La aplicación Desktop no necesita consultar Cloud para iniciar o mostrar la UI. El motor futuro deberá manejar identidad de dispositivo (`device_id`), conflictos, reintentos y estado de cambios; no se implementa aquí. El build Web genera manifest y service worker que precachea el shell. No se promete operación de negocio offline ni se ha comprobado la instalación manual desde un navegador.

La base local conserva `app_meta` y ahora añade `businesses`, `branches` y `devices` mediante una segunda migración. El estado técnico se muestra únicamente en desarrollo.
