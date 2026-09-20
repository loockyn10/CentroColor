# Arquitectura

## Clientes y código compartido

- `apps/desktop`: React/Vite dentro de Tauri 2. Debe operar sin Internet; SQLite local es la fuente primaria durante la operación.
- `apps/web`: React/Vite configurada como PWA. Supabase/PostgreSQL será la fuente central compartida y la fuente primaria de la Web cuando se implemente la persistencia cloud. Hoy no existe un cliente Supabase ni operaciones cloud; solo hay variables de entorno preparadas.
- `packages/domain`: TypeScript puro para entidades, valores y reglas futuras. No depende de infraestructura ni UI.
- `packages/application`: contratos y casos de uso. Los adaptadores de cada cliente implementan sus puertos; la UI evita acoplarse a SQLite o Supabase.
- `packages/ui`: AppShell, navegación, componentes básicos y CSS responsive compartidos.
- `packages/features`: pantallas compartidas; solo Inicio y una pantalla placeholder en este sprint.

El adaptador SQLite reside en Desktop. En un sprint futuro, un adaptador Supabase residirá en la capa de infraestructura Web. No existe todavía persistencia de negocio ni sincronización.

## Offline first y futura sincronización

Desktop SQLite ↔ futuro Sync Engine ↔ Supabase/PostgreSQL. La aplicación Desktop no necesita consultar Cloud para iniciar o mostrar la UI. El motor futuro deberá manejar identidad de dispositivo (`device_id`), conflictos, reintentos y estado de cambios; no se implementa aquí. El build Web genera manifest y service worker que precachea el shell. No se promete operación de negocio offline ni se ha comprobado la instalación manual desde un navegador.

La base local solo crea `app_meta` como prueba de inicialización. El estado se muestra únicamente en desarrollo.
