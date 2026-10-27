-- PRICING-UX-02: global travel settings plus explicit commercial components.
create table public.travel_pricing_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete restrict,
  fuel_price_cents_per_liter bigint not null check(fuel_price_cents_per_liter>0),
  efficiency_milli_km_per_liter integer not null check(efficiency_milli_km_per_liter>0),
  margin_basis_points integer not null check(margin_basis_points between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.travel_pricing_settings.efficiency_milli_km_per_liter
  is 'Vehicle efficiency scaled by 1000: 10 km/l = 10000.';
comment on column public.travel_pricing_settings.margin_basis_points
  is 'Additional margin in basis points: 20% = 2000.';

alter table public.event_offer_rates
  add column operator_amount_cents bigint not null default 0 check(operator_amount_cents>=0),
  add column with_projector_amount_cents bigint check(with_projector_amount_cents is null or with_projector_amount_cents>=0);

create trigger travel_pricing_settings_version
before insert or update on public.travel_pricing_settings
for each row execute function private.event_next_version();

alter table public.travel_pricing_settings enable row level security;
revoke all on public.travel_pricing_settings from anon,authenticated;
grant select,insert,update on public.travel_pricing_settings to authenticated;
create policy travel_pricing_settings_read on public.travel_pricing_settings
for select to authenticated using(private.has_active_membership(business_id));
create policy travel_pricing_settings_admin on public.travel_pricing_settings
for all to authenticated
using(exists(select 1 from public.business_memberships m
  where m.business_id=travel_pricing_settings.business_id
    and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')))
with check(exists(select 1 from public.business_memberships m
  where m.business_id=travel_pricing_settings.business_id
    and m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));
