# Estado actual

Verificado el 19 de septiembre de 2026.

- Existe un monorepo pnpm con TypeScript strict, React, Vite, ESLint, Prettier y Vitest.
- `apps/desktop` usa Tauri 2. SQLite local `centrocolor.db` conserva `app_meta` y añade `businesses`, `branches` y `devices` mediante la migración 2. El bootstrap provisional creó una fila de cada identidad sobre la base preexistente; un reinicio confirmó el mismo `installation_id` y los mismos conteos.
- `apps/web` compila una PWA con manifest, iconos PNG locales de 192 y 512 píxeles y service worker registrado por `vite-plugin-pwa`. No está desplegada; no se probó la instalación manual en navegador.
- Ambos clientes importan `@centrocolor/ui` y `@centrocolor/features`. Solo Inicio es una pantalla de demostración; las demás opciones son placeholders.
- `packages/domain` contiene Business, Branch, Device y un tipo de dispositivo restringido, sin dependencias de infraestructura. `packages/application` define repositorios y resuelve un `AppContext` coherente. Hay adaptadores SQLite en Desktop y Supabase de solo lectura en Web.
- La Web tiene cliente Supabase configurado por URL y clave `publishable`; realiza un chequeo de conexión solo en desarrollo. No existen variables reales en el repositorio ni conexión remota verificada en este entorno.
- La CLI local de Supabase y una migración SQL versionada crean las tres tablas Cloud con RLS y sin políticas cliente. `seed.sql` aporta CentroColor y Sucursal principal solo para desarrollo. El proyecto remoto no está vinculado y la migración no se aplicó ni pudo probarse localmente porque Docker no tiene daemon activo.
- No existen sincronización, autenticación completa ni funciones reales de clientes, ventas, turnos, eventos o marquetería. La UI sigue siendo una demostración.

Las verificaciones más recientes y las limitaciones de prueba se resumen en `HANDOFF.md`.
