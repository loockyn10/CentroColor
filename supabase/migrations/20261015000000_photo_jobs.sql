-- Sprint 11: configurable photographic services and offline-first production jobs.
create table public.photo_services (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  code text,
  name text not null check(length(btrim(name)) > 0),
  service_type text not null check(service_type in('print','enlargement','id_photo','editing','restoration','scanning','album','other')),
  width_mm integer check(width_mm is null or width_mm > 0),
  height_mm integer check(height_mm is null or height_mm > 0),
  default_unit_price_cents bigint not null check(default_unit_price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  check((width_mm is null) = (height_mm is null))
);
create table public.photo_jobs (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  status text not null check(status in('received','in_progress','ready','delivered','cancelled')),
  priority text not null default 'normal' check(priority in('normal','urgent')),
  promised_at timestamptz,
  notes text,
  source_appointment_id uuid,
  source_event_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,branch_id) references public.branches(business_id,id),
  foreign key(business_id,customer_id) references public.customers(business_id,id),
  foreign key(business_id,source_appointment_id) references public.appointments(business_id,id),
  foreign key(business_id,source_event_id) references public.events(business_id,id)
);
create table public.photo_job_items (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  photo_job_id uuid not null,
  photo_service_id uuid,
  service_name_snapshot text not null check(length(btrim(service_name_snapshot)) > 0),
  quantity integer not null check(quantity > 0),
  unit_price_cents bigint not null check(unit_price_cents >= 0),
  total_cents bigint not null check(total_cents = quantity * unit_price_cents),
  notes text,
  width_mm integer check(width_mm is null or width_mm > 0),
  height_mm integer check(height_mm is null or height_mm > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,photo_job_id) references public.photo_jobs(business_id,id),
  foreign key(business_id,photo_service_id) references public.photo_services(business_id,id),
  check((width_mm is null) = (height_mm is null))
);
create index photo_services_active_idx on public.photo_services(business_id,is_active,name);
create index photo_services_sync_idx on public.photo_services(business_id,updated_at,id);
create index photo_jobs_queue_idx on public.photo_jobs(business_id,branch_id,status,priority,promised_at,created_at);
create index photo_jobs_customer_idx on public.photo_jobs(business_id,customer_id,created_at desc);
create index photo_jobs_sync_idx on public.photo_jobs(business_id,updated_at,id);
create index photo_job_items_job_idx on public.photo_job_items(business_id,photo_job_id,is_active,created_at);
create index photo_job_items_sync_idx on public.photo_job_items(business_id,updated_at,id);

create table private.photo_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.photo_sync_clock from public,anon,authenticated;
create function private.photo_next_version() returns trigger
language plpgsql security definer set search_path=''
as $$
declare v timestamptz;
begin
  insert into private.photo_sync_clock as c(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update
    set last_updated_at=greatest(pg_catalog.clock_timestamp(),c.last_updated_at+interval '1 microsecond')
  returning last_updated_at into v;
  new.updated_at:=v;
  return new;
end;
$$;
revoke all on function private.photo_next_version() from public,anon,authenticated;
create trigger photo_service_version before insert or update on public.photo_services for each row execute function private.photo_next_version();
create trigger photo_job_version before insert or update on public.photo_jobs for each row execute function private.photo_next_version();
create trigger photo_job_item_version before insert or update on public.photo_job_items for each row execute function private.photo_next_version();

create function private.photo_guard_immutable_identity() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.id<>old.id or new.business_id<>old.business_id or new.created_at<>old.created_at then
    raise exception 'Photo identity fields are immutable';
  end if;
  if tg_table_name='photo_jobs' and (new.branch_id<>old.branch_id or new.created_by<>old.created_by) then
    raise exception 'PhotoJob structural fields are immutable';
  end if;
  if tg_table_name='photo_job_items' and new.photo_job_id<>old.photo_job_id then
    raise exception 'PhotoJobItem parent is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.photo_guard_immutable_identity() from public,anon,authenticated;
create trigger photo_service_identity before update on public.photo_services for each row execute function private.photo_guard_immutable_identity();
create trigger photo_job_identity before update on public.photo_jobs for each row execute function private.photo_guard_immutable_identity();
create trigger photo_job_item_identity before update on public.photo_job_items for each row execute function private.photo_guard_immutable_identity();

alter table public.photo_services enable row level security;
alter table public.photo_jobs enable row level security;
alter table public.photo_job_items enable row level security;
create policy photo_services_read on public.photo_services for select to authenticated using(private.has_active_membership(business_id));
create policy photo_services_admin on public.photo_services for all to authenticated
using(exists(select 1 from public.business_memberships m where m.business_id=photo_services.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in('owner','admin')))
with check(exists(select 1 from public.business_memberships m where m.business_id=photo_services.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in('owner','admin')));
create policy photo_jobs_read on public.photo_jobs for select to authenticated using(private.has_active_membership(business_id));
create policy photo_jobs_insert on public.photo_jobs for insert to authenticated
with check(private.has_active_membership(business_id) and created_by=(select auth.uid()));
create policy photo_jobs_update on public.photo_jobs for update to authenticated
using(private.has_active_membership(business_id)) with check(private.has_active_membership(business_id));
create policy photo_job_items_member on public.photo_job_items for all to authenticated
using(private.has_active_membership(business_id))
with check(private.has_active_membership(business_id));
revoke all on public.photo_services,public.photo_jobs,public.photo_job_items from anon,authenticated;
grant select,insert,update on public.photo_services,public.photo_jobs,public.photo_job_items to authenticated;
