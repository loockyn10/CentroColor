-- Stock is a per-branch immutable ledger. Existing products/sales opt out.
alter table public.products add column tracks_inventory boolean not null default false;
alter table public.sale_items add column tracks_inventory boolean not null default false;
alter table public.sale_items add constraint sale_items_business_id_unique unique (business_id,id);

create table public.inventory_balances (
  business_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (business_id,branch_id,product_id),
  foreign key (business_id,branch_id) references public.branches(business_id,id) on delete restrict,
  foreign key (business_id,product_id) references public.products(business_id,id) on delete restrict
);
create table public.stock_movements (
  id uuid primary key,
  business_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  movement_type text not null check (movement_type in ('initial','entry','adjustment','sale')),
  quantity_delta integer not null check (quantity_delta <> 0),
  sale_id uuid,
  sale_item_id uuid,
  note text,
  created_by uuid not null references auth.users(id) on delete restrict,
  device_id uuid,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id,id),
  unique (sale_item_id),
  check ((movement_type='sale' and sale_id is not null and sale_item_id is not null and quantity_delta < 0)
    or (movement_type <> 'sale' and sale_id is null and sale_item_id is null)),
  check (movement_type <> 'entry' or quantity_delta > 0),
  foreign key (business_id,branch_id) references public.branches(business_id,id) on delete restrict,
  foreign key (business_id,product_id) references public.products(business_id,id) on delete restrict,
  foreign key (business_id,sale_id) references public.sales(business_id,id) on delete restrict,
  foreign key (business_id,sale_item_id) references public.sale_items(business_id,id) on delete restrict,
  foreign key (business_id,device_id) references public.devices(business_id,id) on delete restrict
);
create unique index stock_initial_once_idx on public.stock_movements(business_id,branch_id,product_id) where movement_type='initial';
create index stock_movements_pull_idx on public.stock_movements(business_id,received_at,id);
create index stock_movements_product_idx on public.stock_movements(business_id,branch_id,product_id,occurred_at desc,id desc);

create function private.stock_received_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare next_version timestamptz;
begin
  insert into private.pos_sync_clock as clock(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update set last_updated_at=greatest(
    pg_catalog.clock_timestamp(),clock.last_updated_at + interval '1 microsecond'
  ) returning last_updated_at into next_version;
  new.received_at := next_version;
  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;
revoke all on function private.stock_received_version() from public,anon,authenticated;
create trigger stock_received_version before insert on public.stock_movements
for each row execute function private.stock_received_version();

create function private.apply_stock_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory_balances(business_id,branch_id,product_id,quantity,updated_at)
  values(new.business_id,new.branch_id,new.product_id,new.quantity_delta,new.received_at)
  on conflict(business_id,branch_id,product_id) do update set
    quantity=public.inventory_balances.quantity+excluded.quantity,updated_at=excluded.updated_at;
  return new;
end;
$$;
revoke all on function private.apply_stock_balance() from public,anon,authenticated;
create trigger stock_balance_after_insert after insert on public.stock_movements
for each row execute function private.apply_stock_balance();

create function private.stock_sale_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sale_row public.sales;
begin
  if not new.tracks_inventory then return new; end if;
  select * into strict sale_row from public.sales where id=new.sale_id and business_id=new.business_id;
  insert into public.stock_movements(id,business_id,branch_id,product_id,movement_type,quantity_delta,
    sale_id,sale_item_id,created_by,device_id,occurred_at)
  values(new.id,new.business_id,sale_row.branch_id,new.product_id,'sale',-new.quantity,
    sale_row.id,new.id,sale_row.created_by,sale_row.device_id,sale_row.created_at)
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.stock_sale_item() from public,anon,authenticated;
create trigger sale_item_stock after insert on public.sale_items
for each row execute function private.stock_sale_item();

create function private.guard_inventory_tracking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tracks_inventory is distinct from old.tracks_inventory and not exists (
    select 1 from public.business_memberships m where m.business_id=new.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  ) then raise exception 'Solo owner/admin puede cambiar el control de stock.'; end if;
  return new;
end;
$$;
revoke all on function private.guard_inventory_tracking() from public,anon,authenticated;
create trigger guard_inventory_tracking before update on public.products
for each row execute function private.guard_inventory_tracking();
grant update(tracks_inventory) on public.products to authenticated;
drop policy products_member_insert on public.products;
create policy products_member_insert on public.products for insert to authenticated
with check (private.has_active_membership(business_id) and (
  not tracks_inventory or exists (
    select 1 from public.business_memberships m where m.business_id=products.business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  )
));

alter table public.inventory_balances enable row level security;
alter table public.stock_movements enable row level security;
create policy inventory_balances_read on public.inventory_balances for select to authenticated
using (private.has_active_membership(business_id));
create policy stock_movements_read on public.stock_movements for select to authenticated
using (private.has_active_membership(business_id));
revoke all on public.inventory_balances,public.stock_movements from anon,authenticated;
grant select on public.inventory_balances,public.stock_movements to authenticated;

create function private.require_stock_admin(p_business_id uuid, p_branch_id uuid, p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.business_memberships m where m.business_id=p_business_id
      and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')
  ) then raise exception 'Se requiere owner/admin para modificar stock.'; end if;
  if not exists (select 1 from public.branches b where b.business_id=p_business_id and b.id=p_branch_id and b.is_active)
    or not exists (select 1 from public.products p where p.business_id=p_business_id and p.id=p_product_id) then
    raise exception 'Sucursal o producto ajeno al negocio.';
  end if;
end;
$$;
revoke all on function private.require_stock_admin(uuid,uuid,uuid) from public,anon,authenticated;

create function public.apply_stock_movement(p_movement jsonb)
returns public.stock_movements language plpgsql security definer set search_path = '' as $$
declare result public.stock_movements; kind text;
begin
  kind := p_movement->>'movement_type';
  if kind not in ('initial','entry','adjustment','sale') then raise exception 'Tipo de movimiento inválido.'; end if;
  if kind='sale' then
    if not private.has_active_membership((p_movement->>'business_id')::uuid) then raise exception 'Sin acceso.'; end if;
    select * into result from public.stock_movements where id=(p_movement->>'id')::uuid;
    if not found then raise exception 'Primero se debe sincronizar la venta.'; end if;
  else
    perform private.require_stock_admin((p_movement->>'business_id')::uuid,
      (p_movement->>'branch_id')::uuid,(p_movement->>'product_id')::uuid);
    if (p_movement->>'created_by')::uuid is distinct from (select auth.uid())
      or (p_movement->>'quantity_delta')::integer=0
      or (kind='entry' and (p_movement->>'quantity_delta')::integer<=0)
      or (kind='initial' and (p_movement->>'quantity_delta')::integer<0) then
      raise exception 'Movimiento inválido.';
    end if;
    if not exists(select 1 from public.products where business_id=(p_movement->>'business_id')::uuid
      and id=(p_movement->>'product_id')::uuid and tracks_inventory) then
      raise exception 'El producto no controla stock.';
    end if;
    insert into public.stock_movements(id,business_id,branch_id,product_id,movement_type,quantity_delta,
      note,created_by,device_id,occurred_at)
    values((p_movement->>'id')::uuid,(p_movement->>'business_id')::uuid,
      (p_movement->>'branch_id')::uuid,(p_movement->>'product_id')::uuid,kind,
      (p_movement->>'quantity_delta')::integer,p_movement->>'note',
      (p_movement->>'created_by')::uuid,nullif(p_movement->>'device_id','')::uuid,
      (p_movement->>'occurred_at')::timestamptz)
    on conflict(id) do nothing returning * into result;
    if not found then select * into result from public.stock_movements where id=(p_movement->>'id')::uuid; end if;
  end if;
  if result.business_id is distinct from (p_movement->>'business_id')::uuid
    or result.branch_id is distinct from (p_movement->>'branch_id')::uuid
    or result.product_id is distinct from (p_movement->>'product_id')::uuid
    or result.movement_type is distinct from kind
    or result.quantity_delta is distinct from (p_movement->>'quantity_delta')::integer
    or result.sale_id is distinct from nullif(p_movement->>'sale_id','')::uuid
    or result.sale_item_id is distinct from nullif(p_movement->>'sale_item_id','')::uuid
    or result.note is distinct from p_movement->>'note'
    or result.created_by is distinct from (p_movement->>'created_by')::uuid
    or result.device_id is distinct from nullif(p_movement->>'device_id','')::uuid
    or result.occurred_at is distinct from (p_movement->>'occurred_at')::timestamptz then
    raise exception 'El UUID de movimiento ya existe con otros datos.';
  end if;
  return result;
end;
$$;
revoke all on function public.apply_stock_movement(jsonb) from public,anon;
grant execute on function public.apply_stock_movement(jsonb) to authenticated;

create function public.record_stock_change(p_id uuid,p_business_id uuid,p_branch_id uuid,p_product_id uuid,
  p_type text,p_value integer,p_note text default null)
returns public.stock_movements language plpgsql security definer set search_path = '' as $$
declare current_quantity integer; delta integer; result public.stock_movements;
begin
  perform private.require_stock_admin(p_business_id,p_branch_id,p_product_id);
  if p_type not in ('initial','entry','adjustment') or p_value is null or p_value<0
    or (p_type='entry' and p_value=0) then
    raise exception 'Cantidad o tipo inválido.';
  end if;
  -- Keep the same lock order as Sale/Product triggers: POS clock, then balance.
  insert into private.pos_sync_clock as clock(business_id,last_updated_at)
  values(p_business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update set last_updated_at=clock.last_updated_at;
  select * into result from public.stock_movements where id=p_id;
  if found then
    if result.business_id is distinct from p_business_id or result.branch_id is distinct from p_branch_id
      or result.product_id is distinct from p_product_id or result.movement_type is distinct from p_type
      or (p_type in ('initial','entry') and result.quantity_delta is distinct from p_value) then
      raise exception 'El UUID de movimiento ya existe con otros datos.';
    end if;
    return result;
  end if;
  select coalesce((select quantity from public.inventory_balances
    where business_id=p_business_id and branch_id=p_branch_id and product_id=p_product_id),0)
    into current_quantity;
  if p_type='initial' then
    if exists(select 1 from public.stock_movements where business_id=p_business_id and branch_id=p_branch_id and product_id=p_product_id)
      then raise exception 'El producto ya tiene movimientos en esta sucursal.'; end if;
    update public.products set tracks_inventory=true where business_id=p_business_id and id=p_product_id and not tracks_inventory;
    delta := p_value;
  else
    if not exists(select 1 from public.products where business_id=p_business_id and id=p_product_id and tracks_inventory)
      then raise exception 'Activá el control de stock primero.'; end if;
    delta := case when p_type='entry' then p_value else p_value-current_quantity end;
  end if;
  if delta=0 then return null; end if;
  if p_type='entry' and delta<0 then raise exception 'La entrada debe ser positiva.'; end if;
  insert into public.stock_movements(id,business_id,branch_id,product_id,movement_type,quantity_delta,
    note,created_by,occurred_at)
  values(p_id,p_business_id,p_branch_id,p_product_id,p_type,delta,p_note,(select auth.uid()),pg_catalog.clock_timestamp())
  returning * into result;
  return result;
end;
$$;
revoke all on function public.record_stock_change(uuid,uuid,uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.record_stock_change(uuid,uuid,uuid,uuid,text,integer,text) to authenticated;

-- Extend the existing atomic POS RPC; the sale item trigger creates stock in that transaction.
create or replace function public.complete_pos_sale(p_sale jsonb, p_items jsonb)
returns public.sales language plpgsql security definer set search_path = '' as $$
declare
  sale_row public.sales;
  inserted_id uuid;
  item jsonb;
  item_sum bigint := 0;
  item_count integer := 0;
  expected jsonb;
  actual jsonb;
begin
  if p_sale is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Venta sin líneas.';
  end if;
  if not private.has_active_membership((p_sale->>'business_id')::uuid)
    or (p_sale->>'created_by')::uuid is distinct from (select auth.uid()) then
    raise exception 'No hay acceso al negocio de esta venta.';
  end if;
  if p_sale->>'status' <> 'completed'
    or (p_sale->>'payment_method') not in ('cash','debit','credit','transfer','other')
    or (p_sale->>'subtotal_cents')::bigint <> (p_sale->>'total_cents')::bigint
    or (p_sale->>'total_cents')::bigint < 0 then
    raise exception 'Venta inválida.';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_count := item_count + 1;
    if (item->>'sale_id')::uuid is distinct from (p_sale->>'id')::uuid
      or nullif(btrim(item->>'product_name'),'') is null
      or (item->>'unit_price_cents')::bigint < 0
      or (item->>'quantity')::integer <= 0
      or (item->>'total_cents')::bigint <> (item->>'unit_price_cents')::bigint * (item->>'quantity')::integer then
      raise exception 'Línea de venta inválida.';
    end if;
    item_sum := item_sum + (item->>'total_cents')::bigint;
  end loop;
  if item_sum <> (p_sale->>'total_cents')::bigint or item_sum > 9007199254740991 then
    raise exception 'El total no coincide con las líneas.';
  end if;
  insert into public.sales(id,business_id,branch_id,device_id,created_by,status,subtotal_cents,total_cents,payment_method,created_at)
  values((p_sale->>'id')::uuid,(p_sale->>'business_id')::uuid,(p_sale->>'branch_id')::uuid,
    nullif(p_sale->>'device_id','')::uuid,(p_sale->>'created_by')::uuid,'completed',
    (p_sale->>'subtotal_cents')::bigint,item_sum,p_sale->>'payment_method',
    (p_sale->>'created_at')::timestamptz)
  on conflict(id) do nothing returning id into inserted_id;
  if inserted_id is not null then
    insert into public.sale_items(id,business_id,sale_id,product_id,product_name,barcode,unit_price_cents,quantity,total_cents,tracks_inventory)
    select (value->>'id')::uuid,(p_sale->>'business_id')::uuid,(p_sale->>'id')::uuid,
      nullif(value->>'product_id','')::uuid,value->>'product_name',value->>'barcode',
      (value->>'unit_price_cents')::bigint,(value->>'quantity')::integer,(value->>'total_cents')::bigint,coalesce((value->>'tracks_inventory')::boolean,false)
    from jsonb_array_elements(p_items);
  end if;
  select * into sale_row from public.sales where id=(p_sale->>'id')::uuid and business_id=(p_sale->>'business_id')::uuid;
  if not found or sale_row.branch_id is distinct from (p_sale->>'branch_id')::uuid
    or sale_row.device_id is distinct from nullif(p_sale->>'device_id','')::uuid
    or sale_row.created_by is distinct from (p_sale->>'created_by')::uuid
    or sale_row.subtotal_cents is distinct from (p_sale->>'subtotal_cents')::bigint
    or sale_row.total_cents is distinct from item_sum
    or sale_row.payment_method is distinct from p_sale->>'payment_method'
    or sale_row.created_at is distinct from (p_sale->>'created_at')::timestamptz then
    raise exception 'El UUID de venta ya existe con otros datos.';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'sale_id',sale_id,'product_id',product_id,
    'product_name',product_name,'barcode',barcode,'unit_price_cents',unit_price_cents,
    'quantity',quantity,'total_cents',total_cents,'tracks_inventory',tracks_inventory) order by id)
    into actual from public.sale_items where sale_id=sale_row.id and business_id=sale_row.business_id;
  select jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'sale_id',(value->>'sale_id')::uuid,
    'product_id',nullif(value->>'product_id','')::uuid,'product_name',value->>'product_name',
    'barcode',value->>'barcode','unit_price_cents',(value->>'unit_price_cents')::bigint,
    'quantity',(value->>'quantity')::integer,'total_cents',(value->>'total_cents')::bigint,'tracks_inventory',coalesce((value->>'tracks_inventory')::boolean,false))
    order by (value->>'id')::uuid) into expected from jsonb_array_elements(p_items);
  if actual is null or actual is distinct from expected or item_count <> jsonb_array_length(actual) then
    raise exception 'El UUID de venta ya existe con otras líneas.';
  end if;
  return sale_row;
end;
$$;
revoke all on function public.complete_pos_sale(jsonb,jsonb) from public, anon;
grant execute on function public.complete_pos_sale(jsonb,jsonb) to authenticated;
