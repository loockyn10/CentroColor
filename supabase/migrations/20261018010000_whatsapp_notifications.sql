-- Sprint 14: WhatsApp Cloud API integration and durable, idempotent outbound notifications.
-- The access token lives only in Supabase Vault and is read only by Edge Functions.

-- 1. Per-Business integration. No token column: only a reference to a Vault secret.
create table public.whatsapp_integrations (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  phone_number_id text not null check(phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id text check(waba_id is null or waba_id ~ '^[0-9]{5,32}$'),
  display_phone_number text,
  access_token_secret_id uuid not null,
  status text not null check(status in ('configured','error','disconnected')),
  template_name text not null check(template_name ~ '^[a-z0-9_]+$' and length(template_name) <= 512),
  template_language text not null check(template_language ~ '^[a-z]{2,3}(_[A-Za-z]{2,4})?$'),
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_check_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Not readable by any client role: the admin UI goes through the whatsapp-admin function,
-- which never returns the token or its secret id.
alter table public.whatsapp_integrations enable row level security;
revoke all on public.whatsapp_integrations from public, anon, authenticated;
grant select on public.whatsapp_integrations to service_role;
grant update(status, display_phone_number, last_checked_at, last_check_error, updated_at)
  on public.whatsapp_integrations to service_role;

create function public.cc_store_whatsapp_token(p_token text, p_name text) returns uuid
language sql security definer set search_path=''
as $$ select vault.create_secret(p_token, p_name, 'CentroColor WhatsApp Cloud API access token') $$;
revoke all on function public.cc_store_whatsapp_token(text, text) from public, anon, authenticated;
grant execute on function public.cc_store_whatsapp_token(text, text) to service_role;

create function public.cc_read_whatsapp_token(p_secret_id uuid) returns text
language sql security definer set search_path=''
as $$ select decrypted_secret from vault.decrypted_secrets where id = p_secret_id $$;
revoke all on function public.cc_read_whatsapp_token(uuid) from public, anon, authenticated;
grant execute on function public.cc_read_whatsapp_token(uuid) to service_role;

create function public.cc_delete_whatsapp_token(p_secret_id uuid) returns void
language plpgsql security definer set search_path=''
as $$ begin delete from vault.secrets where id = p_secret_id; end $$;
revoke all on function public.cc_delete_whatsapp_token(uuid) from public, anon, authenticated;
grant execute on function public.cc_delete_whatsapp_token(uuid) to service_role;

-- Saves the integration and retires the previous token secret in one transaction.
create function public.cc_save_whatsapp_integration(
  p_business_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_template_name text,
  p_template_language text,
  p_secret_id uuid,
  p_actor uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_previous uuid;
begin
  select access_token_secret_id into v_previous from public.whatsapp_integrations where business_id = p_business_id;
  insert into public.whatsapp_integrations(business_id, phone_number_id, waba_id, access_token_secret_id, status,
    template_name, template_language, configured_by, configured_at, updated_at)
  values (p_business_id, p_phone_number_id, p_waba_id, p_secret_id, 'configured', p_template_name, p_template_language,
    p_actor, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  on conflict(business_id) do update set
    phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
    access_token_secret_id = excluded.access_token_secret_id, status = 'configured',
    template_name = excluded.template_name, template_language = excluded.template_language,
    configured_by = excluded.configured_by, configured_at = excluded.configured_at,
    display_phone_number = null, last_checked_at = null, last_check_error = null,
    updated_at = excluded.updated_at;
  if v_previous is not null and v_previous <> p_secret_id then
    delete from vault.secrets where id = v_previous;
  end if;
  return v_previous;
end;
$$;
revoke all on function public.cc_save_whatsapp_integration(uuid, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cc_save_whatsapp_integration(uuid, text, text, text, text, uuid, uuid) to service_role;

-- Disconnect: the token is destroyed, the configuration row is kept for audit.
create function public.cc_disconnect_whatsapp_integration(p_business_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_secret uuid;
begin
  select access_token_secret_id into v_secret from public.whatsapp_integrations where business_id = p_business_id;
  if v_secret is null then return false; end if;
  update public.whatsapp_integrations set status = 'disconnected', updated_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id;
  delete from vault.secrets where id = v_secret;
  return true;
end;
$$;
revoke all on function public.cc_disconnect_whatsapp_integration(uuid) from public, anon, authenticated;
grant execute on function public.cc_disconnect_whatsapp_integration(uuid) to service_role;

-- 2. OutboundNotification: one durable row per message, never deleted.
create table public.outbound_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid,
  source_type text not null check(source_type in ('photo_job')),
  photo_job_id uuid,
  channel text not null check(channel in ('whatsapp')),
  event_type text not null check(event_type in ('photo_job_ready')),
  destination text not null check(length(btrim(destination)) > 0),
  status text not null check(status in ('pending','sending','sent','failed','delivered','read')),
  provider text not null default 'meta' check(provider in ('meta')),
  provider_message_id text,
  attempt_count integer not null default 0 check(attempt_count >= 0),
  last_error text,
  last_error_code text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  idempotency_key text not null check(length(idempotency_key) between 8 and 200),
  trigger_kind text not null default 'auto' check(trigger_kind in ('auto','manual_resend')),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, idempotency_key),
  check((source_type = 'photo_job') = (photo_job_id is not null)),
  foreign key(business_id, photo_job_id) references public.photo_jobs(business_id, id) on delete restrict,
  foreign key(business_id, customer_id) references public.customers(business_id, id) on delete restrict
);
create index outbound_notifications_job_idx on public.outbound_notifications(business_id, photo_job_id, created_at desc);
create index outbound_notifications_queue_idx on public.outbound_notifications(status, created_at)
  where status in ('pending','sending');
create unique index outbound_notifications_message_idx on public.outbound_notifications(provider, provider_message_id)
  where provider_message_id is not null;

create table public.outbound_notification_events (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.outbound_notifications(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  kind text not null check(kind in ('queued','attempt','sent','failed','delivered','read','retry_requested','resend_requested')),
  actor_id uuid references auth.users(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);
create index outbound_notification_events_idx on public.outbound_notification_events(notification_id, id);

alter table public.outbound_notifications enable row level security;
alter table public.outbound_notification_events enable row level security;
create policy outbound_notifications_member_read on public.outbound_notifications for select to authenticated
  using(private.has_active_membership(business_id));
create policy outbound_notification_events_member_read on public.outbound_notification_events for select to authenticated
  using(private.has_active_membership(business_id));
-- Clients can only read. Every write goes through the SECURITY DEFINER functions below, so
-- the audit trail cannot be skipped and there is no DELETE for any role.
revoke all on public.outbound_notifications, public.outbound_notification_events from public, anon, authenticated;
grant select on public.outbound_notifications, public.outbound_notification_events to authenticated;
grant select on public.outbound_notifications, public.outbound_notification_events to service_role;

-- 3. Wake the sender when a notification is queued. Best effort: pg_net posts after commit to
--    the whatsapp-dispatch function, configured through two Vault secrets (see
--    docs/WHATSAPP_SETUP.md). Without them (or without pg_net) nothing happens here and the
--    notification stays `pending` until the dispatcher runs another way. Never raises.
create function private.kick_whatsapp_dispatch() returns void
language plpgsql security definer set search_path=''
as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'whatsapp_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'whatsapp_dispatch_secret';
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret);
exception when others then
  raise warning 'whatsapp dispatch kick failed: %', sqlerrm;
end;
$$;
revoke all on function private.kick_whatsapp_dispatch() from public, anon, authenticated;

-- 4. READY transition -> at most one automatic notification per job.
--    Runs inside the PhotoJob UPDATE, whoever performs it (Web, Desktop sync, SQL). It must
--    never block or fail the status change, so everything is guarded.
create function private.enqueue_photo_job_ready_notification() returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_state text;
  v_configured boolean;
  v_id uuid;
begin
  begin
    select * into v_order from public.public_photo_orders o
    where o.business_id = new.business_id and o.photo_job_id = new.id and o.status = 'submitted' and o.whatsapp_opt_in;
    if not found then return new; end if;
    select w.status into v_state from public.whatsapp_integrations w where w.business_id = new.business_id;
    v_configured := v_state = 'configured';
    insert into public.outbound_notifications(business_id, customer_id, source_type, photo_job_id, channel, event_type,
      destination, status, idempotency_key, last_error, last_error_code)
    values (new.business_id, v_order.customer_id, 'photo_job', new.id, 'whatsapp', 'photo_job_ready',
      v_order.whatsapp_e164, case when v_configured then 'pending' else 'failed' end,
      'photo_job:' || new.id::text || ':ready:whatsapp',
      case when v_configured then null
        when v_state = 'error' then 'La conexión con WhatsApp necesita revisión (token o configuración).'
        else 'WhatsApp no está configurado para este negocio.' end,
      case when v_configured then null
        when v_state = 'error' then 'integration_error'
        else 'integration_not_configured' end)
    on conflict(business_id, idempotency_key) do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.outbound_notification_events(notification_id, business_id, kind, detail)
      values (v_id, new.business_id, 'queued',
        case when v_configured then null when v_state = 'error' then 'integration_error' else 'integration_not_configured' end);
      if v_configured then perform private.kick_whatsapp_dispatch(); end if;
    end if;
  exception when others then
    raise warning 'photo job ready notification not queued: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.enqueue_photo_job_ready_notification() from public, anon, authenticated;
create trigger photo_job_ready_notification
  after update of status on public.photo_jobs
  for each row when (new.status = 'ready' and old.status is distinct from 'ready')
  execute function private.enqueue_photo_job_ready_notification();

-- 5. Sender operations (service_role only). `claim` is the only way a message enters
--    `sending`, so two workers can never send the same row.
create function public.cc_claim_notifications(p_ids uuid[], p_limit integer)
returns setof public.outbound_notifications
language plpgsql security definer set search_path=''
as $$
begin
  -- A worker that died mid-send leaves `sending` behind. Do not guess whether Meta got it:
  -- park it as failed so a person decides (retry is explicit).
  update public.outbound_notifications set status = 'failed', last_error_code = 'interrupted',
    last_error = 'El envío quedó interrumpido. Verificá y reintentá.', updated_at = pg_catalog.clock_timestamp()
  where status = 'sending' and updated_at < pg_catalog.clock_timestamp() - interval '10 minutes';
  return query
  with picked as (
    select n.id from public.outbound_notifications n
    where n.status = 'pending' and (p_ids is null or n.id = any(p_ids))
    order by n.created_at, n.id
    limit greatest(p_limit, 1)
    for update skip locked
  ), claimed as (
    update public.outbound_notifications n set status = 'sending', attempt_count = n.attempt_count + 1,
      updated_at = pg_catalog.clock_timestamp()
    from picked where n.id = picked.id
    returning n.*
  ), logged as (
    insert into public.outbound_notification_events(notification_id, business_id, kind, detail)
    select c.id, c.business_id, 'attempt', 'attempt ' || c.attempt_count::text from claimed c
  )
  select * from claimed;
end;
$$;
revoke all on function public.cc_claim_notifications(uuid[], integer) from public, anon, authenticated;
grant execute on function public.cc_claim_notifications(uuid[], integer) to service_role;

create function public.cc_finish_notification(
  p_id uuid, p_ok boolean, p_provider_message_id text, p_error_code text, p_error text
) returns void
language plpgsql security definer set search_path=''
as $$
declare v_business uuid;
begin
  if p_ok then
    update public.outbound_notifications set status = 'sent', provider_message_id = p_provider_message_id,
      sent_at = pg_catalog.clock_timestamp(), last_error = null, last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
    where id = p_id and status = 'sending' returning business_id into v_business;
  else
    update public.outbound_notifications set status = 'failed', last_error = left(p_error, 500),
      last_error_code = left(p_error_code, 60), updated_at = pg_catalog.clock_timestamp()
    where id = p_id and status = 'sending' returning business_id into v_business;
  end if;
  if v_business is not null then
    insert into public.outbound_notification_events(notification_id, business_id, kind, detail)
    values (p_id, v_business, case when p_ok then 'sent' else 'failed' end,
      case when p_ok then p_provider_message_id else left(coalesce(p_error_code, '') || ': ' || coalesce(p_error, ''), 500) end);
  end if;
end;
$$;
revoke all on function public.cc_finish_notification(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.cc_finish_notification(uuid, boolean, text, text, text) to service_role;

-- Manual retry of a FAILED notification (same row, audited).
create function public.cc_retry_notification(p_business_id uuid, p_id uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  update public.outbound_notifications set status = 'pending', requested_by = p_actor,
    updated_at = pg_catalog.clock_timestamp()
  where id = p_id and business_id = p_business_id and status = 'failed' returning id into v_id;
  if v_id is null then raise exception 'cc_error:not_retryable'; end if;
  insert into public.outbound_notification_events(notification_id, business_id, kind, actor_id)
  values (v_id, p_business_id, 'retry_requested', p_actor);
  return v_id;
end;
$$;
revoke all on function public.cc_retry_notification(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_retry_notification(uuid, uuid, uuid) to service_role;

-- Manual resend of a notification that already went out. It is a NEW row with its own key,
-- so it is audited and cannot collide with the single automatic notice.
create function public.cc_resend_ready_notification(p_business_id uuid, p_job_id uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_job public.photo_jobs%rowtype;
  v_order public.public_photo_orders%rowtype;
  v_original public.outbound_notifications%rowtype;
  v_id uuid;
begin
  select * into v_job from public.photo_jobs j where j.business_id = p_business_id and j.id = p_job_id and not j.is_draft;
  if not found then raise exception 'cc_error:job_not_found'; end if;
  if v_job.status <> 'ready' then raise exception 'cc_error:job_not_ready'; end if;
  select * into v_order from public.public_photo_orders o
  where o.business_id = p_business_id and o.photo_job_id = p_job_id and o.status = 'submitted' and o.whatsapp_opt_in;
  if not found then raise exception 'cc_error:no_consent'; end if;
  select * into v_original from public.outbound_notifications n
  where n.business_id = p_business_id and n.photo_job_id = p_job_id and n.event_type = 'photo_job_ready'
  order by n.created_at, n.id limit 1;
  if not found then raise exception 'cc_error:no_original_notice'; end if;
  if (select count(*) from public.outbound_notifications n
      where n.business_id = p_business_id and n.photo_job_id = p_job_id and n.trigger_kind = 'manual_resend') >= 5 then
    raise exception 'cc_error:resend_limit';
  end if;
  if exists(select 1 from public.outbound_notifications n
      where n.business_id = p_business_id and n.photo_job_id = p_job_id and n.status in ('pending','sending')) then
    raise exception 'cc_error:already_in_flight';
  end if;
  insert into public.outbound_notifications(business_id, customer_id, source_type, photo_job_id, channel, event_type,
    destination, status, idempotency_key, trigger_kind, requested_by)
  values (p_business_id, v_order.customer_id, 'photo_job', p_job_id, 'whatsapp', 'photo_job_ready',
    v_order.whatsapp_e164, 'pending', 'photo_job:' || p_job_id::text || ':ready:whatsapp:resend:' || gen_random_uuid()::text,
    'manual_resend', p_actor)
  returning id into v_id;
  insert into public.outbound_notification_events(notification_id, business_id, kind, actor_id)
  values (v_id, p_business_id, 'resend_requested', p_actor);
  return v_id;
end;
$$;
revoke all on function public.cc_resend_ready_notification(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_resend_ready_notification(uuid, uuid, uuid) to service_role;

-- Delivery receipts from the Meta webhook. Statuses only move forward, and `delivered` is
-- recorded only when Meta says so (acceptance by the API is `sent`).
create function public.cc_apply_whatsapp_status(
  p_message_id text, p_status text, p_at timestamptz, p_error_code text, p_error text
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_row public.outbound_notifications%rowtype;
begin
  select * into v_row from public.outbound_notifications
  where provider = 'meta' and provider_message_id = p_message_id for update;
  if not found then return false; end if;
  if p_status = 'delivered' and v_row.status in ('sent') then
    update public.outbound_notifications set status = 'delivered', delivered_at = coalesce(p_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp() where id = v_row.id;
  elsif p_status = 'read' and v_row.status in ('sent','delivered') then
    update public.outbound_notifications set status = 'read', read_at = coalesce(p_at, pg_catalog.clock_timestamp()),
      delivered_at = coalesce(delivered_at, p_at), updated_at = pg_catalog.clock_timestamp() where id = v_row.id;
  elsif p_status = 'failed' and v_row.status in ('sent','sending') then
    update public.outbound_notifications set status = 'failed', last_error = left(p_error, 500),
      last_error_code = left(coalesce(p_error_code, 'delivery_failed'), 60), updated_at = pg_catalog.clock_timestamp()
    where id = v_row.id;
  else
    return false;
  end if;
  insert into public.outbound_notification_events(notification_id, business_id, kind, detail)
  values (v_row.id, v_row.business_id, case p_status when 'failed' then 'failed' else p_status end,
    case when p_status = 'failed' then left(coalesce(p_error_code, '') || ': ' || coalesce(p_error, ''), 500) end);
  return true;
end;
$$;
revoke all on function public.cc_apply_whatsapp_status(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.cc_apply_whatsapp_status(text, text, timestamptz, text, text) to service_role;

-- The Edge Functions also create read-only tracking links and look up customer data.
-- (photo_job_upload_links and the Sprint 13 tables already grant service_role what is needed.)
