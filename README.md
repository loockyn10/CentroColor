# CentroColor

Fundación técnica, identidad, acceso y Clientes. Desktop (Tauri/SQLite) y Web (PWA/Supabase) comparten dominio, contratos y UI. Clientes se guarda localmente en Desktop y en Cloud en Web; todavía no se sincroniza. Los demás módulos operativos siguen pendientes.

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

Para Web y Desktop, copiar el `.env.example` de cada app a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del proyecto existente. En desarrollo, Web muestra un aviso explícito si falta configuración; el build Web ahora falla antes de generar un deployment inválido. No usar claves secretas ni `service_role` en el cliente.

Vite incorpora las variables `VITE_` al bundle **durante el build**. En Vercel deben estar asignadas al entorno del deployment que se construye; cambiar sus valores requiere un nuevo build/deploy. Web valida la URL y la clave pública antes de crear el cliente y muestra un error de configuración específico si faltan o son inválidas. La clave `sb_publishable_` es pública y puede estar en el frontend; nunca configurar una `sb_secret_` ni `service_role`.

Las migraciones Cloud y el seed local están en `supabase/`. Consultar `supabase/README.md` para validar con Docker y vincular/aplicar al proyecto remoto sin guardar secretos. El seed no se envía al remoto con `db push` normal.
