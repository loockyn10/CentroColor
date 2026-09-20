-- Customer records are scoped to an active business membership.
create table public.customers (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text,
  email text check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  document_number text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_business_active_name_idx
  on public.customers (business_id, is_active desc, full_name, id);
create index customers_business_phone_idx on public.customers (business_id, phone);
create index customers_business_email_idx on public.customers (business_id, email);
create index customers_business_document_idx on public.customers (business_id, document_number);

create function private.touch_customer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_customer_updated_at() from public, anon, authenticated;
create trigger touch_customer_updated_at before update on public.customers
for each row execute function private.touch_customer_updated_at();

alter table public.customers enable row level security;
create policy customers_member_read on public.customers
  for select to authenticated using (private.has_active_membership(business_id));
create policy customers_member_insert on public.customers
  for insert to authenticated with check (private.has_active_membership(business_id));
create policy customers_member_update on public.customers
  for update to authenticated
  using (private.has_active_membership(business_id))
  with check (private.has_active_membership(business_id));

revoke all on public.customers from anon, authenticated;
grant select, insert on public.customers to authenticated;
-- Only mutable customer details can be changed. In particular, business_id and id
-- cannot be moved even when a user belongs to two businesses.
grant update (full_name, phone, email, document_number, notes, is_active)
  on public.customers to authenticated;
