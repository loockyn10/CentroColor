# CentroColor

Fundación técnica, identidad y acceso del sistema. Desktop (Tauri/SQLite) y Web (PWA/Supabase) comparten dominio, contratos y UI. Las funciones operativas siguen pendientes.

## Requisitos

Node.js, pnpm 9, Rust con toolchain MSVC y los [prerrequisitos de Tauri para Windows](https://v2.tauri.app/start/prerequisites/) para ejecutar Desktop. Docker es necesario solo para la pila local de Supabase.

## Comandos

```sh
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm build:desktop
pnpm format:check
```

`pnpm build` compila los frontends Web y Desktop. `pnpm build:desktop` compila y empaqueta la aplicación nativa. La PWA se prueba instalable desde un servidor HTTPS o localhost con `pnpm --filter @centrocolor/web preview` luego de compilar.

Para Web y Desktop, copiar el `.env.example` de cada app a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del proyecto existente. Sin estas variables aparece el formulario de acceso con un aviso de configuración. No usar claves secretas ni `service_role` en el cliente.

Las migraciones Cloud y el seed local están en `supabase/`. Consultar `supabase/README.md` para validar con Docker y vincular/aplicar al proyecto remoto sin guardar secretos. El seed no se envía al remoto con `db push` normal.
