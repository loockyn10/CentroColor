-- Hardening of the anonymous professional request (follow-up to 20261108000000_professional_requests.sql).
--
-- 1. An anonymous request is NEVER linked to an existing Customer because the phone matches: anyone
--    can type any number. Each request gets its own unverified Customer (photo_jobs.customer_id is NOT
--    NULL here and in Desktop) and the match is only a suggestion for staff
--    (photo_job_customer_matches). `quote_photo_job` now REQUIRES the Customer an administrator
--    confirmed: there is no default.
-- 2. A job waiting for a quote cannot enter production: "in_progress" is blocked as well as
--    "ready"/"delivered". Quote it first, then continue. Cancelling stays possible.
--
-- Only functions are replaced or added: no table or column changes, nothing is rewritten.

/* ───────────────────────────── 1. quote guard: also block in_progress ───────────────────────────── */

create or replace function private.photo_job_quote_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.quote_status := 'quoted';
    else new.quote_status := old.quote_status;
    end if;
  end if;
  -- A job without an amount cannot enter production: it is quoted first and only then continues
  -- (in process → ready → delivered). Starting it would be work done without an agreed price.
  -- Cancelling stays possible.
  if new.quote_status = 'pending_quote' and new.status in ('in_progress', 'ready', 'delivered')
     and current_user in ('authenticated', 'anon') then
    raise exception 'El pedido está pendiente de presupuestar: presupuestalo antes de pasarlo a «En proceso», listo o entregado.';
  end if;
  return new;
end;
$$;

/* ───────────────────────────── 2. anonymous request: its own unverified Customer ───────────────────────────── */

create or replace function public.cc_professional_request_start(
  p_business_id uuid,
  p_client_key text,
  p_customer_name text,
  p_phone_e164 text,
  p_phone_display text,
  p_email text,
  p_notes text,
  p_ip_hash text,
  p_items jsonb,
  p_token_hash text,
  p_link_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_exists boolean;
  v_service public.photo_services%rowtype;
  v_variant public.lab_variants%rowtype;
  v_variant_ids uuid[] := '{}';
  v_entry jsonb;
  v_qty integer;
  v_customer uuid;
  v_branch uuid;
  v_creator uuid;
  v_job uuid;
  v_link uuid;
  v_item uuid;
  v_job_notes text;
  v_email text;
  v_snapshot_name text;
  v_items jsonb;
  v_ordinal bigint;
  v_started timestamptz := pg_catalog.clock_timestamp();
begin
  if p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'cc_error:invalid_request'; end if;
  if length(btrim(coalesce(p_customer_name, ''))) = 0 then raise exception 'cc_error:invalid_request'; end if;
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'cc_error:invalid_phone'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'cc_error:invalid_items';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cc_public_order:' || p_business_id::text || ':' || p_client_key, 0));

  select * into v_order from public.public_photo_orders o
  where o.business_id = p_business_id and o.client_key = p_client_key for update;
  v_exists := found;
  -- A key belongs to the kind of order that created it: it can never reopen another portal's draft.
  if v_exists and (v_order.portal <> 'profesionales' or v_order.professional_account_id is not null) then
    raise exception 'cc_error:invalid_request';
  end if;
  if v_exists and v_order.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'order_id', v_order.id, 'job_id', v_order.photo_job_id);
  end if;

  for v_entry in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry -> 'quantity') <> 'number' or not (v_entry ? 'variant_id') or not (v_entry ? 'service_id') then
      raise exception 'cc_error:invalid_items';
    end if;
    v_qty := (v_entry ->> 'quantity')::integer;
    if v_qty < 1 or v_qty > 50000 then raise exception 'cc_error:invalid_quantity'; end if;
    select * into v_variant from public.lab_variants v
    where v.business_id = p_business_id and v.id = (v_entry ->> 'variant_id')::uuid;
    if not found or not private.cc_professional_orderable(p_business_id, v_variant.id) then
      raise exception 'cc_error:service_unavailable';
    end if;
    select * into v_service from public.photo_services s
    where s.business_id = p_business_id and s.id = v_variant.photo_service_id;
    if (v_entry ->> 'service_id')::uuid <> (case when v_variant.paper = 'glossy' then v_service.id else v_variant.id end) then
      raise exception 'cc_error:service_unavailable';
    end if;
    if v_variant.id = any(v_variant_ids) then raise exception 'cc_error:invalid_items'; end if;
    v_variant_ids := v_variant_ids || v_variant.id;
  end loop;

  -- Customer: an anonymous visitor is NEVER attached to an existing customer, not even to one with
  -- the same phone: anyone can type any number. Photos and a price list would otherwise land in a real
  -- customer's account. Each request gets its own unverified Customer (photo_jobs.customer_id is
  -- NOT NULL, here and in Desktop), marked as such. A match by phone is only a suggestion that staff
  -- see in «Presupuestar» (photo_job_customer_matches); linking needs an administrator to confirm.
  -- A retry of the same request keeps (and refreshes) the Customer it created.
  v_email := case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end;
  if v_exists then
    v_customer := v_order.customer_id;
    update public.customers set full_name = btrim(p_customer_name), phone = p_phone_display, email = v_email
    where business_id = p_business_id and id = v_customer and notes like 'Alta automática desde solicitud profesional web%';
  else
    insert into public.customers(id, business_id, full_name, phone, email, notes)
    values (gen_random_uuid(), p_business_id, btrim(p_customer_name), p_phone_display, v_email,
      'Alta automática desde solicitud profesional web (sin verificar). Confirmar contra los clientes existentes antes de presupuestar.')
    returning id into v_customer;
  end if;

  v_job_notes := 'Solicitud profesional (web, sin cuenta) · pendiente de presupuestar'
    || coalesce(E'\n' || nullif('Nota del cliente (web): ' || btrim(coalesce(p_notes, '')), 'Nota del cliente (web): '), '');

  if not v_exists then
    select b.id into v_branch from public.branches b
    where b.business_id = p_business_id and b.is_active order by b.created_at, b.id limit 1;
    if v_branch is null then raise exception 'cc_error:no_branch'; end if;
    select m.user_id into v_creator from public.business_memberships m
    where m.business_id = p_business_id and m.is_active and m.role in ('owner','admin')
    order by (m.role = 'owner') desc, m.created_at, m.id limit 1;
    if v_creator is null then raise exception 'cc_error:no_owner'; end if;
    insert into public.photo_jobs(id, business_id, branch_id, customer_id, status, priority, notes,
      file_intake_status, source_channel, is_draft, quote_status, created_by)
    values (gen_random_uuid(), p_business_id, v_branch, v_customer, 'received', 'normal', v_job_notes,
      'awaiting_files', 'public_web', true, 'pending_quote', v_creator)
    returning id into v_job;
    -- No WhatsApp consent is asked on this form, so none is recorded: no automatic notice is promised.
    insert into public.public_photo_orders(business_id, photo_job_id, customer_id, client_key, customer_name,
      whatsapp_e164, whatsapp_opt_in, whatsapp_opt_in_at, contact_email, client_ip_hash, portal)
    values (p_business_id, v_job, v_customer, p_client_key, btrim(p_customer_name), p_phone_e164,
      false, null,
      case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end, p_ip_hash, 'profesionales')
    returning * into v_order;
  else
    v_job := v_order.photo_job_id;
    update public.photo_jobs set customer_id = v_customer, notes = v_job_notes
    where business_id = p_business_id and id = v_job;
    update public.public_photo_orders set
      status = 'draft', abandoned_at = null, customer_id = v_customer,
      customer_name = btrim(p_customer_name), whatsapp_e164 = p_phone_e164,
      contact_email = case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_order.id;
    update public.photo_job_files set status = 'failed'
    where business_id = p_business_id and photo_job_id = v_job and status in ('pending', 'uploading');
  end if;

  for v_entry, v_ordinal in select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
    v_qty := (v_entry ->> 'quantity')::integer;
    select * into v_variant from public.lab_variants v where v.business_id = p_business_id and v.id = (v_entry ->> 'variant_id')::uuid;
    select * into v_service from public.photo_services s where s.business_id = p_business_id and s.id = v_variant.photo_service_id;
    v_snapshot_name := coalesce(v_service.public_name, v_service.name) || ' · ' ||
      case v_variant.paper when 'matte' then 'Mate' else 'Brillo' end || ' · Por presupuestar';
    select i.id into v_item from public.photo_job_items i
    where i.business_id = p_business_id and i.photo_job_id = v_job and i.lab_variant_id = v_variant.id
    order by i.created_at, i.id limit 1;
    if v_item is null then
      insert into public.photo_job_items(id, business_id, photo_job_id, photo_service_id, lab_variant_id,
        price_list_id, service_name_snapshot, quantity, unit_price_cents, total_cents,
        width_mm, height_mm, is_active, created_at)
      values (gen_random_uuid(), p_business_id, v_job, v_service.id, v_variant.id,
        null, v_snapshot_name, v_qty, 0, 0,
        v_service.width_mm, v_service.height_mm, true,
        v_started + v_ordinal * interval '1 microsecond');
    else
      update public.photo_job_items set
        service_name_snapshot = v_snapshot_name, quantity = v_qty, price_list_id = null,
        unit_price_cents = 0, total_cents = 0,
        width_mm = v_service.width_mm, height_mm = v_service.height_mm, is_active = true
      where id = v_item;
    end if;
  end loop;
  update public.photo_job_items i set is_active = false
  where i.business_id = p_business_id and i.photo_job_id = v_job and i.is_active
    and not (i.lab_variant_id = any(v_variant_ids))
    and not exists(
      select 1 from public.photo_job_files f
      where f.business_id = i.business_id and f.photo_job_item_id = i.id and f.status in ('pending','uploading','uploaded')
    );

  insert into public.photo_job_upload_links(business_id, photo_job_id, token_hash, created_by, expires_at, purpose)
  values (p_business_id, v_job, p_token_hash, null, p_link_expires_at, 'upload')
  returning id into v_link;
  update public.photo_job_upload_links set revoked_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id and photo_job_id = v_job and purpose = 'upload'
    and revoked_at is null and id <> v_link;

  -- Deliberately no unit price and no total in the answer.
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'service_id', case when v.paper = 'matte' then i.lab_variant_id else i.photo_service_id end,
      'name', i.service_name_snapshot, 'quantity', i.quantity
    ) order by i.created_at, i.id), '[]'::jsonb)
  into v_items
  from public.photo_job_items i left join public.lab_variants v
    on v.business_id = i.business_id and v.id = i.lab_variant_id
  where i.business_id = p_business_id and i.photo_job_id = v_job and i.is_active;

  return jsonb_build_object(
    'status', 'draft', 'order_id', v_order.id, 'job_id', v_job, 'link_id', v_link,
    'customer_id', v_customer, 'items', v_items
  );
end;
$$;

/* ───────────────────────────── 3. staff: suggestions and confirmed-customer quoting ───────────────────────────── */

-- The previous signature had `p_customer_id uuid default null`; a default cannot be removed in place.
drop function public.quote_photo_job(uuid, uuid, uuid, uuid);

-- Staff-only suggestion: active customers whose phone matches the one typed in the request. It is a
-- hint, never a link: the request keeps its own unverified Customer until an administrator confirms
-- one in `quote_photo_job`. Returns ids only (the panel reads the rest through the customers RLS).
create function public.photo_job_customer_matches(p_business_id uuid, p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid());
  v_job public.photo_jobs%rowtype;
  v_key text;
begin
  if v_user is null or not exists(select 1 from public.business_memberships m
    where m.business_id = p_business_id and m.user_id = v_user and m.is_active and m.role in ('owner','admin')) then
    raise exception 'Sólo owner/admin puede presupuestar pedidos';
  end if;
  select * into v_job from public.photo_jobs j where j.business_id = p_business_id and j.id = p_job_id and not j.is_draft;
  if not found then raise exception 'No se encontró el pedido'; end if;
  select nullif(right(regexp_replace(coalesce(o.whatsapp_e164, ''), '\D', '', 'g'), 10), '') into v_key
  from public.public_photo_orders o where o.business_id = p_business_id and o.photo_job_id = p_job_id;
  if v_key is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', m.id) order by m.created_at, m.id)
    from (
      select c.id, c.created_at from public.customers c
      where c.business_id = p_business_id and c.is_active and c.phone_match_key = v_key
        and c.id <> v_job.customer_id
      order by c.created_at, c.id limit 5
    ) m
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.photo_job_customer_matches(uuid, uuid) from public, anon;
grant execute on function public.photo_job_customer_matches(uuid, uuid) to authenticated;

-- Does anything still reference this Customer? (Probe: a delete that is rolled back. Every foreign
-- key towards customers is restrictive, so it succeeds only for a Customer nobody points to.)
create function private.cc_customer_unreferenced(p_business_id uuid, p_customer_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  begin
    delete from public.customers where business_id = p_business_id and id = p_customer_id;
    raise exception 'cc_probe_unreferenced';
  exception
    when foreign_key_violation then return false;
    when others then
      if sqlerrm = 'cc_probe_unreferenced' then return true; end if;
      raise;
  end;
end;
$$;
revoke all on function private.cc_customer_unreferenced(uuid, uuid) from public, anon, authenticated;

-- Quotes a pending job from ONE explicit price list for ONE explicitly confirmed Customer.
-- Only owner/admin (the people who administer price lists and professional accounts) can run it.
-- The Customer is required, with no default: the request's own unverified Customer is a valid choice
-- ("keep as a new customer") but somebody has to choose it. The amount is computed here from the
-- list's tiers and the copies the photographer asked for; the caller only names the list. A size the
-- list does not price aborts the whole quote.
create function public.quote_photo_job(
  p_business_id uuid, p_job_id uuid, p_price_list_id uuid, p_customer_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid());
  v_job public.photo_jobs%rowtype;
  v_list public.price_lists%rowtype;
  v_customer uuid;
  v_item public.photo_job_items%rowtype;
  v_unit bigint;
  v_total bigint := 0;
  v_base text;
  v_customer_name text;
begin
  if v_user is null or not exists(select 1 from public.business_memberships m
    where m.business_id = p_business_id and m.user_id = v_user and m.is_active and m.role in ('owner','admin')) then
    raise exception 'Sólo owner/admin puede presupuestar pedidos';
  end if;
  select * into v_job from public.photo_jobs j where j.business_id = p_business_id and j.id = p_job_id for update;
  if not found or v_job.is_draft then raise exception 'No se encontró el pedido'; end if;
  if v_job.quote_status <> 'pending_quote' then raise exception 'El pedido ya tiene un importe confirmado'; end if;
  if v_job.status = 'cancelled' then raise exception 'El pedido está cancelado'; end if;
  if exists(select 1 from public.work_payments p where p.business_id = p_business_id and p.photo_job_id = p_job_id) then
    raise exception 'El pedido ya tiene pagos registrados';
  end if;
  select * into v_list from public.price_lists l
  where l.business_id = p_business_id and l.id = p_price_list_id and l.is_active;
  if not found then raise exception 'Elegí una lista de precios activa'; end if;
  if p_customer_id is null then raise exception 'Confirmá el cliente antes de presupuestar'; end if;
  v_customer := p_customer_id;
  select c.full_name into v_customer_name from public.customers c
  where c.business_id = p_business_id and c.id = v_customer and c.is_active;
  if not found then raise exception 'El cliente elegido no existe o está inactivo'; end if;

  for v_item in select * from public.photo_job_items i
    where i.business_id = p_business_id and i.photo_job_id = p_job_id and i.is_active order by i.created_at, i.id loop
    if v_item.lab_variant_id is null then raise exception 'El ítem «%» no se puede presupuestar con una lista', v_item.service_name_snapshot; end if;
    select t.unit_price_cents into v_unit from public.lab_price_tiers t
    where t.business_id = p_business_id and t.variant_id = v_item.lab_variant_id and t.price_list_id = v_list.id
      and t.min_quantity <= v_item.quantity and (t.max_quantity is null or t.max_quantity >= v_item.quantity);
    if not found then
      raise exception 'La lista «%» no tiene precio para % copias de «%»', v_list.name, v_item.quantity,
        regexp_replace(v_item.service_name_snapshot, ' · Por presupuestar$', '');
    end if;
    v_base := regexp_replace(v_item.service_name_snapshot, ' · Por presupuestar$', '');
    update public.photo_job_items set price_list_id = v_list.id, unit_price_cents = v_unit,
      total_cents = v_item.quantity * v_unit, service_name_snapshot = v_base || ' · ' || v_list.name
    where id = v_item.id;
    v_total := v_total + v_item.quantity * v_unit;
  end loop;

  update public.photo_jobs set customer_id = v_customer, quote_status = 'quoted',
    notes = coalesce(notes || E'\n', '') || 'Cliente confirmado: ' || v_customer_name
      || '. Presupuestado con la lista «' || v_list.name || '».'
  where business_id = p_business_id and id = p_job_id;
  update public.public_photo_orders set customer_id = v_customer, updated_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id and photo_job_id = p_job_id;
  -- The request's own unverified Customer is retired when staff linked the job to another one and
  -- nothing else points to it (it would only be a duplicate in the customer list).
  if v_customer <> v_job.customer_id and private.cc_customer_unreferenced(p_business_id, v_job.customer_id) then
    update public.customers set is_active = false
    where business_id = p_business_id and id = v_job.customer_id and is_active
      and notes like 'Alta automática desde solicitud profesional web%';
  end if;
  return jsonb_build_object('job_id', p_job_id, 'customer_id', v_customer, 'price_list_id', v_list.id,
    'price_list_name', v_list.name, 'total_cents', v_total);
end;
$$;
revoke all on function public.quote_photo_job(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.quote_photo_job(uuid, uuid, uuid, uuid) to authenticated;
