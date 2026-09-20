# Estado actual

Sprint 3 de autenticación implementado en el repositorio el 20 de septiembre de 2026. La activación de la nueva migración Cloud y la prueba con un usuario real siguen pendientes.

- El monorepo conserva TypeScript strict, React, Vite, Tauri 2, SQLite, Vitest y una PWA Web.
- La migración Cloud de Sprint 2 permanece intacta. Una segunda migración añade `profiles`, `business_memberships`, trigger de perfiles y políticas RLS de lectura para Business, Branch, Device, Profile y Membership. No hay escrituras cliente.
- Supabase Auth identifica al usuario. Un membership activo y un negocio visible permiten construir BusinessContext; Desktop exige además una sucursal activa. Los roles iniciales son `owner`, `admin` y `staff`.
- Web ofrece login, logout, restauración de sesión por SDK y estado “Sin acceso asignado”. Su token queda en `localStorage` del origen, gestionado por el SDK.
- Desktop ofrece login online inicial, logout y una copia del último contexto autorizado en SQLite (`authorized_context`). Al reiniciar carga esa copia como `offline-authenticated`; la revalidación Cloud exige iniciar sesión otra vez. No guarda contraseña ni token persistente.
- El adaptador estructural Desktop de Sprint 2 aún existe, pero la UI ya no ejecuta su bootstrap provisional. Las tablas locales previas se conservan. No existe sincronización ni operación de negocio implementada.
- La CLI se conectó al proyecto Cloud remoto y `db push --dry-run` informó solo la nueva migración como pendiente, sin aplicar cambios. Las variables `.env.local` no están configuradas y aún no se ha probado login real, RLS en una instancia ni instalación PWA manual.

Las verificaciones ejecutadas y las limitaciones se detallan en `HANDOFF.md`.
