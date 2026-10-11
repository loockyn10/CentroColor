-- Agenda is distinct from future Events and resource reservations.
alter table public.customers
  add constraint customers_business_id_id_appointment_unique unique (business_id,id);

create table public.appointment_types (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  default_duration_minutes integer not null check (default_duration_minutes > 0 and default_duration_minutes <= 1440),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id)
);

create table public.appointments (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  appointment_type_id uuid,
  title text not null check (length(btrim(title)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null check (status in ('scheduled','completed','cancelled','no_show')),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,branch_id) references public.branches(business_id,id) on delete restrict,
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key (business_id,appointment_type_id) references public.appointment_types(business_id,id) on delete restrict
);

create index appointment_types_business_active_name_idx
  on public.appointment_types(business_id,is_active desc,name,id);
create index appointment_types_business_updated_id_idx
  on public.appointment_types(business_id,updated_at,id);
create index appointments_business_branch_start_idx
  on public.appointments(business_id,branch_id,starts_at,id);
create index appointments_business_branch_status_start_idx
  on public.appointments(business_id,branch_id,status,starts_at,id);
create index appointments_business_customer_start_idx
  on public.appointments(business_id,customer_id,starts_at,id);
create index appointments_business_updated_id_idx
  on public.appointments(business_id,updated_at,id);

create table private.appointment_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.appointment_sync_clock from public,anon,authenticated;
alter table private.appointment_sync_clock enable row level security;

create function private.appointment_next_version() returns trigger
language plpgsql security definer set search_path='' as $$
declare next_version timestamptz;
begin
  insert into private.appointment_sync_clock as clock(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update set last_updated_at=greatest(
    pg_catalog.clock_timestamp(),clock.last_updated_at + interval '1 microsecond'
  ) returning last_updated_at into next_version;
  new.updated_at := next_version;
  return new;
end;
$$;
revoke all on function private.appointment_next_version() from public,anon,authenticated;
create trigger appointment_type_version before insert or update on public.appointment_types
for each row execute function private.appointment_next_version();
create trigger appointment_version before insert or update on public.appointments
for each row execute function private.appointment_next_version();

create function private.guard_appointment_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and new.created_by is distinct from (select auth.uid()) then
    raise exception 'El creador del turno no coincide con el usuario autenticado.';
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status
    and (new.status='cancelled' or old.status='cancelled') and not exists (
    select 1 from public.business_memberships m where m.business_id=new.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  ) then
    raise exception 'Solo owner/admin puede cancelar turnos.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_appointment_status() from public,anon,authenticated;
create trigger appointment_status_permissions before insert or update on public.appointments
for each row execute function private.guard_appointment_status();

alter table public.appointment_types enable row level security;
alter table public.appointments enable row level security;
create policy appointment_types_member_read on public.appointment_types
  for select to authenticated using (private.has_active_membership(business_id));
create policy appointment_types_admin_insert on public.appointment_types
  for insert to authenticated with check (exists (
    select 1 from public.business_memberships m where m.business_id=appointment_types.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  ));
create policy appointment_types_admin_update on public.appointment_types
  for update to authenticated using (exists (
    select 1 from public.business_memberships m where m.business_id=appointment_types.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  )) with check (exists (
    select 1 from public.business_memberships m where m.business_id=appointment_types.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  ));
create policy appointments_member_read on public.appointments
  for select to authenticated using (private.has_active_membership(business_id));
create policy appointments_member_insert on public.appointments
  for insert to authenticated with check (
    private.has_active_membership(business_id) and created_by=(select auth.uid())
  );
create policy appointments_member_update on public.appointments
  for update to authenticated using (private.has_active_membership(business_id))
  with check (private.has_active_membership(business_id));

revoke all on public.appointment_types,public.appointments from anon,authenticated;
grant select,insert on public.appointment_types,public.appointments to authenticated;
grant update(name,default_duration_minutes,is_active) on public.appointment_types to authenticated;
grant update(customer_id,appointment_type_id,title,starts_at,ends_at,status,notes)
  on public.appointments to authenticated;
