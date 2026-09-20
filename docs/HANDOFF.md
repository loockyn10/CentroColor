# Handoff

## Punto de reanudación

El Sprint 3 de autenticación está implementado en código. La CLI conectó al proyecto remoto y el dry run detectó solo `20260920000000_auth_memberships_rls.sql` pendiente. Aplicar y probar esa migración, crear el primer owner y probar Web/Desktop con una cuenta real. Seguir `supabase/README.md`. No iniciar Sprint 4 ni módulos operativos sin una solicitud nueva.

La Web desplegada en Vercel reportó un error genérico antes de generar una petición Auth. El flujo local con variables públicas válidas sí llegó al rechazo de credenciales ficticias. Se corrigió el manejo de errores y se añadió una validación de build que rechaza configuración ausente o inválida. Falta inspeccionar el bundle Vercel específico para identificar el valor o excepción que produjo el fallo allí; se solicitó su URL pública.

## Verificación

El 20 de septiembre pasaron `pnpm typecheck`, `pnpm lint`, `pnpm test` (16 tests), `pnpm build`, `pnpm format:check` y `pnpm build:desktop` (ejecutable, MSI y NSIS). La migración SQLite 0003 se ejecutó sin error en una base en memoria. `pnpm exec supabase db push --dry-run` conectó al remoto y listó solo la nueva migración; no validó ejecutándola. Docker local no tiene daemon activo.

Para la corrección Web pasaron nuevamente los cinco checks; Vitest llegó a 20 tests. El build Web de producción incorporó URL y clave pública locales (se verificó su presencia sin imprimir la clave) y no dejó referencias Vite sin resolver. Un build con URL intencionalmente inválida falló antes de generar artefactos, como se espera. No se probaron credenciales reales.

## Límites conocidos

No se dispone aquí de URL/clave pública Supabase reales ni credenciales de usuario para las apps. La migración y las políticas RLS todavía no se aplicaron ni probaron en una instancia. Desktop guarda un contexto offline local en SQLite sin PIN; una revocación remota no llega al equipo desconectado. Revalidar requiere login online antes de futuras acciones Cloud. No existe Sync Engine. La PWA no se probó instalada manualmente.

## Activación Cloud pendiente

Revisar de nuevo `pnpm exec supabase db push --dry-run`, aplicar `pnpm exec supabase db push`, confirmar CentroColor y una sucursal activa, crear el usuario desde Supabase Auth y asignarle membership `owner` mediante el SQL documentado. Completar las variables públicas de ambas apps en sus `.env.local` ignorados por Git. No guardar secretos ni usar `service_role` en clientes.
