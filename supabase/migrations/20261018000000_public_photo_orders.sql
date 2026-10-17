-- Sprint 14: public self-service photo orders (/imprimir) and order tracking.
-- Incremental on top of Sprint 11-13. Nothing here deletes or rewrites existing rows.

-- 1. Public catalog flags on PhotoService. The public price list IS photo_services:
--    there is no second catalog, so a price change is reflected immediately.
alter table public.photo_services
  add column is_public boolean not null default false,
  add column public_name text
    check(public_name is null or length(btrim(public_name)) between 1 and 80),
  add column public_description text
    check(public_description is null or length(public_description) <= 300),
  add column public_sort_order integer not null default 0,
  add column public_order_enabled boolean not null default false,
  add constraint photo_services_public_order_requires_lab check(
    not public_order_enabled
    or (is_public and workflow_route = 'lab' and requires_customer_files)
  );
create index photo_services_public_idx
  on public.photo_services(business_id, public_sort_order, name)
  where is_active and is_public and public_order_enabled;

-- 2. Order channel and draft marker on PhotoJob. A public order is created as a draft
--    (is_draft) so an abandoned upload never reaches Producción, Trabajos or Desktop sync.
alter table public.photo_jobs
  add column source_channel text not null default 'manual'
    check(source_channel in ('manual','public_web','future_gmail')),
  add column is_draft boolean not null default false,
  add constraint photo_jobs_draft_is_public_web check(not is_draft or source_channel = 'public_web');
create index photo_jobs_public_draft_idx
  on public.photo_jobs(business_id, created_at) where is_draft;

-- 3. Non-destructive phone matching for Customer. `phone` is free text typed by staff, so
--    the match key is derived (digits only, last 10) instead of rewriting historical rows.
alter table public.customers
  add column phone_match_key text generated always as (
    nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
  ) stored;
create index customers_business_phone_match_idx
  on public.customers(business_id, phone_match_key) where phone_match_key is not null;

-- 4. Upload links get a purpose. A public order has an `upload` link (mutates files, short
--    lived) and, once confirmed, `tracking` links (read-only status, long lived). They share
--    the table, hashing and revocation, but never each other's permissions.
alter table public.photo_job_upload_links
  alter column created_by drop not null,
  add column purpose text not null default 'upload' check(purpose in ('upload','tracking'));

-- 5. Public order: customer/consent snapshot and lifecycle for one PhotoJob.
create table public.public_photo_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  photo_job_id uuid not null,
  customer_id uuid not null,
  client_key text not null check(client_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  status text not null default 'draft' check(status in ('draft','submitted','abandoned')),
  customer_name text not null check(length(btrim(customer_name)) > 0),
  whatsapp_e164 text not null check(whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_opt_in boolean not null,
  whatsapp_opt_in_at timestamptz,
  consent_source text not null default 'public_order' check(consent_source = 'public_order'),
  contact_email text,
  client_ip_hash text,
  submitted_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, client_key),
  unique(business_id, photo_job_id),
  check(whatsapp_opt_in = (whatsapp_opt_in_at is not null)),
  foreign key(business_id, photo_job_id) references public.photo_jobs(business_id, id) on delete restrict,
  foreign key(business_id, customer_id) references public.customers(business_id, id) on delete restrict
);
create index public_photo_orders_rate_idx on public.public_photo_orders(business_id, created_at);
create index public_photo_orders_status_idx on public.public_photo_orders(business_id, status, created_at);
alter table public.public_photo_orders enable row level security;
create policy public_photo_orders_member_read on public.public_photo_orders for select to authenticated
  using(private.has_active_membership(business_id) and status = 'submitted');
-- Members see the consent snapshot of confirmed orders; the idempotency key and the hashed
-- client address stay server-only.
revoke all on public.public_photo_orders from public, anon, authenticated;
grant select(id, business_id, photo_job_id, customer_id, status, customer_name, whatsapp_e164,
  whatsapp_opt_in, whatsapp_opt_in_at, consent_source, contact_email, submitted_at, created_at)
  on public.public_photo_orders to authenticated;
grant select on public.public_photo_orders to service_role;

-- 6. Drafts are invisible to every client role: PhotoJob, its items and its files.
create function private.photo_job_visible(p_business_id uuid, p_job_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.photo_jobs j
    where j.business_id = p_business_id and j.id = p_job_id and not j.is_draft
  )
$$;
revoke all on function private.photo_job_visible(uuid, uuid) from public, anon, authenticated;
grant execute on function private.photo_job_visible(uuid, uuid) to authenticated;

drop policy photo_jobs_read on public.photo_jobs;
create policy photo_jobs_read on public.photo_jobs for select to authenticated
  using(private.has_active_membership(business_id) and not is_draft);
drop policy photo_jobs_insert on public.photo_jobs;
create policy photo_jobs_insert on public.photo_jobs for insert to authenticated
  with check(
    private.has_active_membership(business_id)
    and created_by = (select auth.uid())
    and not is_draft
    and source_channel = 'manual'
  );
drop policy photo_jobs_update on public.photo_jobs;
create policy photo_jobs_update on public.photo_jobs for update to authenticated
  using(private.has_active_membership(business_id) and not is_draft)
  with check(private.has_active_membership(business_id) and not is_draft);
drop policy photo_job_items_member on public.photo_job_items;
create policy photo_job_items_member on public.photo_job_items for all to authenticated
  using(private.has_active_membership(business_id) and private.photo_job_visible(business_id, photo_job_id))
  with check(private.has_active_membership(business_id) and private.photo_job_visible(business_id, photo_job_id));
drop policy photo_job_files_member_read on public.photo_job_files;
create policy photo_job_files_member_read on public.photo_job_files for select to authenticated
  using(private.has_active_membership(business_id) and private.photo_job_visible(business_id, photo_job_id));

-- Channel and draft belong to the server, like the intake columns (Sprint 13 stabilization).
create or replace function private.photo_job_server_owned_columns() returns trigger
language plpgsql set search_path=''
as $$
begin
  if current_user in ('authenticated','anon') then
    new.file_intake_status := old.file_intake_status;
    new.drive_folder_id := old.drive_folder_id;
    new.drive_edited_folder_id := old.drive_edited_folder_id;
    new.source_channel := old.source_channel;
    new.is_draft := old.is_draft;
  end if;
  return new;
end;
$$;

-- 7. Starts (or refreshes) a public order in ONE transaction: Customer, draft PhotoJob,
--    PhotoJobItems with a price snapshot taken from photo_services, the order snapshot and
--    the upload capability. Replaying the same client_key never duplicates anything.
--    Prices are never taken from the caller: it only states the price it displayed, and the
--    call fails with cc_error:price_changed when that differs from the catalog.
create function public.cc_public_order_start(
  p_business_id uuid,
  p_client_key text,
  p_customer_name text,
  p_phone_e164 text,
  p_phone_display text,
  p_email text,
  p_notes text,
  p_whatsapp_opt_in boolean,
  p_ip_hash text,
  p_items jsonb,
  p_token_hash text,
  p_link_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_exists boolean;
  v_service public.photo_services%rowtype;
  v_entry jsonb;
  v_qty integer;
  v_service_ids uuid[] := '{}';
  v_key text := right(regexp_replace(coalesce(p_phone_e164, ''), '\D', '', 'g'), 10);
  v_customer uuid;
  v_branch uuid;
  v_creator uuid;
  v_job uuid;
  v_link uuid;
  v_item uuid;
  v_job_notes text;
  v_email text;
  v_items jsonb;
  v_total bigint;
  v_ordinal bigint;
  v_started timestamptz := pg_catalog.clock_timestamp();
begin
  if p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'cc_error:invalid_request'; end if;
  if length(btrim(coalesce(p_customer_name, ''))) = 0 then raise exception 'cc_error:invalid_request'; end if;
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'cc_error:invalid_phone'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'cc_error:invalid_items';
  end if;

  -- Same order key and same phone are serialized; always in this order to avoid deadlocks.
  perform pg_advisory_xact_lock(hashtextextended('cc_public_order:' || p_business_id::text || ':' || p_client_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('cc_public_customer:' || p_business_id::text || ':' || v_key, 0));

  select * into v_order from public.public_photo_orders o
  where o.business_id = p_business_id and o.client_key = p_client_key for update;
  v_exists := found;
  if v_exists and v_order.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'order_id', v_order.id, 'job_id', v_order.photo_job_id);
  end if;

  -- Validate every line against the catalog before touching anything.
  for v_entry in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry -> 'quantity') <> 'number' or jsonb_typeof(v_entry -> 'expected_unit_price_cents') <> 'number' then
      raise exception 'cc_error:invalid_items';
    end if;
    v_qty := (v_entry ->> 'quantity')::integer;
    if v_qty < 1 or v_qty > 1000 then raise exception 'cc_error:invalid_quantity'; end if;
    select * into v_service from public.photo_services s
    where s.business_id = p_business_id and s.id = (v_entry ->> 'service_id')::uuid;
    if not found or not v_service.is_active or not v_service.is_public or not v_service.public_order_enabled then
      raise exception 'cc_error:service_unavailable';
    end if;
    if v_service.id = any(v_service_ids) then raise exception 'cc_error:invalid_items'; end if;
    if (v_entry ->> 'expected_unit_price_cents')::bigint <> v_service.default_unit_price_cents then
      raise exception 'cc_error:price_changed';
    end if;
    v_service_ids := v_service_ids || v_service.id;
  end loop;

  -- Customer: reuse the Business customer with the same phone, never edit it.
  select c.id into v_customer from public.customers c
  where c.business_id = p_business_id and c.is_active and c.phone_match_key = v_key
  order by c.created_at, c.id limit 1;
  if v_customer is null then
    v_email := case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end;
    insert into public.customers(id, business_id, full_name, phone, email)
    values (gen_random_uuid(), p_business_id, btrim(p_customer_name), p_phone_display, v_email)
    returning id into v_customer;
  end if;

  v_job_notes := nullif('Nota del cliente (web): ' || btrim(coalesce(p_notes, '')), 'Nota del cliente (web): ');

  if not v_exists then
    select b.id into v_branch from public.branches b
    where b.business_id = p_business_id and b.is_active order by b.created_at, b.id limit 1;
    if v_branch is null then raise exception 'cc_error:no_branch'; end if;
    -- photo_jobs.created_by is NOT NULL (and mirrored in Desktop SQLite): the technical
    -- creator of a web order is the Business owner; the real origin is source_channel.
    select m.user_id into v_creator from public.business_memberships m
    where m.business_id = p_business_id and m.is_active and m.role in ('owner','admin')
    order by (m.role = 'owner') desc, m.created_at, m.id limit 1;
    if v_creator is null then raise exception 'cc_error:no_owner'; end if;
    insert into public.photo_jobs(id, business_id, branch_id, customer_id, status, priority, notes,
      file_intake_status, source_channel, is_draft, created_by)
    values (gen_random_uuid(), p_business_id, v_branch, v_customer, 'received', 'normal', v_job_notes,
      'awaiting_files', 'public_web', true, v_creator)
    returning id into v_job;
    insert into public.public_photo_orders(business_id, photo_job_id, customer_id, client_key, customer_name,
      whatsapp_e164, whatsapp_opt_in, whatsapp_opt_in_at, contact_email, client_ip_hash)
    values (p_business_id, v_job, v_customer, p_client_key, btrim(p_customer_name), p_phone_e164,
      p_whatsapp_opt_in, case when p_whatsapp_opt_in then pg_catalog.clock_timestamp() end,
      case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end, p_ip_hash)
    returning * into v_order;
  else
    -- Refresh of a draft (reload, retry, corrected phone). Same job, same order.
    v_job := v_order.photo_job_id;
    update public.photo_jobs set customer_id = v_customer, notes = v_job_notes
    where business_id = p_business_id and id = v_job;
    update public.public_photo_orders set
      status = 'draft', abandoned_at = null, customer_id = v_customer,
      customer_name = btrim(p_customer_name), whatsapp_e164 = p_phone_e164,
      whatsapp_opt_in = p_whatsapp_opt_in,
      whatsapp_opt_in_at = case when p_whatsapp_opt_in then coalesce(v_order.whatsapp_opt_in_at, pg_catalog.clock_timestamp()) end,
      contact_email = case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_order.id;
    -- The browser lost its in-flight uploads when it reloaded: they can never finish.
    update public.photo_job_files set status = 'failed'
    where business_id = p_business_id and photo_job_id = v_job and status in ('pending', 'uploading');
  end if;

  -- Items: one per service, snapshot from the catalog row read above (never from the caller).
  -- created_at follows the order sent (microsecond steps), so lists keep a stable order.
  for v_entry, v_ordinal in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    select * into v_service from public.photo_services s
    where s.business_id = p_business_id and s.id = (v_entry ->> 'service_id')::uuid;
    v_qty := (v_entry ->> 'quantity')::integer;
    select i.id into v_item from public.photo_job_items i
    where i.business_id = p_business_id and i.photo_job_id = v_job and i.photo_service_id = v_service.id
    order by i.created_at, i.id limit 1;
    if v_item is null then
      insert into public.photo_job_items(id, business_id, photo_job_id, photo_service_id, service_name_snapshot,
        quantity, unit_price_cents, total_cents, width_mm, height_mm, is_active, created_at)
      values (gen_random_uuid(), p_business_id, v_job, v_service.id, coalesce(v_service.public_name, v_service.name),
        v_qty, v_service.default_unit_price_cents, v_qty * v_service.default_unit_price_cents,
        v_service.width_mm, v_service.height_mm, true,
        v_started + v_ordinal * interval '1 microsecond');
    else
      update public.photo_job_items set
        service_name_snapshot = coalesce(v_service.public_name, v_service.name), quantity = v_qty,
        unit_price_cents = v_service.default_unit_price_cents,
        total_cents = v_qty * v_service.default_unit_price_cents,
        width_mm = v_service.width_mm, height_mm = v_service.height_mm, is_active = true
      where id = v_item;
    end if;
  end loop;
  -- Services dropped on a refresh stop counting, unless files were already attached to them.
  update public.photo_job_items i set is_active = false
  where i.business_id = p_business_id and i.photo_job_id = v_job and i.is_active
    and not (i.photo_service_id = any(v_service_ids))
    and not exists(
      select 1 from public.photo_job_files f
      where f.business_id = i.business_id and f.photo_job_item_id = i.id and f.status in ('pending','uploading','uploaded')
    );

  -- New upload capability; the previous upload links of this job stop working.
  insert into public.photo_job_upload_links(business_id, photo_job_id, token_hash, created_by, expires_at, purpose)
  values (p_business_id, v_job, p_token_hash, null, p_link_expires_at, 'upload')
  returning id into v_link;
  update public.photo_job_upload_links set revoked_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id and photo_job_id = v_job and purpose = 'upload'
    and revoked_at is null and id <> v_link;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'service_id', i.photo_service_id, 'name', i.service_name_snapshot,
      'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents
    ) order by i.created_at, i.id), '[]'::jsonb),
    coalesce(sum(i.total_cents), 0)
  into v_items, v_total
  from public.photo_job_items i
  where i.business_id = p_business_id and i.photo_job_id = v_job and i.is_active;

  return jsonb_build_object(
    'status', 'draft', 'order_id', v_order.id, 'job_id', v_job, 'link_id', v_link,
    'customer_id', v_customer, 'items', v_items, 'total_cents', v_total
  );
end;
$$;
revoke all on function public.cc_public_order_start(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_public_order_start(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  to service_role;

-- 8. Confirms a public order atomically and idempotently. The quantity of every item is
--    DERIVED from the uploaded files (sum of copies), the job leaves draft state, the intake
--    becomes `submitted`, and a read-only tracking link is issued. Replaying it changes
--    nothing but issues one more tracking link (the plaintext is only ever in the response).
create function public.cc_public_order_confirm(
  p_business_id uuid,
  p_job_id uuid,
  p_upload_link_id uuid,
  p_tracking_token_hash text,
  p_tracking_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_item public.photo_job_items%rowtype;
  v_copies bigint;
  v_active integer := 0;
  v_tracking uuid;
  v_already boolean;
  v_items jsonb;
  v_total bigint;
begin
  select * into v_order from public.public_photo_orders o
  where o.business_id = p_business_id and o.photo_job_id = p_job_id for update;
  if not found then raise exception 'cc_error:order_not_found'; end if;
  v_already := v_order.status = 'submitted';

  if not v_already then
    if exists(select 1 from public.photo_job_files f
      where f.business_id = p_business_id and f.photo_job_id = p_job_id and f.status in ('pending','uploading')) then
      raise exception 'cc_error:uploads_pending';
    end if;
    for v_item in select * from public.photo_job_items i
      where i.business_id = p_business_id and i.photo_job_id = p_job_id order by i.created_at, i.id loop
      select coalesce(sum(f.copies), 0) into v_copies from public.photo_job_files f
      where f.business_id = p_business_id and f.photo_job_item_id = v_item.id and f.status = 'uploaded';
      if v_copies > 0 then
        v_active := v_active + 1;
        update public.photo_job_items set quantity = v_copies::integer,
          total_cents = v_copies * unit_price_cents, is_active = true
        where id = v_item.id;
      else
        update public.photo_job_items set is_active = false where id = v_item.id;
      end if;
    end loop;
    if v_active = 0 then raise exception 'cc_error:no_files'; end if;

    update public.photo_jobs set is_draft = false, file_intake_status = 'submitted'
    where business_id = p_business_id and id = p_job_id;
    -- Rows hidden while draft get a fresh version so Desktop's incremental pull sees them.
    update public.photo_job_files set status = status
    where business_id = p_business_id and photo_job_id = p_job_id;
    update public.public_photo_orders set status = 'submitted', submitted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
    where id = v_order.id;
    update public.photo_job_upload_links set submitted_at = coalesce(submitted_at, pg_catalog.clock_timestamp())
    where id = p_upload_link_id and business_id = p_business_id;
  end if;

  if (select count(*) from public.photo_job_upload_links l
      where l.business_id = p_business_id and l.photo_job_id = p_job_id and l.purpose = 'tracking') >= 20 then
    raise exception 'cc_error:too_many_links';
  end if;
  insert into public.photo_job_upload_links(business_id, photo_job_id, token_hash, created_by, expires_at, purpose,
    submitted_at)
  values (p_business_id, p_job_id, p_tracking_token_hash, null, p_tracking_expires_at, 'tracking',
    pg_catalog.clock_timestamp())
  returning id into v_tracking;

  select coalesce(jsonb_agg(jsonb_build_object('name', i.service_name_snapshot, 'quantity', i.quantity,
      'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents) order by i.created_at, i.id), '[]'::jsonb),
    coalesce(sum(i.total_cents), 0)
  into v_items, v_total
  from public.photo_job_items i
  where i.business_id = p_business_id and i.photo_job_id = p_job_id and i.is_active;

  return jsonb_build_object('status', 'submitted', 'already_submitted', v_already, 'order_id', v_order.id,
    'tracking_link_id', v_tracking, 'items', v_items, 'total_cents', v_total);
end;
$$;
revoke all on function public.cc_public_order_confirm(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_public_order_confirm(uuid, uuid, uuid, text, timestamptz) to service_role;

-- 9. Abandoned-draft policy. Nothing is deleted: a draft whose upload window passed is only
--    marked `abandoned` and its upload links are revoked, so it stays auditable and a later
--    cleanup (or a customer retry with the same client key) can decide what to do. Not
--    scheduled here: run it manually or from pg_cron once the retention period is agreed.
create function public.cc_public_order_mark_abandoned(p_older_than interval) returns integer
language plpgsql security definer set search_path=''
as $$
declare v_count integer;
begin
  if p_older_than < interval '1 day' then raise exception 'cc_error:invalid_request'; end if;
  with stale as (
    update public.public_photo_orders set status = 'abandoned', abandoned_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
    where status = 'draft' and updated_at < pg_catalog.clock_timestamp() - p_older_than
    returning business_id, photo_job_id
  ), revoked as (
    update public.photo_job_upload_links l set revoked_at = coalesce(l.revoked_at, pg_catalog.clock_timestamp())
    from stale s
    where l.business_id = s.business_id and l.photo_job_id = s.photo_job_id and l.purpose = 'upload'
    returning l.id
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;
revoke all on function public.cc_public_order_mark_abandoned(interval) from public, anon, authenticated;
grant execute on function public.cc_public_order_mark_abandoned(interval) to service_role;

-- 10. Edge Functions read these (service_role never writes them directly).
--     photo_job_upload_links already grants select/insert/update; public_photo_orders select above.
