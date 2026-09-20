# Handoff

## Punto de reanudación

Sprint 2 implementado en el repositorio; no iniciar Sprint 3 sin una solicitud nueva. Leer `CURRENT_STATE.md` para lo que existe, `DECISIONS.md` para decisiones aprobadas y `ROADMAP.md` para el orden previsto. El detalle del producto y de la arquitectura está en sus documentos respectivos.

## Verificación

Desde la raíz: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` y `pnpm format:check`. Para ejecutar: `pnpm dev:web` o `pnpm dev:desktop`; para empaquetar Windows: `pnpm build:desktop`. En Sprint 2 pasaron typecheck, lint, 9 tests, build, format check y build nativo. La prueba Desktop confirmó las tablas nuevas y un `installation_id` estable tras reiniciar.

## Límites conocidos

La Web no tiene variables Supabase reales en este entorno. Las consultas de identidad Cloud requieren autenticación y políticas RLS futuras; no hay sincronización ni persistencia operativa de negocio. La PWA no está desplegada bajo HTTPS ni se probó su instalación manual. La CLI Supabase no está vinculada a un proyecto remoto; Docker no tiene daemon activo, por lo que la migración y el seed Cloud aún no se ejecutaron aquí.

## Activación Cloud pendiente

Ver `supabase/README.md`. Resumen: obtener el `project-ref` real del proyecto existente, ejecutar `pnpm exec supabase login` si hace falta, `pnpm exec supabase link --project-ref <ref-real>`, revisar `pnpm exec supabase db push --dry-run` y aplicar con `pnpm exec supabase db push`. No usar `--include-seed` en producción. Configurar en `apps/web/.env.local` la URL y clave pública indicadas en `.env.example`; el archivo queda ignorado por Git.
