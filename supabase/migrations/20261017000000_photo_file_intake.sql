-- Sprint 13: Google Drive-backed customer file intake. Binary content is never stored here.
create extension if not exists supabase_vault with schema vault;

alter table public.photo_services
  add column workflow_route text not null default 'none'
    check(workflow_route in('none','lab','editing','other')),
  add column requires_customer_files boolean not null default false;
alter table public.photo_jobs
  add column file_intake_status text not null default 'not_required'
    check(file_intake_status in('not_required','not_requested','awaiting_files','receiving','submitted')),
  add column drive_folder_id text,
  add column drive_edited_folder_id text;

create table public.google_drive_integrations (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  google_account_email text,
  root_folder_id text not null,
  refresh_token_secret_id uuid not null,
  connected_by uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  status text not null check(status in('connected','disconnected','error','reconnect_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_oauth_states (
  state_hash text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from public,anon,authenticated;

create table public.photo_job_upload_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  photo_job_id uuid not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz,
  revoked_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,photo_job_id) references public.photo_jobs(business_id,id) on delete restrict
);

create table public.photo_job_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  photo_job_id uuid not null,
  photo_job_item_id uuid,
  drive_file_id text not null,
  drive_folder_id text not null,
  original_filename text not null check(length(btrim(original_filename)) > 0),
  stored_filename text not null check(length(btrim(stored_filename)) > 0),
  mime_type text,
  size_bytes bigint not null check(size_bytes >= 0),
  copies integer not null default 1 check(copies > 0),
  workflow_route text not null check(workflow_route in('none','lab','editing','other')),
  status text not null check(status in('pending','uploading','uploaded','failed','removed')),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,drive_file_id),
  foreign key(business_id,photo_job_id) references public.photo_jobs(business_id,id) on delete restrict,
  foreign key(business_id,photo_job_item_id) references public.photo_job_items(business_id,id) on delete restrict
);

create table public.photo_job_drive_folders (
  business_id uuid not null,
  photo_job_id uuid not null,
  folder_key text not null,
  drive_folder_id text not null,
  created_at timestamptz not null default now(),
  primary key(business_id,photo_job_id,folder_key),
  foreign key(business_id,photo_job_id) references public.photo_jobs(business_id,id) on delete cascade
);
alter table public.photo_job_drive_folders enable row level security;
revoke all on public.photo_job_drive_folders from public,anon,authenticated;

create index photo_upload_links_job_idx on public.photo_job_upload_links(business_id,photo_job_id,created_at desc);
create index photo_job_files_job_idx on public.photo_job_files(business_id,photo_job_id,status,created_at);
create index photo_job_files_item_idx on public.photo_job_files(business_id,photo_job_item_id,status);
create index photo_job_files_sync_idx on public.photo_job_files(business_id,updated_at,id);

create function private.photo_file_guard() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.photo_job_item_id is not null and not exists(
    select 1 from public.photo_job_items i
    where i.business_id=new.business_id and i.photo_job_id=new.photo_job_id and i.id=new.photo_job_item_id
  ) then raise exception 'PhotoJobItem does not belong to PhotoJob'; end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.business_id<>old.business_id or new.photo_job_id<>old.photo_job_id or new.photo_job_item_id is distinct from old.photo_job_item_id or new.drive_file_id<>old.drive_file_id or new.created_at<>old.created_at) then
    raise exception 'PhotoJobFile identity fields are immutable';
  end if;
  if tg_op='INSERT' then new.updated_at:=coalesce(new.updated_at,pg_catalog.clock_timestamp());
  else new.updated_at:=greatest(pg_catalog.clock_timestamp(),old.updated_at+interval '1 microsecond'); end if;
  return new;
end;
$$;
revoke all on function private.photo_file_guard() from public,anon,authenticated;
create trigger photo_file_guard before insert or update on public.photo_job_files for each row execute function private.photo_file_guard();

create function private.photo_intake_guard() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.file_intake_status<>old.file_intake_status and new.file_intake_status='submitted' and not exists(
    select 1 from public.photo_job_files f where f.business_id=new.business_id and f.photo_job_id=new.id and f.status='uploaded'
  ) then raise exception 'Cannot submit a PhotoJob without uploaded files'; end if;
  return new;
end;
$$;
revoke all on function private.photo_intake_guard() from public,anon,authenticated;
create trigger photo_intake_guard before update of file_intake_status on public.photo_jobs for each row execute function private.photo_intake_guard();

create function public.cc_store_google_refresh_token(p_token text, p_name text) returns uuid
language sql security definer set search_path=''
as $$ select vault.create_secret(p_token,p_name,'CentroColor Google Drive OAuth refresh token') $$;
revoke all on function public.cc_store_google_refresh_token(text,text) from public,anon,authenticated;
grant execute on function public.cc_store_google_refresh_token(text,text) to service_role;

create function public.cc_read_google_refresh_token(p_secret_id uuid) returns text
language sql security definer set search_path=''
as $$ select decrypted_secret from vault.decrypted_secrets where id=p_secret_id $$;
revoke all on function public.cc_read_google_refresh_token(uuid) from public,anon,authenticated;
grant execute on function public.cc_read_google_refresh_token(uuid) to service_role;

create function public.cc_delete_google_refresh_token(p_secret_id uuid) returns void
language plpgsql security definer set search_path=''
as $$ begin delete from vault.secrets where id=p_secret_id; end $$;
revoke all on function public.cc_delete_google_refresh_token(uuid) from public,anon,authenticated;
grant execute on function public.cc_delete_google_refresh_token(uuid) to service_role;

alter table public.google_drive_integrations enable row level security;
alter table public.photo_job_upload_links enable row level security;
alter table public.photo_job_files enable row level security;
create policy drive_integration_admin_read on public.google_drive_integrations for select to authenticated
using(exists(select 1 from public.business_memberships m where m.business_id=google_drive_integrations.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in('owner','admin')));
create policy photo_upload_links_admin_read on public.photo_job_upload_links for select to authenticated
using(exists(select 1 from public.business_memberships m where m.business_id=photo_job_upload_links.business_id and m.user_id=(select auth.uid()) and m.is_active and m.role in('owner','admin')));
create policy photo_job_files_member_read on public.photo_job_files for select to authenticated
using(private.has_active_membership(business_id));
revoke all on public.google_drive_integrations,public.photo_job_upload_links,public.photo_job_files from anon,authenticated;
grant select on public.google_drive_integrations,public.photo_job_upload_links,public.photo_job_files to authenticated;

-- OAuth, token validation and file mutations are performed by Edge Functions with server-only credentials.
-- No grants are made to anon and no binary column exists in PostgreSQL.
