-- The POS clock serializes writes per business across categories, products and
-- sales. A cursor can therefore advance without skipping an uncommitted row.
create table private.pos_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.pos_sync_clock from public, anon, authenticated;
alter table private.pos_sync_clock enable row level security;

drop trigger touch_products_updated_at on public.products;
drop trigger touch_product_categories_updated_at on public.product_categories;
update public.product_categories set updated_at = pg_catalog.clock_timestamp();
update public.products set updated_at = pg_catalog.clock_timestamp();
update public.sales set updated_at = pg_catalog.clock_timestamp();
insert into private.pos_sync_clock(business_id,last_updated_at)
select business_id,max(updated_at) from (
  select business_id,updated_at from public.product_categories
  union all select business_id,updated_at from public.products
  union all select business_id,updated_at from public.sales
) existing group by business_id;

create function private.pos_next_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare next_version timestamptz;
begin
  insert into private.pos_sync_clock as clock(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update set last_updated_at = greatest(
    pg_catalog.clock_timestamp(),clock.last_updated_at + interval '1 microsecond'
  ) returning last_updated_at into next_version;
  new.updated_at := next_version;
  return new;
end;
$$;
revoke all on function private.pos_next_version() from public, anon, authenticated;
create trigger pos_category_version before insert or update on public.product_categories
for each row execute function private.pos_next_version();
create trigger pos_product_version before insert or update on public.products
for each row execute function private.pos_next_version();
create trigger pos_sale_version before insert on public.sales
for each row execute function private.pos_next_version();
create index product_categories_business_updated_id_idx on public.product_categories(business_id,updated_at,id);
create index products_business_updated_id_idx on public.products(business_id,updated_at,id);
create index sales_business_updated_id_idx on public.sales(business_id,updated_at,id);

-- Clients may insert a completed sale only through this atomic, idempotent RPC.
revoke insert on public.sales, public.sale_items from authenticated;
create function public.complete_pos_sale(p_sale jsonb, p_items jsonb)
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
    insert into public.sale_items(id,business_id,sale_id,product_id,product_name,barcode,unit_price_cents,quantity,total_cents)
    select (value->>'id')::uuid,(p_sale->>'business_id')::uuid,(p_sale->>'id')::uuid,
      nullif(value->>'product_id','')::uuid,value->>'product_name',value->>'barcode',
      (value->>'unit_price_cents')::bigint,(value->>'quantity')::integer,(value->>'total_cents')::bigint
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
    'quantity',quantity,'total_cents',total_cents) order by id)
    into actual from public.sale_items where sale_id=sale_row.id and business_id=sale_row.business_id;
  select jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'sale_id',(value->>'sale_id')::uuid,
    'product_id',nullif(value->>'product_id','')::uuid,'product_name',value->>'product_name',
    'barcode',value->>'barcode','unit_price_cents',(value->>'unit_price_cents')::bigint,
    'quantity',(value->>'quantity')::integer,'total_cents',(value->>'total_cents')::bigint)
    order by (value->>'id')::uuid) into expected from jsonb_array_elements(p_items);
  if actual is null or actual is distinct from expected or item_count <> jsonb_array_length(actual) then
    raise exception 'El UUID de venta ya existe con otras líneas.';
  end if;
  return sale_row;
end;
$$;
revoke all on function public.complete_pos_sale(jsonb,jsonb) from public, anon;
grant execute on function public.complete_pos_sale(jsonb,jsonb) to authenticated;
