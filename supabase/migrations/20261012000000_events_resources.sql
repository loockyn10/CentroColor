-- Sprint 9: Events are not Appointments; Resources are not Products.
create table public.event_types (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id)
);

create table public.resources (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  description text,
  default_price_cents bigint check (default_price_cents is null or default_price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id)
);

create table public.events (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  event_type_id uuid,
  title text not null check (length(btrim(title)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  venue_name text,
  venue_address text,
  status text not null check (status in ('inquiry','quoted','reserved','completed','cancelled')),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,branch_id) references public.branches(business_id,id) on delete restrict,
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key (business_id,event_type_id) references public.event_types(business_id,id) on delete restrict
);

create table public.event_service_items (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_id uuid not null,
  source_service_id uuid,
  name text not null check (length(btrim(name)) > 0),
  description text,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  total_cents bigint not null check (total_cents >= 0 and total_cents = quantity::bigint * unit_price_cents),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,event_id) references public.events(business_id,id) on delete restrict
);

create table public.resource_reservations (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_id uuid not null,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  price_cents bigint not null check (price_cents >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,event_id) references public.events(business_id,id) on delete restrict,
  foreign key (business_id,resource_id) references public.resources(business_id,id) on delete restrict
);

create index event_types_business_active_name_idx on public.event_types(business_id,is_active desc,name,id);
create index event_types_business_updated_id_idx on public.event_types(business_id,updated_at,id);
create index resources_business_active_name_idx on public.resources(business_id,is_active desc,name,id);
create index resources_business_updated_id_idx on public.resources(business_id,updated_at,id);
create index events_business_branch_start_idx on public.events(business_id,branch_id,starts_at,id);
create index events_business_branch_status_start_idx on public.events(business_id,branch_id,status,starts_at,id);
create index events_business_customer_start_idx on public.events(business_id,customer_id,starts_at,id);
create index events_business_updated_id_idx on public.events(business_id,updated_at,id);
create index event_service_items_event_idx on public.event_service_items(business_id,event_id,is_active,id);
create index event_service_items_business_updated_id_idx on public.event_service_items(business_id,updated_at,id);
create index resource_reservations_resource_time_idx on public.resource_reservations(business_id,resource_id,starts_at,ends_at,id);
create index resource_reservations_event_idx on public.resource_reservations(business_id,event_id,is_active,id);
create index resource_reservations_business_updated_id_idx on public.resource_reservations(business_id,updated_at,id);

create table private.event_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.event_sync_clock from public,anon,authenticated;
alter table private.event_sync_clock enable row level security;

create function private.event_next_version() returns trigger
language plpgsql security definer set search_path='' as $$
declare next_version timestamptz;
begin
  insert into private.event_sync_clock as clock(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update set last_updated_at=greatest(
    pg_catalog.clock_timestamp(),clock.last_updated_at + interval '1 microsecond'
  ) returning last_updated_at into next_version;
  new.updated_at := next_version;
  return new;
end;
$$;
revoke all on function private.event_next_version() from public,anon,authenticated;
create trigger event_type_version before insert or update on public.event_types for each row execute function private.event_next_version();
create trigger resource_version before insert or update on public.resources for each row execute function private.event_next_version();
create trigger event_version before insert or update on public.events for each row execute function private.event_next_version();
create trigger event_service_item_version before insert or update on public.event_service_items for each row execute function private.event_next_version();
create trigger resource_reservation_version before insert or update on public.resource_reservations for each row execute function private.event_next_version();

-- Every path (Web and Desktop sync) is serialized by physical resource before checking.
create function private.guard_resource_reservation_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_status text;
declare conflict_id uuid;
begin
  if not new.is_active then return new; end if;
  if not exists (
    select 1 from public.resources r where r.business_id=new.business_id and r.id=new.resource_id and r.is_active
  ) then raise exception using errcode='23514', message='El recurso está inactivo o no pertenece al negocio.'; end if;
  select e.status into owner_status from public.events e
    where e.business_id=new.business_id and e.id=new.event_id;
  if owner_status not in ('reserved','completed') then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.business_id::text || ':' || new.resource_id::text,0));
  select rr.id into conflict_id
  from public.resource_reservations rr
  join public.events e on e.business_id=rr.business_id and e.id=rr.event_id
  where rr.business_id=new.business_id and rr.resource_id=new.resource_id and rr.is_active
    and rr.id<>new.id and e.status in ('reserved','completed')
    and rr.starts_at<new.ends_at and rr.ends_at>new.starts_at
  order by rr.starts_at,rr.id limit 1;
  if conflict_id is not null then
    raise exception using errcode='23P01', message='RESOURCE_RESERVATION_CONFLICT', detail=conflict_id::text;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_resource_reservation_availability() from public,anon,authenticated;
create trigger resource_reservation_availability before insert or update of resource_id,starts_at,ends_at,is_active
on public.resource_reservations for each row execute function private.guard_resource_reservation_availability();

create function private.guard_event_resource_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare own record;
declare conflict_id uuid;
begin
  if new.status not in ('reserved','completed') then
    return new;
  end if;
  if tg_op='UPDATE' then
    if old.status in ('reserved','completed') then
      return new;
    end if;
  end if;
  for own in select rr.* from public.resource_reservations rr
    where rr.business_id=new.business_id and rr.event_id=new.id and rr.is_active order by rr.resource_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.business_id::text || ':' || own.resource_id::text,0));
    select rr.id into conflict_id from public.resource_reservations rr
    join public.events e on e.business_id=rr.business_id and e.id=rr.event_id
    where rr.business_id=new.business_id and rr.resource_id=own.resource_id and rr.is_active
      and rr.id<>own.id and e.status in ('reserved','completed')
      and rr.starts_at<own.ends_at and rr.ends_at>own.starts_at
    order by rr.starts_at,rr.id limit 1;
    if conflict_id is not null then
      raise exception using errcode='23P01', message='RESOURCE_RESERVATION_CONFLICT', detail=conflict_id::text;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_event_resource_availability() from public,anon,authenticated;
create trigger event_resource_availability before insert or update of status on public.events
for each row execute function private.guard_event_resource_availability();

create function private.guard_event_creator() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and new.created_by is distinct from (select auth.uid()) then
    raise exception 'El creador del evento no coincide con el usuario autenticado.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_event_creator() from public,anon,authenticated;
create trigger event_creator before insert on public.events for each row execute function private.guard_event_creator();

alter table public.event_types enable row level security;
alter table public.resources enable row level security;
alter table public.events enable row level security;
alter table public.event_service_items enable row level security;
alter table public.resource_reservations enable row level security;

create policy event_types_member_read on public.event_types for select to authenticated using (private.has_active_membership(business_id));
create policy event_types_admin_insert on public.event_types for insert to authenticated with check (exists (
  select 1 from public.business_memberships m where m.business_id=event_types.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
));
create policy event_types_admin_update on public.event_types for update to authenticated using (exists (
  select 1 from public.business_memberships m where m.business_id=event_types.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
)) with check (exists (
  select 1 from public.business_memberships m where m.business_id=event_types.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
));
create policy resources_member_read on public.resources for select to authenticated using (private.has_active_membership(business_id));
create policy resources_admin_insert on public.resources for insert to authenticated with check (exists (
  select 1 from public.business_memberships m where m.business_id=resources.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
));
create policy resources_admin_update on public.resources for update to authenticated using (exists (
  select 1 from public.business_memberships m where m.business_id=resources.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
)) with check (exists (
  select 1 from public.business_memberships m where m.business_id=resources.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
));
create policy events_member_read on public.events for select to authenticated using (private.has_active_membership(business_id));
create policy events_member_insert on public.events for insert to authenticated with check (private.has_active_membership(business_id) and created_by=(select auth.uid()));
create policy events_member_update on public.events for update to authenticated using (private.has_active_membership(business_id)) with check (private.has_active_membership(business_id));
create policy event_service_items_member_read on public.event_service_items for select to authenticated using (private.has_active_membership(business_id));
create policy event_service_items_member_insert on public.event_service_items for insert to authenticated with check (private.has_active_membership(business_id));
create policy event_service_items_member_update on public.event_service_items for update to authenticated using (private.has_active_membership(business_id)) with check (private.has_active_membership(business_id));
create policy resource_reservations_member_read on public.resource_reservations for select to authenticated using (private.has_active_membership(business_id));
create policy resource_reservations_member_insert on public.resource_reservations for insert to authenticated with check (private.has_active_membership(business_id));
create policy resource_reservations_member_update on public.resource_reservations for update to authenticated using (private.has_active_membership(business_id)) with check (private.has_active_membership(business_id));

revoke all on public.event_types,public.resources,public.events,public.event_service_items,public.resource_reservations from anon,authenticated;
grant select,insert on public.event_types,public.resources,public.events,public.event_service_items,public.resource_reservations to authenticated;
grant update(name,is_active) on public.event_types to authenticated;
grant update(name,description,default_price_cents,is_active) on public.resources to authenticated;
grant update(customer_id,event_type_id,title,starts_at,ends_at,venue_name,venue_address,status,notes) on public.events to authenticated;
grant update(source_service_id,name,description,quantity,unit_price_cents,total_cents,is_active) on public.event_service_items to authenticated;
grant update(resource_id,starts_at,ends_at,price_cents,notes,is_active) on public.resource_reservations to authenticated;
