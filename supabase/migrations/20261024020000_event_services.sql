-- SERVICIOS-01: event offers, rate lists and a divisible LED panel pool.
create table public.event_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  kind text not null check(kind in ('fabric_screen','led_screen','photo_booth','magic_mirror','spin_360')),
  name text not null check(length(btrim(name))>0),
  width_mm integer check(width_mm is null or width_mm>0),
  height_mm integer check(height_mm is null or height_mm>0),
  projection text check(projection is null or projection in ('front','rear')),
  with_projector boolean not null default false,
  primary_resource_id uuid,
  projector_resource_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,primary_resource_id) references public.resources(business_id,id) on delete restrict,
  foreign key(business_id,projector_resource_id) references public.resources(business_id,id) on delete restrict,
  check((width_mm is null)=(height_mm is null)),
  check(kind='fabric_screen' or (projection is null and not with_projector and projector_resource_id is null)),
  check(kind<>'fabric_screen' or (width_mm is not null and projection is not null))
);
create table public.event_offer_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  offer_id uuid not null,
  price_list_id uuid not null,
  -- LED uses cents/m²; all other families use a fixed service price.
  amount_cents bigint not null check(amount_cents>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),unique(business_id,offer_id,price_list_id),
  foreign key(business_id,offer_id) references public.event_offers(business_id,id) on delete restrict,
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict
);

create table public.led_panel_pools (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete restrict,
  total_panels integer not null check(total_panels>0),
  panel_area_mm2 integer not null check(panel_area_mm2>0),
  pixels_per_panel integer not null check(pixels_per_panel>0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.led_presets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check(length(btrim(name))>0),
  width_mm integer not null check(width_mm>0),
  height_mm integer not null check(height_mm>0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),unique(business_id,width_mm,height_mm)
);
create table public.led_controllers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  resource_id uuid not null,
  max_pixels integer check(max_pixels is null or max_pixels>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,resource_id),
  foreign key(business_id,resource_id) references public.resources(business_id,id) on delete restrict
);
create table public.led_panel_reservations (
  id uuid primary key,
  business_id uuid not null,
  event_id uuid not null,
  event_service_item_id uuid not null,
  controller_resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>starts_at),
  panels integer not null check(panels>0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,event_id) references public.events(business_id,id) on delete restrict,
  foreign key(business_id,controller_resource_id) references public.led_controllers(business_id,resource_id) on delete restrict,
  foreign key(business_id,event_service_item_id) references public.event_service_items(business_id,id) on delete restrict
);
create index led_panel_reservations_time_idx on public.led_panel_reservations(business_id,starts_at,ends_at,id);
create index led_panel_reservations_sync_idx on public.led_panel_reservations(business_id,updated_at,id);
alter table public.event_service_items add column price_list_id uuid;
alter table public.event_service_items add column config_snapshot jsonb;
alter table public.event_service_items add constraint event_service_price_list_fk
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict;
grant update(price_list_id,config_snapshot) on public.event_service_items to authenticated;

create trigger event_offers_version before insert or update on public.event_offers for each row execute function private.event_next_version();
create trigger event_offer_rates_version before insert or update on public.event_offer_rates for each row execute function private.event_next_version();
create trigger led_panel_pools_version before insert or update on public.led_panel_pools for each row execute function private.event_next_version();
create trigger led_presets_version before insert or update on public.led_presets for each row execute function private.event_next_version();
create trigger led_controllers_version before insert or update on public.led_controllers for each row execute function private.event_next_version();
create trigger led_panel_reservations_version before insert or update on public.led_panel_reservations for each row execute function private.event_next_version();

-- Known CentroColor facts: 12 m² / (6 m² / 12 panels) = 24 panels, each 0.5 m².
insert into public.led_panel_pools(business_id,total_panels,panel_area_mm2,pixels_per_panel)
select id,24,500000,32768 from public.businesses where slug='centrocolor';
insert into public.led_presets(business_id,name,width_mm,height_mm)
select b.id,p.name,p.width_mm,p.height_mm from public.businesses b cross join (values
  ('2 × 1,5 m',2000,1500),('3 × 2 m',3000,2000),
  ('4 × 2 m',4000,2000),('4 × 3 m',4000,3000)) p(name,width_mm,height_mm)
where b.slug='centrocolor';

-- Seed physical resources only when none with the same name exists; leave Nova capacity unknown.
insert into public.resources(id,business_id,name,description)
select gen_random_uuid(),b.id,n.name,n.description from public.businesses b cross join (values
  ('Nova VX600','Controlador LED'),('TB20 Plus','Controlador LED'),
  ('Cabina de fotos','Equipo de alquiler'),('Espejo mágico','Equipo de alquiler'),
  ('Giro 360','Equipo de alquiler')) n(name,description)
where b.slug='centrocolor' and not exists(select 1 from public.resources r
  where r.business_id=b.id and lower(r.name)=lower(n.name));
insert into public.led_controllers(business_id,resource_id,max_pixels)
select r.business_id,r.id,case when lower(r.name)='tb20 plus' then 650000 end
from public.resources r join public.businesses b on b.id=r.business_id
where b.slug='centrocolor' and lower(r.name) in ('nova vx600','tb20 plus')
on conflict(business_id,resource_id) do nothing;

insert into public.event_offers(business_id,kind,name,primary_resource_id)
select r.business_id,v.kind,v.name,r.id from (values
  ('photo_booth','Cabina de fotos'),('magic_mirror','Espejo mágico'),('spin_360','Giro 360')
) v(kind,name) join public.resources r on lower(r.name)=lower(v.name)
join public.businesses b on b.id=r.business_id and b.slug='centrocolor';
insert into public.event_offers(business_id,kind,name)
select id,'led_screen','Pantalla LED' from public.businesses where slug='centrocolor';
-- Screen fabric sizes, projector assignments and all event tariffs remain unconfigured.

create function private.check_led_pool_capacity(p_business_id uuid,p_event_id uuid,
  p_reservation_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_panels integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_total integer; v_reserved integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':LED_POOL',0));
  select total_panels into v_total from public.led_panel_pools
    where business_id=p_business_id and is_active for update;
  if v_total is null then raise exception using errcode='23514',message='LED_POOL_NOT_CONFIGURED'; end if;
  with overlapping as (
    select rr.starts_at,rr.ends_at,rr.panels from public.led_panel_reservations rr
    join public.events e on e.business_id=rr.business_id and e.id=rr.event_id
    where rr.business_id=p_business_id and rr.id<>p_reservation_id and rr.is_active
      and (e.status in ('reserved','completed') or rr.event_id=p_event_id)
      and rr.starts_at<p_ends_at and rr.ends_at>p_starts_at
  ), checkpoints as (
    select p_starts_at at_time union select starts_at from overlapping
  )
  select coalesce(max((select coalesce(sum(o.panels),0) from overlapping o
    where o.starts_at<=c.at_time and o.ends_at>c.at_time)),0)
  into v_reserved from checkpoints c;
  if v_reserved+p_panels>v_total then
    raise exception using errcode='23P01',message='LED_POOL_CAPACITY_CONFLICT';
  end if;
end;
$$;
revoke all on function private.check_led_pool_capacity(uuid,uuid,uuid,timestamptz,timestamptz,integer)
  from public,anon,authenticated;

create function private.guard_led_panel_reservation() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_status text; v_pixels integer;
begin
  if not exists(select 1 from public.event_service_items i
    where i.business_id=new.business_id and i.id=new.event_service_item_id and i.event_id=new.event_id
      and i.is_active and i.config_snapshot->>'kind'='led_screen') then
    raise exception using errcode='23514',message='LED_SERVICE_ITEM_REQUIRED';
  end if;
  if not new.is_active then return new; end if;
  select e.status into v_status from public.events e where e.business_id=new.business_id and e.id=new.event_id;
  if v_status not in ('reserved','completed') then return new; end if;
  perform private.check_led_pool_capacity(new.business_id,new.event_id,new.id,new.starts_at,new.ends_at,new.panels);
  select new.panels*p.pixels_per_panel into v_pixels from public.led_panel_pools p where p.business_id=new.business_id;
  if not exists(select 1 from public.resource_reservations rr
    join public.led_controllers c on c.business_id=rr.business_id and c.resource_id=rr.resource_id
    join public.resources r on r.business_id=c.business_id and r.id=c.resource_id
    where rr.business_id=new.business_id and rr.event_id=new.event_id and rr.is_active
      and rr.resource_id=new.controller_resource_id
      and rr.starts_at<=new.starts_at and rr.ends_at>=new.ends_at
      and r.is_active and c.max_pixels>=v_pixels) then
    raise exception using errcode='23514',message='LED_CONTROLLER_REQUIRED';
  end if;
  if exists(select 1 from public.led_panel_reservations rr
    where rr.business_id=new.business_id and rr.id<>new.id and rr.is_active
      and rr.controller_resource_id=new.controller_resource_id
      and rr.starts_at<new.ends_at and rr.ends_at>new.starts_at
      and (rr.event_id=new.event_id or exists(select 1 from public.events e
        where e.business_id=rr.business_id and e.id=rr.event_id and e.status in ('reserved','completed')))) then
    raise exception using errcode='23P01',message='LED_CONTROLLER_CONFLICT';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_led_panel_reservation() from public,anon,authenticated;
create trigger led_panel_reservation_guard before insert or update of event_id,event_service_item_id,starts_at,ends_at,panels,is_active,controller_resource_id
on public.led_panel_reservations for each row execute function private.guard_led_panel_reservation();

create function private.guard_event_led_pool() returns trigger
language plpgsql security definer set search_path='' as $$
declare own record; v_pixels integer;
begin
  if new.status not in ('reserved','completed') then return new; end if;
  if tg_op='UPDATE' then
    if old.status in ('reserved','completed') then return new; end if;
  end if;
  if exists(select 1 from public.event_service_items i where i.business_id=new.business_id
    and i.event_id=new.id and i.is_active and i.config_snapshot->>'kind'='led_screen'
    and not exists(select 1 from public.led_panel_reservations rr where rr.business_id=i.business_id
      and rr.event_id=i.event_id and rr.event_service_item_id=i.id and rr.is_active)) then
    raise exception using errcode='23514',message='LED_PANEL_RESERVATION_REQUIRED';
  end if;
  for own in select * from public.led_panel_reservations rr
    where rr.business_id=new.business_id and rr.event_id=new.id and rr.is_active order by rr.id loop
    perform private.check_led_pool_capacity(own.business_id,own.event_id,own.id,
      own.starts_at,own.ends_at,own.panels);
    select own.panels*p.pixels_per_panel into v_pixels from public.led_panel_pools p
      where p.business_id=own.business_id;
    if not exists(select 1 from public.resource_reservations rr
      join public.led_controllers c on c.business_id=rr.business_id and c.resource_id=rr.resource_id
      join public.resources r on r.business_id=c.business_id and r.id=c.resource_id
      where rr.business_id=own.business_id and rr.event_id=own.event_id and rr.is_active
        and rr.resource_id=own.controller_resource_id
        and rr.starts_at<=own.starts_at and rr.ends_at>=own.ends_at
        and r.is_active and c.max_pixels>=v_pixels) then
      raise exception using errcode='23514',message='LED_CONTROLLER_REQUIRED';
    end if;
    if exists(select 1 from public.led_panel_reservations rr
      where rr.business_id=own.business_id and rr.id<>own.id and rr.is_active
        and rr.controller_resource_id=own.controller_resource_id
        and rr.starts_at<own.ends_at and rr.ends_at>own.starts_at
        and (rr.event_id=own.event_id or exists(select 1 from public.events e
          where e.business_id=rr.business_id and e.id=rr.event_id and e.status in ('reserved','completed')))) then
      raise exception using errcode='23P01',message='LED_CONTROLLER_CONFLICT';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_event_led_pool() from public,anon,authenticated;
create trigger event_led_pool_guard before insert or update of status on public.events
for each row execute function private.guard_event_led_pool();

create function private.guard_led_pool_configuration() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_peak integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.business_id::text||':LED_POOL',0));
  with blocking as (
    select rr.starts_at,rr.ends_at,rr.panels from public.led_panel_reservations rr
    join public.events e on e.business_id=rr.business_id and e.id=rr.event_id
    where rr.business_id=new.business_id and rr.is_active and e.status in ('reserved','completed')
  ), checkpoints as (select distinct starts_at at_time from blocking)
  select coalesce(max((select coalesce(sum(b.panels),0) from blocking b
    where b.starts_at<=c.at_time and b.ends_at>c.at_time)),0)
    into v_peak from checkpoints c;
  if v_peak>new.total_panels or (v_peak>0 and not new.is_active) then
    raise exception using errcode='23514',message='LED_POOL_BELOW_RESERVED_CAPACITY';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_led_pool_configuration() from public,anon,authenticated;
create trigger led_pool_configuration_guard before update of total_panels,is_active on public.led_panel_pools
for each row execute function private.guard_led_pool_configuration();

create function private.guard_led_controller_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.led_panel_reservations rr
    join public.events e on e.business_id=rr.business_id and e.id=rr.event_id
    join public.led_panel_pools p on p.business_id=rr.business_id
    where rr.business_id=new.business_id and rr.controller_resource_id=new.resource_id
      and rr.is_active and e.status in ('reserved','completed')
      and (new.max_pixels is null or rr.panels*p.pixels_per_panel>new.max_pixels)) then
    raise exception using errcode='23514',message='LED_CONTROLLER_BELOW_RESERVED_PIXELS';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_led_controller_capacity() from public,anon,authenticated;
create trigger led_controller_capacity_guard before update of max_pixels on public.led_controllers
for each row execute function private.guard_led_controller_capacity();

do $$ declare table_name text; begin
  foreach table_name in array array['event_offers','event_offer_rates','led_panel_pools','led_presets','led_controllers','led_panel_reservations'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_active_membership(business_id))',table_name||'_read',table_name);
    execute format('revoke all on public.%I from anon,authenticated',table_name);
    execute format('grant select,insert,update on public.%I to authenticated',table_name);
    if table_name='led_panel_reservations' then
      execute format('create policy %I on public.%I for insert to authenticated with check(private.has_active_membership(business_id))',table_name||'_insert',table_name);
      execute format('create policy %I on public.%I for update to authenticated using(private.has_active_membership(business_id)) with check(private.has_active_membership(business_id))',table_name||'_update',table_name);
    else
      execute format('create policy %I on public.%I for all to authenticated using(exists(select 1 from public.business_memberships m where m.business_id=%I.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in (''owner'',''admin''))) with check(exists(select 1 from public.business_memberships m where m.business_id=%I.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in (''owner'',''admin'')))',table_name||'_admin',table_name,table_name,table_name);
    end if;
  end loop;
end $$;
