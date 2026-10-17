-- Harden the already-applied Sprint 13 Google Drive OAuth lifecycle.
alter table public.google_oauth_states
  add column consumed_at timestamptz,
  add constraint google_oauth_states_consumed_after_creation
    check(consumed_at is null or consumed_at >= created_at);

-- These tables are intentionally inaccessible to anon/authenticated clients.
-- Edge Functions switch to service_role only after membership authorization.
grant select,insert,update on public.google_oauth_states to service_role;
grant select,insert,update on public.google_drive_integrations to service_role;

create function public.cc_complete_google_drive_oauth(
  p_state_hash text,
  p_google_account_email text,
  p_root_folder_id text,
  p_refresh_token_secret_id uuid
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_state public.google_oauth_states%rowtype;
  v_previous_secret_id uuid;
begin
  select * into v_state
  from public.google_oauth_states
  where state_hash=p_state_hash
  for update;

  if not found then
    raise exception 'OAuth state does not exist' using errcode='P0002';
  end if;
  if v_state.consumed_at is not null then
    raise exception 'OAuth state already consumed' using errcode='23505';
  end if;
  if v_state.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'OAuth state expired' using errcode='22023';
  end if;

  select refresh_token_secret_id into v_previous_secret_id
  from public.google_drive_integrations
  where business_id=v_state.business_id;

  insert into public.google_drive_integrations(
    business_id,
    google_account_email,
    root_folder_id,
    refresh_token_secret_id,
    connected_by,
    connected_at,
    disconnected_at,
    status,
    updated_at
  ) values (
    v_state.business_id,
    p_google_account_email,
    p_root_folder_id,
    p_refresh_token_secret_id,
    v_state.user_id,
    pg_catalog.clock_timestamp(),
    null,
    'connected',
    pg_catalog.clock_timestamp()
  )
  on conflict(business_id) do update set
    google_account_email=excluded.google_account_email,
    root_folder_id=excluded.root_folder_id,
    refresh_token_secret_id=excluded.refresh_token_secret_id,
    connected_by=excluded.connected_by,
    connected_at=excluded.connected_at,
    disconnected_at=null,
    status='connected',
    updated_at=excluded.updated_at;

  if v_previous_secret_id is not null
     and v_previous_secret_id<>p_refresh_token_secret_id then
    delete from vault.secrets where id=v_previous_secret_id;
  end if;

  update public.google_oauth_states
  set consumed_at=pg_catalog.clock_timestamp()
  where state_hash=p_state_hash;

  return v_previous_secret_id;
end;
$$;

revoke all on function public.cc_complete_google_drive_oauth(text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.cc_complete_google_drive_oauth(text,text,text,uuid)
  to service_role;
