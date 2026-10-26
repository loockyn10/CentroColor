-- CentroColor: limpieza transaccional PROPUESTA de datos operativos de prueba.
-- NO EJECUTADO. El estado por defecto prueba todos los DELETE y luego hace ROLLBACK.
-- Alcance: todos los customers del Business con slug = 'centrocolor' y sus dependencias.
-- Ejecutar sólo después de revisar customer_test_data_audit.sql y guardar sus conteos.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE;

-- Debe producir exactamente una fila. Si no, aborta antes de cualquier DELETE.
DO $$
DECLARE
  v_count integer;
BEGIN
  select count(*) into v_count from public.businesses where slug = 'centrocolor';
  if v_count <> 1 then
    raise exception 'Se esperaba exactamente un Business con slug centrocolor; encontrados: %', v_count;
  end if;
END;
$$;

-- Congelar el conjunto objetivo antes de borrar dependencias.
create temp table cleanup_customers on commit drop as
select c.business_id, c.id
from public.customers c
join public.businesses b on b.id = c.business_id
where b.slug = 'centrocolor';
create unique index on cleanup_customers(business_id, id);

create temp table cleanup_appointments on commit drop as
select a.business_id, a.id
from public.appointments a
join cleanup_customers c on c.business_id=a.business_id and c.id=a.customer_id;
create unique index on cleanup_appointments(business_id, id);

create temp table cleanup_events on commit drop as
select e.business_id, e.id
from public.events e
join cleanup_customers c on c.business_id=e.business_id and c.id=e.customer_id;
create unique index on cleanup_events(business_id, id);

create temp table cleanup_base_frame_quotes on commit drop as
select q.business_id, q.id
from public.frame_quotes q
join cleanup_customers c on c.business_id=q.business_id and c.id=q.customer_id;
create unique index on cleanup_base_frame_quotes(business_id, id);

create temp table cleanup_frame_jobs on commit drop as
select distinct j.business_id, j.id, j.quote_id
from public.frame_jobs j
left join cleanup_customers c on c.business_id=j.business_id and c.id=j.customer_id
left join cleanup_base_frame_quotes q on q.business_id=j.business_id and q.id=j.quote_id
where c.id is not null or q.id is not null;
create unique index on cleanup_frame_jobs(business_id, id);

create temp table cleanup_frame_quotes on commit drop as
select business_id, id from cleanup_base_frame_quotes
union
select business_id, quote_id from cleanup_frame_jobs;
create unique index on cleanup_frame_quotes(business_id, id);

create temp table cleanup_photo_jobs on commit drop as
select distinct j.business_id, j.id
from public.photo_jobs j
left join cleanup_customers c on c.business_id=j.business_id and c.id=j.customer_id
left join cleanup_appointments a on a.business_id=j.business_id and a.id=j.source_appointment_id
left join cleanup_events e on e.business_id=j.business_id and e.id=j.source_event_id
where c.id is not null or a.id is not null or e.id is not null;
create unique index on cleanup_photo_jobs(business_id, id);

create temp table cleanup_notifications on commit drop as
select distinct n.business_id, n.id
from public.outbound_notifications n
left join cleanup_customers c on c.business_id=n.business_id and c.id=n.customer_id
left join cleanup_photo_jobs j on j.business_id=n.business_id and j.id=n.photo_job_id
where c.id is not null or j.id is not null;
create unique index on cleanup_notifications(business_id, id);

-- Borrar hojas antes que padres. Cada sentencia informa su propio row count.
delete from public.outbound_notification_events x
using cleanup_notifications n
where x.business_id=n.business_id and x.notification_id=n.id;

delete from public.outbound_notifications x
using cleanup_notifications n
where x.business_id=n.business_id and x.id=n.id;

delete from public.work_payments p
where exists(select 1 from cleanup_customers c where c.business_id=p.business_id and c.id=p.customer_id)
   or exists(select 1 from cleanup_events e where e.business_id=p.business_id and e.id=p.event_id)
   or exists(select 1 from cleanup_frame_jobs j where j.business_id=p.business_id and j.id=p.frame_job_id)
   or exists(select 1 from cleanup_photo_jobs j where j.business_id=p.business_id and j.id=p.photo_job_id);

delete from public.public_photo_orders o
where exists(select 1 from cleanup_customers c where c.business_id=o.business_id and c.id=o.customer_id)
   or exists(select 1 from cleanup_photo_jobs j where j.business_id=o.business_id and j.id=o.photo_job_id);

delete from public.photo_job_files f
where exists(select 1 from cleanup_photo_jobs j where j.business_id=f.business_id and j.id=f.photo_job_id);

delete from public.photo_job_upload_links l
where exists(select 1 from cleanup_photo_jobs j where j.business_id=l.business_id and j.id=l.photo_job_id);

delete from public.photo_job_drive_folders f
where exists(select 1 from cleanup_photo_jobs j where j.business_id=f.business_id and j.id=f.photo_job_id);

delete from public.photo_job_items i
where exists(select 1 from cleanup_photo_jobs j where j.business_id=i.business_id and j.id=i.photo_job_id);

delete from public.photo_jobs j
using cleanup_photo_jobs target
where j.business_id=target.business_id and j.id=target.id;

delete from public.led_panel_reservations r
where exists(select 1 from cleanup_events e where e.business_id=r.business_id and e.id=r.event_id);

delete from public.resource_reservations r
where exists(select 1 from cleanup_events e where e.business_id=r.business_id and e.id=r.event_id);

delete from public.event_service_items i
where exists(select 1 from cleanup_events e where e.business_id=i.business_id and e.id=i.event_id);

delete from public.events e
using cleanup_events target
where e.business_id=target.business_id and e.id=target.id;

delete from public.frame_jobs j
using cleanup_frame_jobs target
where j.business_id=target.business_id and j.id=target.id;

delete from public.frame_quote_items i
where exists(select 1 from cleanup_frame_quotes q where q.business_id=i.business_id and q.id=i.quote_id);

delete from public.frame_quotes q
using cleanup_frame_quotes target
where q.business_id=target.business_id and q.id=target.id;

delete from public.appointments a
using cleanup_appointments target
where a.business_id=target.business_id and a.id=target.id;

delete from public.plotter_quotes q
where exists(select 1 from cleanup_customers c where c.business_id=q.business_id and c.id=q.customer_id);

delete from public.customers c
using cleanup_customers target
where c.business_id=target.business_id and c.id=target.id;

-- Debe devolver cero en todas las filas antes de considerar un COMMIT real.
select 'customers' as table_name, count(*)::bigint as residual_rows
from public.customers c join cleanup_customers t on t.business_id=c.business_id and t.id=c.id
union all select 'appointments', count(*) from public.appointments a join cleanup_appointments t on t.business_id=a.business_id and t.id=a.id
union all select 'events', count(*) from public.events e join cleanup_events t on t.business_id=e.business_id and t.id=e.id
union all select 'frame_quotes', count(*) from public.frame_quotes q join cleanup_frame_quotes t on t.business_id=q.business_id and t.id=q.id
union all select 'frame_jobs', count(*) from public.frame_jobs j join cleanup_frame_jobs t on t.business_id=j.business_id and t.id=j.id
union all select 'photo_jobs', count(*) from public.photo_jobs j join cleanup_photo_jobs t on t.business_id=j.business_id and t.id=j.id
union all select 'outbound_notifications', count(*) from public.outbound_notifications n join cleanup_notifications t on t.business_id=n.business_id and t.id=n.id
union all select 'work_payments', count(*) from public.work_payments p
  where exists(select 1 from cleanup_customers c where c.business_id=p.business_id and c.id=p.customer_id)
     or exists(select 1 from cleanup_events e where e.business_id=p.business_id and e.id=p.event_id)
     or exists(select 1 from cleanup_frame_jobs j where j.business_id=p.business_id and j.id=p.frame_job_id)
     or exists(select 1 from cleanup_photo_jobs j where j.business_id=p.business_id and j.id=p.photo_job_id)
order by table_name;

-- COMMIT; -- SOLO cuando el usuario lo autorice expresamente y tras revisar los conteos.
ROLLBACK;

