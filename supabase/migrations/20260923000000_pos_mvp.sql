-- POS schema only. Desktop Product/Sale synchronization is a later sprint.
-- A sale's optional device must belong to its business. The original devices
-- table has id as PK, but PostgreSQL requires an explicit key for this pair.
alter table public.devices
  add constraint devices_business_id_id_unique unique (business_id, id);

create table public.product_categories (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);
create index product_categories_business_name_idx on public.product_categories(business_id, name);

create table public.products (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  barcode text check (barcode is null or length(btrim(barcode)) > 0),
  sale_price_cents bigint not null check (sale_price_cents between 0 and 9007199254740991),
  cost_price_cents bigint check (cost_price_cents is null or cost_price_cents between 0 and 9007199254740991),
  category_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, category_id) references public.product_categories(business_id, id) on delete restrict
);
create unique index products_business_barcode_unique on public.products(business_id, barcode) where barcode is not null;
create index products_business_active_name_idx on public.products(business_id, is_active desc, name, id);

create table public.sales (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  device_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null check (status = 'completed'),
  subtotal_cents bigint not null check (subtotal_cents between 0 and 9007199254740991),
  total_cents bigint not null check (total_cents = subtotal_cents),
  payment_method text not null check (payment_method in ('cash', 'debit', 'credit', 'transfer', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, branch_id) references public.branches(business_id, id) on delete restrict,
  foreign key (business_id, device_id) references public.devices(business_id, id) on delete restrict
);
create index sales_business_created_idx on public.sales(business_id, created_at desc, id);

create table public.sale_items (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  sale_id uuid not null,
  product_id uuid,
  product_name text not null check (length(btrim(product_name)) > 0),
  barcode text,
  unit_price_cents bigint not null check (unit_price_cents between 0 and 9007199254740991),
  quantity integer not null check (quantity > 0),
  total_cents bigint not null check (total_cents = unit_price_cents * quantity and total_cents between 0 and 9007199254740991),
  foreign key (business_id, sale_id) references public.sales(business_id, id) on delete restrict,
  foreign key (business_id, product_id) references public.products(business_id, id) on delete restrict
);
create index sale_items_business_sale_idx on public.sale_items(business_id, sale_id);

create function private.touch_pos_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_pos_updated_at() from public, anon, authenticated;
create trigger touch_products_updated_at before update on public.products for each row execute function private.touch_pos_updated_at();
create trigger touch_product_categories_updated_at before update on public.product_categories for each row execute function private.touch_pos_updated_at();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

create policy product_categories_member_read on public.product_categories for select to authenticated using (private.has_active_membership(business_id));
create policy product_categories_member_insert on public.product_categories for insert to authenticated with check (private.has_active_membership(business_id));
create policy product_categories_member_update on public.product_categories for update to authenticated using (private.has_active_membership(business_id)) with check (private.has_active_membership(business_id));
create policy products_member_read on public.products for select to authenticated using (private.has_active_membership(business_id));
create policy products_member_insert on public.products for insert to authenticated with check (private.has_active_membership(business_id));
create policy products_member_update on public.products for update to authenticated using (private.has_active_membership(business_id)) with check (private.has_active_membership(business_id));
create policy sales_member_read on public.sales for select to authenticated using (private.has_active_membership(business_id));
create policy sales_member_insert on public.sales for insert to authenticated with check (private.has_active_membership(business_id) and created_by = (select auth.uid()));
create policy sale_items_member_read on public.sale_items for select to authenticated using (private.has_active_membership(business_id));
create policy sale_items_member_insert on public.sale_items for insert to authenticated with check (private.has_active_membership(business_id));

revoke all on public.product_categories, public.products, public.sales, public.sale_items from anon, authenticated;
grant select, insert on public.product_categories, public.products, public.sales, public.sale_items to authenticated;
grant update (name, is_active) on public.product_categories to authenticated;
grant update (name, barcode, sale_price_cents, cost_price_cents, category_id, is_active) on public.products to authenticated;
