# Supabase

La CLI local se configura en `config.toml`. La primera migración crea Business, Branch y Device. `migrations/20260920000000_auth_memberships_rls.sql` agrega profiles, memberships y políticas RLS de lectura por negocio. `migrations/20260921000000_customers.sql` agrega Clientes con políticas por membership activo. `seed.sql` añade CentroColor y Sucursal principal solo en desarrollo y es idempotente. No contiene secretos ni IDs de proyecto remoto.

Con Docker activo, ejecutar desde la raíz `pnpm exec supabase start` y `pnpm exec supabase db reset` para recrear la base local de desarrollo y verificar migración + seed. `db reset` borra la base **local**; no usar `--linked` para esta validación.

Para el proyecto remoto existente, iniciar sesión en la CLI si hace falta, ejecutar `pnpm exec supabase link --project-ref <ref-real>`, revisar `pnpm exec supabase db push --dry-run` y aplicar con `pnpm exec supabase db push`. No usar `--include-seed` en producción; para un remoto exclusivo de desarrollo puede añadirse explícitamente si se desea el seed. Si el proyecto remoto ya tiene cambios de esquema fuera del repositorio, inspeccionarlos y reconciliarlos antes de `db push`.

Antes de validar localmente contra el remoto, comprobar que `db.major_version` en `config.toml` coincide con la versión PostgreSQL del proyecto existente. El bootstrap de producción de CentroColor, Sucursal principal y primer owner ya se realizó manualmente según el estado comunicado; no repetirlo sin comprobar registros actuales. Antes de aplicar Clientes, ejecutar `pnpm exec supabase db push --dry-run`, confirmar que solo figuren migraciones esperadas y luego `pnpm exec supabase db push` mediante el flujo administrativo del proyecto. No usar `--include-seed`.

## Primer owner de CentroColor

1. En Supabase Dashboard, desactivar registro público en Authentication → Providers → Email si sigue habilitado. Crear el usuario manualmente en Authentication → Users y asignar una contraseña temporal por un canal seguro. No guardar la contraseña en Git.
2. Copiar el UUID del usuario de Authentication → Users. Crear el negocio CentroColor en Table Editor o SQL Editor si aún no existe; confirmar que `slug = 'centrocolor'` y que existe al menos una sucursal activa.
3. En SQL Editor, como administrador de la base, reemplazar el UUID marcador y ejecutar:

```sql
insert into public.business_memberships (business_id, user_id, role)
select id, 'REEMPLAZAR_UUID_DEL_USUARIO'::uuid, 'owner'
from public.businesses
where slug = 'centrocolor'
on conflict (business_id, user_id)
do update set role = 'owner', is_active = true, updated_at = now();
```

El trigger crea `profiles` al crear usuarios nuevos; la migración rellena perfiles de usuarios anteriores. Si la consulta no inserta ninguna fila, verificar primero la existencia del negocio. El cliente no puede escribir memberships ni asignarse a otro negocio. Para otros usuarios, repetir el alta administrativa con un rol inicial permitido.

Web guarda el token de sesión en `localStorage` del origen mediante el SDK de Supabase para restaurarlo tras recargar. Desktop mantiene el token únicamente en memoria (`persistSession: false`); solo su contexto autorizado se copia a SQLite. En una reconexión Desktop, volver a iniciar sesión para revalidar antes de cualquier futura sincronización. RLS no protege SQLite.
