# Handoff

## Punto de reanudación

Sprint 1 terminado; no iniciar Sprint 2 sin una solicitud nueva. Leer `CURRENT_STATE.md` para lo que existe, `DECISIONS.md` para decisiones aprobadas y `ROADMAP.md` para el orden previsto. El detalle del producto y de la arquitectura está en sus documentos respectivos.

## Verificación

Desde la raíz: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` y `pnpm format:check`. Para ejecutar: `pnpm dev:web` o `pnpm dev:desktop`; para empaquetar Windows: `pnpm build:desktop`. Los comandos se ejecutaron correctamente en Sprint 1. El ejecutable Desktop abrió y la base local mostró `app_meta`.

## Límites conocidos

La Web no tiene todavía cliente Supabase ni datos cloud. No existe sincronización ni persistencia de negocio. La PWA tiene artefactos de instalación generados, pero aún no se probó la instalación manual ni se desplegó bajo HTTPS. El arranque Desktop se comprobó con SQLite local, sin una prueba física de desconexión de red.
