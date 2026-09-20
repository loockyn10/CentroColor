-- Sprint 2: structural identity only. Client roles receive no access until
-- authentication and tenant-scoped policies are designed in a later sprint.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  device_type text not null check (device_type in ('desktop', 'web', 'mobile')),
  installation_id uuid not null unique,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, branch_id)
    references public.branches (business_id, id) on delete restrict
);

create index branches_business_id_idx on public.branches (business_id);
create index devices_business_branch_idx on public.devices (business_id, branch_id);

alter table public.businesses enable row level security;
alter table public.branches enable row level security;
alter table public.devices enable row level security;

-- RLS has no client policies yet. Explicit revocation also covers projects
-- with broad default grants on tables created in public.
revoke all on public.businesses, public.branches, public.devices from anon, authenticated;
