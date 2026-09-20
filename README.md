# CentroColor

Fundación técnica del sistema operativo para el negocio. Este sprint incluye dos clientes que comparten pantalla y componentes: Desktop (Tauri/SQLite) y Web (PWA; Supabase preparado para integración posterior).

## Requisitos

Node.js, pnpm 11, Rust con toolchain MSVC y los [prerrequisitos de Tauri para Windows](https://v2.tauri.app/start/prerequisites/) para ejecutar Desktop.

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
```

`pnpm build` compila los frontends Web y Desktop. `pnpm build:desktop` compila y empaqueta la aplicación nativa. La PWA se prueba instalable desde un servidor HTTPS o localhost con `pnpm --filter @centrocolor/web preview` luego de compilar.

Copiar `apps/web/.env.example` a `apps/web/.env.local` cuando existan credenciales públicas de Supabase. No se necesitan para iniciar esta demostración.
