-- Papelera de catálogos: «Eliminar» deja de ser sólo «Inactivo».
--
-- Eliminar es reversible y distinto de desactivar:
--   * is_active  = el elemento existe pero no se ofrece por ahora (sigue en los listados).
--   * deleted_at = el elemento está en la Papelera: desaparece de listados, búsquedas, filtros y
--     selectores, y sólo se ve en Configuración → Papelera, desde donde se restaura.
-- La fila nunca se borra, de modo que ventas, presupuestos, turnos y cotizaciones históricas
-- conservan la referencia (y los snapshots de nombre) aunque el catálogo ya no lo muestre.
--
-- Sólo catálogos de configuración. No se aplica a ventas, pagos, movimientos de stock, reservas,
-- cotizaciones ni a nada que deba conservarse por auditoría. Tampoco a servicios fotográficos,
-- precios ni materiales de plotter (los expone el flujo público o los usan reglas de precio por
-- código): ver docs/DECISIONS.md.
--
-- El trigger de versión de cada tabla (pos_/appointment_/event_/framing_next_version) ya asigna
-- updated_at en cada UPDATE, así que la eliminación y la restauración viajan por el sync
-- incremental `(updated_at, id)` de Desktop igual que cualquier otro cambio.

alter table public.product_categories add column deleted_at timestamptz;
alter table public.products add column deleted_at timestamptz;
alter table public.appointment_types add column deleted_at timestamptz;
alter table public.event_types add column deleted_at timestamptz;
alter table public.resources add column deleted_at timestamptz;
alter table public.frame_mouldings add column deleted_at timestamptz;
alter table public.frame_materials add column deleted_at timestamptz;

-- Mismos permisos de columna que `is_active`: lo que hoy puede desactivar, puede eliminar.
grant update (deleted_at) on public.product_categories to authenticated;
grant update (deleted_at) on public.products to authenticated;
grant update (deleted_at) on public.appointment_types to authenticated;
grant update (deleted_at) on public.event_types to authenticated;
grant update (deleted_at) on public.resources to authenticated;
-- frame_mouldings / frame_materials ya tienen `grant update` a nivel de tabla.

-- El código de barras sólo debe ser único entre productos que no están en la Papelera: se puede
-- eliminar «Producto prueba 123» y volver a crearlo con el mismo código. Restaurar uno cuyo código
-- ya usa otro producto vivo falla por esta misma restricción.
drop index public.products_business_barcode_unique;
create unique index products_business_barcode_unique
  on public.products(business_id, barcode)
  where barcode is not null and deleted_at is null;

-- Papelera: lo eliminado, lo más reciente primero.
create index products_business_trash_idx
  on public.products(business_id, deleted_at desc) where deleted_at is not null;

comment on column public.products.deleted_at is
  'Papelera: no nulo = eliminado (reversible). Distinto de is_active. Nunca se borra la fila.';
comment on column public.product_categories.deleted_at is
  'Papelera: no nulo = eliminada (reversible). Los productos conservan category_id.';
comment on column public.appointment_types.deleted_at is 'Papelera: no nulo = eliminado (reversible).';
comment on column public.event_types.deleted_at is 'Papelera: no nulo = eliminado (reversible).';
comment on column public.resources.deleted_at is
  'Papelera: no nulo = eliminado (reversible). Las reservas históricas conservan resource_id.';
comment on column public.frame_mouldings.deleted_at is 'Papelera: no nulo = eliminada (reversible).';
comment on column public.frame_materials.deleted_at is 'Papelera: no nulo = eliminado (reversible).';
