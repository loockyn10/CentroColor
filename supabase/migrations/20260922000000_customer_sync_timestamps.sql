-- The Cloud version is allocated under one row lock per business. The lock is
-- held until commit, so later committed Customer writes cannot receive an
-- earlier updated_at, even when transactions overlap or server time moves back.
create table private.customer_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.customer_sync_clock from public, anon, authenticated;
alter table private.customer_sync_clock enable row level security;

-- Sprint 4 allowed the client to supply updated_at on INSERT. Rebase existing
-- values before establishing the monotonic clock. This migration is atomic.
alter table public.customers disable trigger touch_customer_updated_at;
update public.customers set updated_at = pg_catalog.clock_timestamp();
alter table public.customers enable trigger touch_customer_updated_at;
insert into private.customer_sync_clock (business_id, last_updated_at)
select business_id, max(updated_at)
from public.customers
group by business_id;

create or replace function private.touch_customer_updated_at()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  next_version timestamptz;
begin
  insert into private.customer_sync_clock as clock (business_id, last_updated_at)
  values (new.business_id, pg_catalog.clock_timestamp())
  on conflict (business_id) do update
    set last_updated_at = greatest(
      pg_catalog.clock_timestamp(),
      clock.last_updated_at + interval '1 microsecond'
    )
  returning last_updated_at into next_version;
  new.updated_at := next_version;
  return new;
end;
$$;
revoke all on function private.touch_customer_updated_at() from public, anon, authenticated;

create trigger set_customer_updated_at_on_insert
before insert on public.customers
for each row execute function private.touch_customer_updated_at();

create index customers_business_updated_id_idx
  on public.customers (business_id, updated_at, id);
