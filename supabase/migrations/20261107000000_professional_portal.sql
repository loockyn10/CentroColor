-- Professional portal (/profesionales).
--
-- A professional is an Auth user LINKED to an existing Customer; the Customer's own price list
-- (Profesional, or a custom "Convenio") decides what they pay. The link is server-managed:
-- nothing the browser sends can pick a list, a customer or a payment term.
--
-- Professionals deliberately have NO business_membership. Every administrative RLS policy keys
-- on an active membership, so a professional's JWT reads nothing from the panel tables, and the
-- triggers below make the two kinds of account mutually exclusive.
--
-- Additive only: nothing here rewrites an existing row. Desktop (SQLite) needs no migration:
-- professional orders are ordinary `public_web` PhotoJobs and the new columns are Cloud-only.

create table public.professional_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  -- Set by CentroColor per client. Being signed in never grants "pay later".
  allow_deferred_payment boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id),
  unique(business_id, id),
  foreign key(business_id, customer_id) references public.customers(business_id, id) on delete restrict
);
create index professional_accounts_customer_idx on public.professional_accounts(business_id, customer_id);
alter table public.professional_accounts enable row level security;
-- No client policy and no client grant: the owner/admin screen goes through an Edge Function.
revoke all on public.professional_accounts from public, anon, authenticated;
grant select, insert, update on public.professional_accounts to service_role;

-- A user is either staff (membership) or a professional, never both.
create function private.professional_account_not_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.business_memberships m where m.user_id = new.user_id) then
    raise exception 'cc_error:user_is_member';
  end if;
  return new;
end;
$$;
revoke all on function private.professional_account_not_member() from public, anon, authenticated;
create trigger professional_account_not_member before insert or update of user_id on public.professional_accounts
for each row execute function private.professional_account_not_member();

create function private.membership_not_professional() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.professional_accounts a where a.user_id = new.user_id) then
    raise exception 'cc_error:user_is_professional';
  end if;
  return new;
end;
$$;
revoke all on function private.membership_not_professional() from public, anon, authenticated;
create trigger membership_not_professional before insert or update of user_id on public.business_memberships
for each row execute function private.membership_not_professional();

-- Payment terms and ownership of a professional order. Public orders keep both NULL.
alter table public.public_photo_orders
  add column professional_account_id uuid references public.professional_accounts(id) on delete set null,
  add column payment_terms text check(payment_terms in ('prepaid', 'deferred')),
  add constraint public_photo_orders_professional_terms
    check(professional_account_id is null or payment_terms is not null);
create index public_photo_orders_professional_idx
  on public.public_photo_orders(business_id, professional_account_id, created_at)
  where professional_account_id is not null;
-- Staff see how an order is to be paid; the account id itself stays server-side.
grant select(payment_terms) on public.public_photo_orders to authenticated;

/* ───────────────────────────── Edge-only helpers ───────────────────────────── */

-- Auth user for an e-mail (case-insensitive). service_role only: used to link an account.
create function public.cc_auth_user_by_email(p_email text) returns uuid
language sql stable security definer set search_path='' as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1
$$;
revoke all on function public.cc_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.cc_auth_user_by_email(text) to service_role;

-- The account behind a verified JWT, with the price list the server authorizes for it.
-- `price_list_usable` is false when the Customer has no list, or only the public one: a
-- professional is never silently priced at the public list.
create function public.cc_professional_context(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'account_id', a.id, 'business_id', a.business_id, 'customer_id', c.id,
    'customer_name', c.full_name, 'customer_phone', c.phone,
    'allow_deferred_payment', a.allow_deferred_payment,
    'price_list_id', p.id, 'price_list_name', p.name, 'price_list_kind', p.kind,
    'price_list_usable', coalesce(p.is_active and p.kind <> 'public', false)
  )
  from public.professional_accounts a
  join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
  left join public.price_lists p on p.business_id = c.business_id and p.id = c.price_list_id
  where a.user_id = p_user_id and a.is_active and c.is_active
$$;
revoke all on function public.cc_professional_context(uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_context(uuid) to service_role;

-- Catalog with the tiers of ONE explicit, non-public list (never the default list).
create function public.cc_professional_lab_catalog(p_business_id uuid, p_price_list_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', case when v.paper='glossy' then s.id else v.id end,
    'variant_id', v.id, 'photo_service_id', s.id,
    'name', coalesce(s.public_name, s.name) || ' · ' || case v.paper when 'matte' then 'Mate' else 'Brillo' end,
    'description', s.public_description, 'width_mm', s.width_mm, 'height_mm', s.height_mm,
    'sort_order', s.public_sort_order, 'paper', v.paper,
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('min_quantity', t.min_quantity,
      'max_quantity', t.max_quantity, 'unit_price_cents', t.unit_price_cents) order by t.min_quantity), '[]'::jsonb)
      from public.lab_price_tiers t
      where t.business_id = v.business_id and t.variant_id = v.id and t.price_list_id = p.id)
  ) order by s.public_sort_order, s.name, v.paper), '[]'::jsonb)
  from public.price_lists p
  join public.lab_variants v on v.business_id = p.business_id
  join public.photo_services s on s.business_id = v.business_id and s.id = v.photo_service_id
  where p.business_id = p_business_id and p.id = p_price_list_id and p.is_active and p.kind <> 'public'
    and v.channel = 'laboratory' and v.is_active
    and s.is_active and s.workflow_route = 'lab' and s.requires_customer_files
$$;
revoke all on function public.cc_professional_lab_catalog(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_lab_catalog(uuid, uuid) to service_role;

/* ───────────────────────────── account administration ───────────────────────────── */

create function public.cc_professional_list(p_business_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'user_id', a.user_id, 'email', u.email,
    'customer_id', c.id, 'customer_name', c.full_name,
    'price_list_id', p.id, 'price_list_name', p.name, 'price_list_kind', p.kind,
    'price_list_usable', coalesce(p.is_active and p.kind <> 'public', false),
    'allow_deferred_payment', a.allow_deferred_payment, 'is_active', a.is_active,
    'created_at', a.created_at
  ) order by c.full_name, u.email), '[]'::jsonb)
  from public.professional_accounts a
  join public.customers c on c.business_id = a.business_id and c.id = a.customer_id
  join auth.users u on u.id = a.user_id
  left join public.price_lists p on p.business_id = c.business_id and p.id = c.price_list_id
  where a.business_id = p_business_id
$$;
revoke all on function public.cc_professional_list(uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_list(uuid) to service_role;

-- A Customer can be given portal access only when it already holds a Profesional/Convenio list.
-- Checked before inviting anybody, so a refused link never sends an e-mail.
create function public.cc_professional_check_customer(p_business_id uuid, p_customer_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare
  v_customer public.customers%rowtype;
  v_list public.price_lists%rowtype;
begin
  select * into v_customer from public.customers c
  where c.business_id = p_business_id and c.id = p_customer_id and c.is_active;
  if not found then raise exception 'cc_error:customer_not_found'; end if;
  select * into v_list from public.price_lists l
  where l.business_id = p_business_id and l.id = v_customer.price_list_id;
  if not found or not v_list.is_active or v_list.kind = 'public' then
    raise exception 'cc_error:price_list_required';
  end if;
end;
$$;
revoke all on function public.cc_professional_check_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_check_customer(uuid, uuid) to service_role;

-- Links an Auth user to a Customer (see the check above).
create function public.cc_professional_link(
  p_business_id uuid, p_user_id uuid, p_customer_id uuid, p_allow_deferred boolean, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_existing public.professional_accounts%rowtype;
  v_id uuid;
begin
  perform public.cc_professional_check_customer(p_business_id, p_customer_id);
  select * into v_existing from public.professional_accounts a where a.user_id = p_user_id for update;
  if found then
    if v_existing.business_id <> p_business_id or v_existing.customer_id <> p_customer_id then
      raise exception 'cc_error:already_linked';
    end if;
    update public.professional_accounts set is_active = true, allow_deferred_payment = coalesce(p_allow_deferred, false),
      updated_at = pg_catalog.clock_timestamp() where id = v_existing.id;
    return v_existing.id;
  end if;
  insert into public.professional_accounts(business_id, user_id, customer_id, allow_deferred_payment, created_by)
  values (p_business_id, p_user_id, p_customer_id, coalesce(p_allow_deferred, false), p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cc_professional_link(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_link(uuid, uuid, uuid, boolean, uuid) to service_role;

-- NULL leaves a field as it is.
create function public.cc_professional_update(
  p_business_id uuid, p_account_id uuid, p_is_active boolean, p_allow_deferred boolean
) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.professional_accounts set
    is_active = coalesce(p_is_active, is_active),
    allow_deferred_payment = coalesce(p_allow_deferred, allow_deferred_payment),
    updated_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id and id = p_account_id;
  if not found then raise exception 'cc_error:account_not_found'; end if;
end;
$$;
revoke all on function public.cc_professional_update(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.cc_professional_update(uuid, uuid, boolean, boolean) to service_role;

/* ───────────────────────────── professional order ───────────────────────────── */

-- Starts (or refreshes) a professional order in ONE transaction. Same shape as
-- cc_public_order_start, with three differences that are the whole point of the portal:
--   * the Customer is the account's own (no phone matching, nothing is created);
--   * every price comes from the Customer's CURRENT list, never from the default one;
--   * the payment terms are decided here, from the account, and snapshotted on the order.
-- Prices are never taken from the caller: it only states the price it displayed.
create function public.cc_professional_order_start(
  p_account_id uuid,
  p_client_key text,
  p_whatsapp_e164 text,
  p_notes text,
  p_ip_hash text,
  p_items jsonb,
  p_token_hash text,
  p_link_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_account public.professional_accounts%rowtype;
  v_customer public.customers%rowtype;
  v_list public.price_lists%rowtype;
  v_order public.public_photo_orders%rowtype;
  v_exists boolean;
  v_service public.photo_services%rowtype;
  v_variant public.lab_variants%rowtype;
  v_unit_price bigint;
  v_snapshot_name text;
  v_variant_ids uuid[] := '{}';
  v_entry jsonb;
  v_qty integer;
  v_terms text;
  v_branch uuid;
  v_creator uuid;
  v_job uuid;
  v_link uuid;
  v_item uuid;
  v_job_notes text;
  v_items jsonb;
  v_total bigint;
  v_ordinal bigint;
  v_started timestamptz := pg_catalog.clock_timestamp();
begin
  if p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'cc_error:invalid_request'; end if;
  if p_whatsapp_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'cc_error:invalid_phone'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'cc_error:invalid_items';
  end if;

  select * into v_account from public.professional_accounts a where a.id = p_account_id;
  if not found or not v_account.is_active then raise exception 'cc_error:account_inactive'; end if;
  select * into v_customer from public.customers c
  where c.business_id = v_account.business_id and c.id = v_account.customer_id and c.is_active;
  if not found then raise exception 'cc_error:account_inactive'; end if;
  select * into v_list from public.price_lists l
  where l.business_id = v_customer.business_id and l.id = v_customer.price_list_id;
  if not found or not v_list.is_active or v_list.kind = 'public' then
    raise exception 'cc_error:no_professional_list';
  end if;
  v_terms := case when v_account.allow_deferred_payment then 'deferred' else 'prepaid' end;

  perform pg_advisory_xact_lock(hashtextextended('cc_public_order:' || v_account.business_id::text || ':' || p_client_key, 0));

  select * into v_order from public.public_photo_orders o
  where o.business_id = v_account.business_id and o.client_key = p_client_key for update;
  v_exists := found;
  -- A key belongs to the account that created it: nobody can take over another's draft.
  if v_exists and v_order.professional_account_id is distinct from v_account.id then
    raise exception 'cc_error:invalid_request';
  end if;
  if v_exists and v_order.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'order_id', v_order.id, 'job_id', v_order.photo_job_id);
  end if;

  -- Validate every line against the account's list before touching anything.
  for v_entry in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry -> 'quantity') <> 'number' or jsonb_typeof(v_entry -> 'expected_unit_price_cents') <> 'number'
       or not (v_entry ? 'variant_id') then
      raise exception 'cc_error:invalid_items';
    end if;
    v_qty := (v_entry ->> 'quantity')::integer;
    if v_qty < 1 or v_qty > 50000 then raise exception 'cc_error:invalid_quantity'; end if;
    select * into v_variant from public.lab_variants v
    where v.business_id = v_account.business_id and v.id = (v_entry ->> 'variant_id')::uuid
      and v.channel = 'laboratory' and v.is_active;
    if not found then raise exception 'cc_error:service_unavailable'; end if;
    select * into v_service from public.photo_services s
    where s.business_id = v_account.business_id and s.id = v_variant.photo_service_id;
    if not found or not v_service.is_active or v_service.workflow_route <> 'lab' or not v_service.requires_customer_files
       or (v_entry ->> 'service_id')::uuid <> (case when v_variant.paper = 'glossy' then v_service.id else v_variant.id end) then
      raise exception 'cc_error:service_unavailable';
    end if;
    if v_variant.id = any(v_variant_ids) then raise exception 'cc_error:invalid_items'; end if;
    select t.unit_price_cents into v_unit_price from public.lab_price_tiers t
    where t.business_id = v_account.business_id and t.variant_id = v_variant.id and t.price_list_id = v_list.id
      and t.min_quantity <= v_qty and (t.max_quantity is null or t.max_quantity >= v_qty);
    if not found then raise exception 'cc_error:service_unavailable'; end if;
    if (v_entry ->> 'expected_unit_price_cents')::bigint <> v_unit_price then
      raise exception 'cc_error:price_changed';
    end if;
    v_variant_ids := v_variant_ids || v_variant.id;
  end loop;

  v_job_notes := 'Pedido profesional (web) · ' || case v_terms
    when 'deferred' then 'pago posterior autorizado' else 'pago previo por transferencia' end
    || coalesce(E'\n' || nullif('Nota del cliente (web): ' || btrim(coalesce(p_notes, '')), 'Nota del cliente (web): '), '');

  if not v_exists then
    select b.id into v_branch from public.branches b
    where b.business_id = v_account.business_id and b.is_active order by b.created_at, b.id limit 1;
    if v_branch is null then raise exception 'cc_error:no_branch'; end if;
    -- photo_jobs.created_by is NOT NULL: the technical creator is the Business owner; the real
    -- origin is source_channel + public_photo_orders.professional_account_id.
    select m.user_id into v_creator from public.business_memberships m
    where m.business_id = v_account.business_id and m.is_active and m.role in ('owner','admin')
    order by (m.role = 'owner') desc, m.created_at, m.id limit 1;
    if v_creator is null then raise exception 'cc_error:no_owner'; end if;
    insert into public.photo_jobs(id, business_id, branch_id, customer_id, status, priority, notes,
      file_intake_status, source_channel, is_draft, created_by)
    values (gen_random_uuid(), v_account.business_id, v_branch, v_customer.id, 'received', 'normal', v_job_notes,
      'awaiting_files', 'public_web', true, v_creator)
    returning id into v_job;
    insert into public.public_photo_orders(business_id, photo_job_id, customer_id, client_key, customer_name,
      whatsapp_e164, whatsapp_opt_in, whatsapp_opt_in_at, client_ip_hash, professional_account_id, payment_terms)
    values (v_account.business_id, v_job, v_customer.id, p_client_key, v_customer.full_name,
      p_whatsapp_e164, true, pg_catalog.clock_timestamp(), p_ip_hash, v_account.id, v_terms)
    returning * into v_order;
  else
    v_job := v_order.photo_job_id;
    update public.photo_jobs set customer_id = v_customer.id, notes = v_job_notes
    where business_id = v_account.business_id and id = v_job;
    update public.public_photo_orders set
      status = 'draft', abandoned_at = null, customer_id = v_customer.id,
      customer_name = v_customer.full_name, whatsapp_e164 = p_whatsapp_e164,
      whatsapp_opt_in = true, whatsapp_opt_in_at = coalesce(v_order.whatsapp_opt_in_at, pg_catalog.clock_timestamp()),
      payment_terms = v_terms, updated_at = pg_catalog.clock_timestamp()
    where id = v_order.id;
    -- The browser lost its in-flight uploads when it reloaded: they can never finish.
    update public.photo_job_files set status = 'failed'
    where business_id = v_account.business_id and photo_job_id = v_job and status in ('pending', 'uploading');
  end if;

  for v_entry, v_ordinal in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    v_qty := (v_entry ->> 'quantity')::integer;
    select * into v_variant from public.lab_variants v
    where v.business_id = v_account.business_id and v.id = (v_entry ->> 'variant_id')::uuid;
    select * into v_service from public.photo_services s
    where s.business_id = v_account.business_id and s.id = v_variant.photo_service_id;
    select t.unit_price_cents into v_unit_price from public.lab_price_tiers t
    where t.business_id = v_account.business_id and t.variant_id = v_variant.id and t.price_list_id = v_list.id
      and t.min_quantity <= v_qty and (t.max_quantity is null or t.max_quantity >= v_qty);
    v_snapshot_name := coalesce(v_service.public_name, v_service.name) || ' · ' ||
      case v_variant.paper when 'matte' then 'Mate' else 'Brillo' end || ' · ' || v_list.name;
    select i.id into v_item from public.photo_job_items i
    where i.business_id = v_account.business_id and i.photo_job_id = v_job and i.lab_variant_id = v_variant.id
    order by i.created_at, i.id limit 1;
    if v_item is null then
      insert into public.photo_job_items(id, business_id, photo_job_id, photo_service_id, lab_variant_id,
        price_list_id, service_name_snapshot, quantity, unit_price_cents, total_cents,
        width_mm, height_mm, is_active, created_at)
      values (gen_random_uuid(), v_account.business_id, v_job, v_service.id, v_variant.id,
        v_list.id, v_snapshot_name, v_qty, v_unit_price, v_qty * v_unit_price,
        v_service.width_mm, v_service.height_mm, true,
        v_started + v_ordinal * interval '1 microsecond');
    else
      update public.photo_job_items set
        service_name_snapshot = v_snapshot_name, quantity = v_qty,
        price_list_id = v_list.id, unit_price_cents = v_unit_price,
        total_cents = v_qty * v_unit_price,
        width_mm = v_service.width_mm, height_mm = v_service.height_mm, is_active = true
      where id = v_item;
    end if;
  end loop;
  -- Sizes dropped on a refresh stop counting, unless files were already attached to them.
  update public.photo_job_items i set is_active = false
  where i.business_id = v_account.business_id and i.photo_job_id = v_job and i.is_active
    and not (i.lab_variant_id = any(v_variant_ids))
    and not exists(
      select 1 from public.photo_job_files f
      where f.business_id = i.business_id and f.photo_job_item_id = i.id and f.status in ('pending','uploading','uploaded')
    );

  insert into public.photo_job_upload_links(business_id, photo_job_id, token_hash, created_by, expires_at, purpose)
  values (v_account.business_id, v_job, p_token_hash, null, p_link_expires_at, 'upload')
  returning id into v_link;
  update public.photo_job_upload_links set revoked_at = pg_catalog.clock_timestamp()
  where business_id = v_account.business_id and photo_job_id = v_job and purpose = 'upload'
    and revoked_at is null and id <> v_link;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'service_id', case when v.paper = 'matte' then i.lab_variant_id else i.photo_service_id end,
      'name', i.service_name_snapshot, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents,
      'total_cents', i.total_cents
    ) order by i.created_at, i.id), '[]'::jsonb),
    coalesce(sum(i.total_cents), 0)
  into v_items, v_total
  from public.photo_job_items i left join public.lab_variants v
    on v.business_id = i.business_id and v.id = i.lab_variant_id
  where i.business_id = v_account.business_id and i.photo_job_id = v_job and i.is_active;

  return jsonb_build_object(
    'status', 'draft', 'order_id', v_order.id, 'job_id', v_job, 'link_id', v_link,
    'customer_id', v_customer.id, 'items', v_items, 'total_cents', v_total, 'payment_terms', v_terms
  );
end;
$$;
revoke all on function public.cc_professional_order_start(uuid, text, text, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_professional_order_start(uuid, text, text, text, text, jsonb, text, timestamptz)
  to service_role;
