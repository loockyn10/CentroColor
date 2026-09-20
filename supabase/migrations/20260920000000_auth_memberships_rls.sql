-- Auth owns identities; only a database administrator provisions memberships.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_memberships_user_active_idx
  on public.business_memberships (user_id, business_id) where is_active;

create schema if not exists private;
revoke all on schema private from public;

-- The table owner bypasses membership RLS, avoiding recursive policy evaluation.
-- No caller can supply a different user ID; auth.uid() comes from the verified JWT.
create function private.has_active_membership(target_business_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = target_business_id
      and m.user_id = (select auth.uid())
      and m.is_active
  );
$$;
revoke all on function private.has_active_membership(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.has_active_membership(uuid) to authenticated;

create function private.create_profile_for_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
revoke all on function private.create_profile_for_auth_user() from public, anon, authenticated;
create trigger create_profile_after_auth_user
after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

-- Cover Auth users created before this migration.
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.business_memberships enable row level security;

create policy businesses_member_read on public.businesses
  for select to authenticated
  using (private.has_active_membership(id));
create policy branches_member_read on public.branches
  for select to authenticated
  using (private.has_active_membership(business_id));
create policy devices_member_read on public.devices
  for select to authenticated
  using (private.has_active_membership(business_id));
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy memberships_self_active_read on public.business_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) and is_active);

-- Sprint 2 revoked client access explicitly. Restore SELECT only; mutations remain
-- administrator-only until a reviewed permission model exists.
grant select on public.businesses, public.branches, public.devices to authenticated;
revoke all on public.profiles, public.business_memberships from anon, authenticated;
grant select on public.profiles, public.business_memberships to authenticated;
