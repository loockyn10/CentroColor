-- SERVICIOS-01: per-business price lists and domain-specific tariffs.
-- Existing prices are carried into the PUBLIC glossy 1+ tier; no new lab price is invented.
create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check(length(btrim(name)) > 0),
  kind text not null check(kind in ('public','professional','custom')),
  is_default boolean not null default false,
  is_active boolean not null default true,
  check((kind='public')=is_default and (not is_default or is_active)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id)
);
create unique index price_lists_default_idx on public.price_lists(business_id) where is_default;
create unique index price_lists_name_idx on public.price_lists(business_id,lower(name));
create trigger price_lists_version before insert or update on public.price_lists
for each row execute function private.photo_next_version();

-- Known laboratory dimensions are catalog entries even when no price was supplied.
-- A zero legacy price is never promoted into a sellable tier.
insert into public.photo_services(id,business_id,name,service_type,width_mm,height_mm,
  default_unit_price_cents,is_active,workflow_route,requires_customer_files,
  is_public,public_name,public_sort_order,public_order_enabled)
select gen_random_uuid(),b.id,'Impresión '||v.label,'print',v.width_mm,v.height_mm,
  0,true,'lab',true,true,v.label,v.sort_order,false
from public.businesses b cross join (values
  ('10×15',100,150,10),('13×18',130,180,20),('15×21',150,210,30),('20×30',200,300,40)
) v(label,width_mm,height_mm,sort_order)
where b.slug='centrocolor' and not exists(select 1 from public.photo_services s
  where s.business_id=b.id and s.workflow_route='lab'
    and s.width_mm=v.width_mm and s.height_mm=v.height_mm);

insert into public.price_lists(business_id,name,kind,is_default)
select id,'Público','public',true from public.businesses;
insert into public.price_lists(business_id,name,kind,is_default)
select id,'Profesional','professional',false from public.businesses;

create function private.create_business_price_lists() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.price_lists(business_id,name,kind,is_default)
  values(new.id,'Público','public',true),(new.id,'Profesional','professional',false);
  return new;
end;
$$;
revoke all on function private.create_business_price_lists() from public,anon,authenticated;
create trigger business_price_lists after insert on public.businesses
for each row execute function private.create_business_price_lists();

alter table public.customers add column price_list_id uuid;
alter table public.customers add constraint customer_price_list_business_fk
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict;
create index customers_price_list_idx on public.customers(business_id,price_list_id);

create function private.guard_customer_price_list() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.price_list_id is distinct from old.price_list_id
     and not exists(select 1 from public.business_memberships m
       where m.business_id=new.business_id and m.user_id=(select auth.uid())
       and m.is_active and m.role in ('owner','admin')) then
    raise exception using errcode='42501',message='Sólo owner/admin puede asignar listas de precios.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_customer_price_list() from public,anon,authenticated;
create trigger customer_price_list_admin before update of price_list_id on public.customers
for each row execute function private.guard_customer_price_list();
grant update(price_list_id) on public.customers to authenticated;

create table public.lab_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  photo_service_id uuid not null,
  channel text not null check(channel in ('laboratory','kiosk')),
  paper text not null check(paper in ('glossy','matte')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,photo_service_id,channel,paper),
  foreign key(business_id,photo_service_id) references public.photo_services(business_id,id) on delete restrict
);
create trigger lab_variants_version before insert or update on public.lab_variants
for each row execute function private.photo_next_version();
-- Only existing public lab print services with an actual configured price are migrated.
insert into public.lab_variants(business_id,photo_service_id,channel,paper)
select business_id,id,'laboratory','glossy' from public.photo_services
where workflow_route='lab' and service_type in ('print','enlargement') and default_unit_price_cents>0;
insert into public.lab_variants(business_id,photo_service_id,channel,paper,is_active)
select s.business_id,s.id,'laboratory',p.paper,
  p.paper='glossy' and s.default_unit_price_cents>0 and s.is_active
from public.photo_services s join public.businesses b on b.id=s.business_id
cross join (values('glossy'),('matte')) p(paper)
where b.slug='centrocolor' and s.workflow_route='lab'
  and s.service_type in ('print','enlargement')
  and (s.width_mm,s.height_mm) in ((100,150),(130,180),(150,210),(200,300))
on conflict(business_id,photo_service_id,channel,paper) do nothing;

create table public.lab_price_tiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  variant_id uuid not null,
  price_list_id uuid not null,
  min_quantity integer not null check(min_quantity>0),
  max_quantity integer check(max_quantity is null or max_quantity>=min_quantity),
  unit_price_cents bigint not null check(unit_price_cents>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,variant_id,price_list_id,min_quantity),
  foreign key(business_id,variant_id) references public.lab_variants(business_id,id) on delete restrict,
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict
);
create trigger lab_price_tiers_version before insert or update on public.lab_price_tiers
for each row execute function private.photo_next_version();
alter table public.photo_job_items add column lab_variant_id uuid;
alter table public.photo_job_items add column price_list_id uuid;
alter table public.photo_job_items add constraint photo_item_lab_variant_business_fk
  foreign key(business_id,lab_variant_id) references public.lab_variants(business_id,id) on delete restrict;
alter table public.photo_job_items add constraint photo_item_price_list_business_fk
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict;
grant update(lab_variant_id,price_list_id) on public.photo_job_items to authenticated;
insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,unit_price_cents)
select v.business_id,v.id,p.id,1,s.default_unit_price_cents
from public.lab_variants v join public.photo_services s
  on s.business_id=v.business_id and s.id=v.photo_service_id
join public.price_lists p on p.business_id=v.business_id and p.is_default
where v.channel='laboratory' and v.paper='glossy' and s.default_unit_price_cents>0;

create function private.bootstrap_lab_service() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_variant_id uuid;
declare v_list_id uuid;
begin
  if new.workflow_route <> 'lab' or new.service_type not in ('print','enlargement')
     or new.default_unit_price_cents <= 0 then return new; end if;
  select id into v_list_id from public.price_lists
    where business_id=new.business_id and is_default;
  if v_list_id is null then return new; end if;
  insert into public.lab_variants(business_id,photo_service_id,channel,paper)
  values(new.business_id,new.id,'laboratory','glossy')
  on conflict(business_id,photo_service_id,channel,paper) do update set is_active=true
  returning id into v_variant_id;
  insert into public.lab_price_tiers(business_id,variant_id,price_list_id,min_quantity,unit_price_cents)
  values(new.business_id,v_variant_id,v_list_id,1,new.default_unit_price_cents)
  on conflict(business_id,variant_id,price_list_id,min_quantity) do nothing;
  return new;
end;
$$;
revoke all on function private.bootstrap_lab_service() from public,anon,authenticated;
create trigger bootstrap_lab_service after insert on public.photo_services
for each row execute function private.bootstrap_lab_service();

-- Adjacent tiers are allowed. Intersecting ranges for the same variant/list are not.
create function private.guard_lab_tiers() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.business_id::text || ':' || new.variant_id::text || ':' || new.price_list_id::text,0));
  if exists(select 1 from public.lab_price_tiers t where t.business_id=new.business_id
    and t.variant_id=new.variant_id and t.price_list_id=new.price_list_id and t.id<>new.id
    and t.min_quantity<=coalesce(new.max_quantity,2147483647)
    and new.min_quantity<=coalesce(t.max_quantity,2147483647)) then
    raise exception using errcode='23P01',message='LAB_TIER_OVERLAP';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_lab_tiers() from public,anon,authenticated;
create trigger lab_tiers_no_overlap before insert or update of variant_id,price_list_id,min_quantity,max_quantity
on public.lab_price_tiers for each row execute function private.guard_lab_tiers();

create table public.plotter_materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  code text not null check(code in ('canvas','photo_paper','plain_paper','adhesive_vinyl','front_banner','blackout_banner')),
  name text not null check(length(btrim(name))>0),
  roll_width_mm integer check(roll_width_mm is null or roll_width_mm>0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,code)
);
create trigger plotter_materials_version before insert or update on public.plotter_materials
for each row execute function private.photo_next_version();
insert into public.plotter_materials(business_id,code,name)
select b.id,v.code,v.name from public.businesses b cross join (values
  ('canvas','Canvas'),('photo_paper','Papel Foto'),('plain_paper','Papel común'),
  ('adhesive_vinyl','Vinilo adhesivo'),('front_banner','Lona Front'),
  ('blackout_banner','Lona Blackout')) v(code,name);

create table public.plotter_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  price_list_id uuid not null,
  code text not null check(length(btrim(code))>0),
  amount_cents bigint not null check(amount_cents>=0),
  width_mm integer check(width_mm is null or width_mm>0),
  height_mm integer check(height_mm is null or height_mm>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,price_list_id,code,width_mm,height_mm),
  check((width_mm is null)=(height_mm is null)),
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict
);
create unique index plotter_rates_unsized_idx on public.plotter_rates(business_id,price_list_id,code)
where width_mm is null;
create trigger plotter_rates_version before insert or update on public.plotter_rates
for each row execute function private.photo_next_version();

-- The supplied sheet is expressly PROFESSIONAL. Values below are integer cents.
insert into public.plotter_rates(business_id,price_list_id,code,amount_cents)
select p.business_id,p.id,r.code,r.amount_cents from public.price_lists p cross join (values
  ('canvas',5950000::bigint),('photo_paper',5800000),('plain_paper',3520000),
  ('front_banner',2550000),('blackout_banner',3600000),('adhesive_vinyl',2550000),
  ('vinyl_mdf_small',9000000),('vinyl_mdf_large',7900000),('plastic_rod',800000),
  ('banner_fold_top_up_to_1m',360000),('banner_fold_both_up_to_1m',610000),
  ('banner_fold_top_over_1m',470000),('banner_fold_both_over_1m',700000)
) r(code,amount_cents) where p.kind='professional';
insert into public.plotter_rates(business_id,price_list_id,code,amount_cents,width_mm,height_mm)
select p.business_id,p.id,'canvas_stretcher',r.amount_cents,r.width_mm,r.height_mm
from public.price_lists p cross join (values
  (200,300,1650000::bigint),(300,400,2300000),(300,450,2550000),(400,500,2900000),
  (400,600,2950000),(500,600,3450000),(500,800,3600000),(500,900,3700000)
) r(width_mm,height_mm,amount_cents) where p.kind='professional';

-- Businesses created after this migration receive the same configurable seed.
create or replace function private.create_business_price_lists() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_professional uuid;
begin
  insert into public.price_lists(business_id,name,kind,is_default)
  values(new.id,'Público','public',true);
  insert into public.price_lists(business_id,name,kind,is_default)
  values(new.id,'Profesional','professional',false) returning id into v_professional;
  insert into public.plotter_materials(business_id,code,name)
  select new.id,v.code,v.name from (values
    ('canvas','Canvas'),('photo_paper','Papel Foto'),('plain_paper','Papel común'),
    ('adhesive_vinyl','Vinilo adhesivo'),('front_banner','Lona Front'),
    ('blackout_banner','Lona Blackout')) v(code,name);
  insert into public.plotter_rates(business_id,price_list_id,code,amount_cents)
  select new.id,v_professional,r.code,r.amount_cents from (values
    ('canvas',5950000::bigint),('photo_paper',5800000),('plain_paper',3520000),
    ('front_banner',2550000),('blackout_banner',3600000),('adhesive_vinyl',2550000),
    ('vinyl_mdf_small',9000000),('vinyl_mdf_large',7900000),('plastic_rod',800000),
    ('banner_fold_top_up_to_1m',360000),('banner_fold_both_up_to_1m',610000),
    ('banner_fold_top_over_1m',470000),('banner_fold_both_over_1m',700000)
  ) r(code,amount_cents);
  insert into public.plotter_rates(business_id,price_list_id,code,amount_cents,width_mm,height_mm)
  select new.id,v_professional,'canvas_stretcher',r.amount_cents,r.width_mm,r.height_mm
  from (values
    (200,300,1650000::bigint),(300,400,2300000),(300,450,2550000),(400,500,2900000),
    (400,600,2950000),(500,600,3450000),(500,800,3600000),(500,900,3700000)
  ) r(width_mm,height_mm,amount_cents);
  return new;
end;
$$;

create table public.plotter_quotes (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid,
  price_list_id uuid not null,
  status text not null check(status in ('draft','quoted','accepted','cancelled','completed')),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  total_cents bigint not null check(total_cents>=0),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,branch_id) references public.branches(business_id,id) on delete restrict,
  foreign key(business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key(business_id,price_list_id) references public.price_lists(business_id,id) on delete restrict
);
create index plotter_quotes_business_idx on public.plotter_quotes(business_id,updated_at,id);
create trigger plotter_quotes_version before insert or update on public.plotter_quotes
for each row execute function private.photo_next_version();
create function private.guard_plotter_quote_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.snapshot is distinct from old.snapshot or new.total_cents is distinct from old.total_cents
     or new.price_list_id is distinct from old.price_list_id or new.customer_id is distinct from old.customer_id then
    raise exception using errcode='23514',message='PLOTTER_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_plotter_quote_snapshot() from public,anon,authenticated;
create trigger plotter_quote_snapshot_immutable before update on public.plotter_quotes
for each row execute function private.guard_plotter_quote_snapshot();

-- Rate/catalog editing is administrative. Members may create and read immutable snapshots.
do $$ declare table_name text; begin
  foreach table_name in array array['price_lists','lab_variants','lab_price_tiers','plotter_materials','plotter_rates','plotter_quotes'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using(private.has_active_membership(business_id))',table_name||'_read',table_name);
    execute format('revoke all on public.%I from anon,authenticated',table_name);
    execute format('grant select,insert,update on public.%I to authenticated',table_name);
    if table_name='plotter_quotes' then
      execute format('create policy %I on public.%I for insert to authenticated with check(private.has_active_membership(business_id) and created_by=(select auth.uid()))',table_name||'_insert',table_name);
      execute format('create policy %I on public.%I for update to authenticated using(private.has_active_membership(business_id)) with check(private.has_active_membership(business_id))',table_name||'_update',table_name);
    else
      execute format('create policy %I on public.%I for all to authenticated using(exists(select 1 from public.business_memberships m where m.business_id=%I.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in (''owner'',''admin''))) with check(exists(select 1 from public.business_memberships m where m.business_id=%I.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in (''owner'',''admin'')))',table_name||'_admin',table_name,table_name,table_name);
    end if;
  end loop;
end $$;

grant select on public.price_lists,public.lab_variants,public.lab_price_tiers to service_role;

-- Anonymous Edge handlers call this with service_role. It always uses the default list.
create function public.cc_public_lab_catalog(p_business_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',case when v.paper='glossy' then s.id else v.id end,
    'variant_id',v.id,'photo_service_id',s.id,
    'name',coalesce(s.public_name,s.name) || ' · ' || case v.paper when 'matte' then 'Mate' else 'Brillo' end,
    'description',s.public_description,'width_mm',s.width_mm,'height_mm',s.height_mm,
    'sort_order',s.public_sort_order,'paper',v.paper,
    'tiers',(select coalesce(jsonb_agg(jsonb_build_object('min_quantity',t.min_quantity,
      'max_quantity',t.max_quantity,'unit_price_cents',t.unit_price_cents) order by t.min_quantity),'[]'::jsonb)
      from public.lab_price_tiers t join public.price_lists p
      on p.business_id=t.business_id and p.id=t.price_list_id
      where t.business_id=v.business_id and t.variant_id=v.id and p.is_default and p.is_active)
  ) order by s.public_sort_order,s.name,v.paper),'[]'::jsonb)
  from public.lab_variants v join public.photo_services s
    on s.business_id=v.business_id and s.id=v.photo_service_id
  where v.business_id=p_business_id and v.channel='laboratory' and v.is_active
    and s.is_active and s.is_public and s.public_order_enabled;
$$;
revoke all on function public.cc_public_lab_catalog(uuid) from public,anon,authenticated;
grant execute on function public.cc_public_lab_catalog(uuid) to service_role;

-- Jobs already stored have only their existing snapshot and are never repriced.
