-- CentroColor: auditoría de datos operativos dependientes de Customers.
-- SOLO LECTURA. No crea objetos, no modifica datos y no ejecuta borrados.
-- Alcance propuesto: todos los customers del Business con slug = 'centrocolor'.

-- 1) Confirmar exactamente un Business objetivo.
select id, name, slug
from public.businesses
where slug = 'centrocolor';

-- 2) Confirmar qué tablas del esquema versionado existen realmente.
select expected.table_name,
       to_regclass('public.' || expected.table_name) is not null as exists_in_database
from (values
  ('customers'),
  ('appointments'),
  ('events'),
  ('event_service_items'),
  ('resource_reservations'),
  ('led_panel_reservations'),
  ('frame_quotes'),
  ('frame_quote_items'),
  ('frame_jobs'),
  ('plotter_quotes'),
  ('photo_jobs'),
  ('photo_job_items'),
  ('photo_job_upload_links'),
  ('photo_job_files'),
  ('photo_job_drive_folders'),
  ('public_photo_orders'),
  ('outbound_notifications'),
  ('outbound_notification_events'),
  ('work_payments')
) as expected(table_name)
order by expected.table_name;

-- 3) Grafo FK real y recursivo desde customers y work_payments.
-- Una fila child_table -> parent_table significa que child_table debe borrarse primero.
with recursive fk_edges as (
  select child_ns.nspname as child_schema,
         child.relname as child_table,
         parent_ns.nspname as parent_schema,
         parent.relname as parent_table,
         con.conname as constraint_name,
         case con.confdeltype
           when 'a' then 'NO ACTION'
           when 'r' then 'RESTRICT'
           when 'c' then 'CASCADE'
           when 'n' then 'SET NULL'
           when 'd' then 'SET DEFAULT'
         end as on_delete,
         pg_get_constraintdef(con.oid, true) as definition
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
  where con.contype = 'f'
), dependencies as (
  select e.parent_schema as root_schema,
         e.parent_table as root_table,
         e.child_schema,
         e.child_table,
         e.parent_schema,
         e.parent_table,
         e.constraint_name,
         e.on_delete,
         e.definition,
         1 as depth,
         array[e.parent_schema || '.' || e.parent_table,
               e.child_schema || '.' || e.child_table] as path
  from fk_edges e
  where e.parent_schema = 'public'
    and e.parent_table in ('customers', 'work_payments')

  union all

  select d.root_schema,
         d.root_table,
         e.child_schema,
         e.child_table,
         e.parent_schema,
         e.parent_table,
         e.constraint_name,
         e.on_delete,
         e.definition,
         d.depth + 1,
         d.path || (e.child_schema || '.' || e.child_table)
  from dependencies d
  join fk_edges e
    on e.parent_schema = d.child_schema
   and e.parent_table = d.child_table
  where not (e.child_schema || '.' || e.child_table = any(d.path))
)
select root_schema,
       root_table,
       depth,
       child_schema,
       child_table,
       parent_schema,
       parent_table,
       constraint_name,
       on_delete,
       definition
from dependencies
order by root_table, depth, child_schema, child_table, constraint_name;

-- 4) Conteos exactos para el alcance propuesto.
-- Requiere que existan todas las tablas indicadas por el preflight anterior.
with
target_business as materialized (
  select id
  from public.businesses
  where slug = 'centrocolor'
),
target_customers as materialized (
  select c.business_id, c.id
  from public.customers c
  join target_business b on b.id = c.business_id
),
target_appointments as materialized (
  select a.business_id, a.id
  from public.appointments a
  join target_customers c
    on c.business_id = a.business_id and c.id = a.customer_id
),
target_events as materialized (
  select e.business_id, e.id
  from public.events e
  join target_customers c
    on c.business_id = e.business_id and c.id = e.customer_id
),
base_frame_quotes as materialized (
  select q.business_id, q.id
  from public.frame_quotes q
  join target_customers c
    on c.business_id = q.business_id and c.id = q.customer_id
),
target_frame_jobs as materialized (
  select distinct j.business_id, j.id, j.quote_id
  from public.frame_jobs j
  left join target_customers c
    on c.business_id = j.business_id and c.id = j.customer_id
  left join base_frame_quotes q
    on q.business_id = j.business_id and q.id = j.quote_id
  where c.id is not null or q.id is not null
),
target_frame_quotes as materialized (
  select business_id, id from base_frame_quotes
  union
  select business_id, quote_id from target_frame_jobs
),
target_photo_jobs as materialized (
  select distinct j.business_id, j.id
  from public.photo_jobs j
  left join target_customers c
    on c.business_id = j.business_id and c.id = j.customer_id
  left join target_appointments a
    on a.business_id = j.business_id and a.id = j.source_appointment_id
  left join target_events e
    on e.business_id = j.business_id and e.id = j.source_event_id
  where c.id is not null or a.id is not null or e.id is not null
),
target_notifications as materialized (
  select distinct n.business_id, n.id
  from public.outbound_notifications n
  left join target_customers c
    on c.business_id = n.business_id and c.id = n.customer_id
  left join target_photo_jobs j
    on j.business_id = n.business_id and j.id = n.photo_job_id
  where c.id is not null or j.id is not null
),
counts as (
  select 1 as deletion_order, 'outbound_notification_events'::text as table_name, count(*)::bigint as rows_to_delete
  from public.outbound_notification_events x join target_notifications n on n.id = x.notification_id and n.business_id = x.business_id
  union all select 2, 'outbound_notifications', count(*) from target_notifications
  union all select 3, 'work_payments', count(*) from public.work_payments p
    where exists(select 1 from target_customers c where c.business_id=p.business_id and c.id=p.customer_id)
       or exists(select 1 from target_events e where e.business_id=p.business_id and e.id=p.event_id)
       or exists(select 1 from target_frame_jobs j where j.business_id=p.business_id and j.id=p.frame_job_id)
       or exists(select 1 from target_photo_jobs j where j.business_id=p.business_id and j.id=p.photo_job_id)
  union all select 4, 'public_photo_orders', count(*) from public.public_photo_orders o
    where exists(select 1 from target_customers c where c.business_id=o.business_id and c.id=o.customer_id)
       or exists(select 1 from target_photo_jobs j where j.business_id=o.business_id and j.id=o.photo_job_id)
  union all select 5, 'photo_job_files', count(*) from public.photo_job_files f
    where exists(select 1 from target_photo_jobs j where j.business_id=f.business_id and j.id=f.photo_job_id)
  union all select 6, 'photo_job_upload_links', count(*) from public.photo_job_upload_links l
    where exists(select 1 from target_photo_jobs j where j.business_id=l.business_id and j.id=l.photo_job_id)
  union all select 7, 'photo_job_drive_folders', count(*) from public.photo_job_drive_folders f
    where exists(select 1 from target_photo_jobs j where j.business_id=f.business_id and j.id=f.photo_job_id)
  union all select 8, 'photo_job_items', count(*) from public.photo_job_items i
    where exists(select 1 from target_photo_jobs j where j.business_id=i.business_id and j.id=i.photo_job_id)
  union all select 9, 'photo_jobs', count(*) from target_photo_jobs
  union all select 10, 'led_panel_reservations', count(*) from public.led_panel_reservations r
    where exists(select 1 from target_events e where e.business_id=r.business_id and e.id=r.event_id)
  union all select 11, 'resource_reservations', count(*) from public.resource_reservations r
    where exists(select 1 from target_events e where e.business_id=r.business_id and e.id=r.event_id)
  union all select 12, 'event_service_items', count(*) from public.event_service_items i
    where exists(select 1 from target_events e where e.business_id=i.business_id and e.id=i.event_id)
  union all select 13, 'events', count(*) from target_events
  union all select 14, 'frame_jobs', count(*) from target_frame_jobs
  union all select 15, 'frame_quote_items', count(*) from public.frame_quote_items i
    where exists(select 1 from target_frame_quotes q where q.business_id=i.business_id and q.id=i.quote_id)
  union all select 16, 'frame_quotes', count(*) from target_frame_quotes
  union all select 17, 'appointments', count(*) from target_appointments
  union all select 18, 'plotter_quotes', count(*) from public.plotter_quotes q
    where exists(select 1 from target_customers c where c.business_id=q.business_id and c.id=q.customer_id)
  union all select 19, 'customers', count(*) from target_customers
)
select deletion_order, table_name, rows_to_delete
from counts
order by deletion_order;

