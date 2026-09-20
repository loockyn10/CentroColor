# Estado actual

Verificado el 19 de septiembre de 2026.

- Existe un monorepo pnpm con TypeScript strict, React, Vite, ESLint, Prettier y Vitest.
- `apps/desktop` usa Tauri 2. El ejecutable Windows abrió y creó la base SQLite local `centrocolor.db`; su migración contiene únicamente `app_meta` como tabla propia de la aplicación. El plugin SQL crea también su tabla interna de migraciones.
- `apps/web` compila una PWA con manifest, iconos PNG locales de 192 y 512 píxeles y service worker registrado por `vite-plugin-pwa`. No está desplegada; no se probó la instalación manual en navegador.
- Ambos clientes importan `@centrocolor/ui` y `@centrocolor/features`. Solo Inicio es una pantalla de demostración; las demás opciones son placeholders.
- `packages/domain` contiene un guard mínimo de identificadores. `packages/application` contiene un puerto y un caso de uso mínimo para comprobar el estado de almacenamiento. El único adaptador concreto es el de SQLite en Desktop.
- Existen nombres de variables de entorno para Supabase, pero no hay cliente, conexión, esquema cloud ni operaciones cloud implementadas.
- No existen sincronización ni funciones reales de clientes, ventas, turnos, eventos o marquetería.

Las verificaciones más recientes y las limitaciones de prueba se resumen en `HANDOFF.md`.
