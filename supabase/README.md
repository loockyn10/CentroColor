# Supabase

La CLI local se configura en `config.toml`. `migrations/20260919000000_identity_foundation.sql` crea Business, Branch y Device con RLS habilitado y sin políticas de acceso cliente. `seed.sql` añade CentroColor y Sucursal principal solo en desarrollo y es idempotente. No contiene secretos ni IDs de proyecto remoto.

Con Docker activo, ejecutar desde la raíz `pnpm exec supabase start` y `pnpm exec supabase db reset` para recrear la base local de desarrollo y verificar migración + seed. `db reset` borra la base **local**; no usar `--linked` para esta validación.

Para el proyecto remoto existente, iniciar sesión en la CLI si hace falta, ejecutar `pnpm exec supabase link --project-ref <ref-real>`, revisar `pnpm exec supabase db push --dry-run` y aplicar con `pnpm exec supabase db push`. No usar `--include-seed` en producción; para un remoto exclusivo de desarrollo puede añadirse explícitamente si se desea el seed. Si el proyecto remoto ya tiene cambios de esquema fuera del repositorio, inspeccionarlos y reconciliarlos antes de `db push`.

Antes de validar localmente contra el remoto, comprobar que `db.major_version` en `config.toml` coincide con la versión PostgreSQL del proyecto existente; no se pudo consultar ese proyecto desde esta sesión.
