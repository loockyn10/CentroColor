-- Professional portal without an account: "solicitud profesional pendiente de presupuestar".
--
-- /profesionales is public. A visitor with no session sends photos and a quantity per size/paper,
-- never sees a price, and the order waits for CentroColor to quote it. The professional ACCOUNTS of
-- 20261107000000 are untouched (they keep their own list, their prices and "pay later").
--
-- Model: a PhotoJob gets `quote_status`. `pending_quote` means "this job has no amount yet": its items
-- carry unit price 0 ONLY as a storage placeholder (photo_job_items.unit_price_cents is NOT NULL and
-- the total of a job is the sum of its items), and everything that charges money refuses a pending job,
-- so a pending job can never be paid, nor read as "free" or "paid". The amount is written exactly once,
-- by `quote_photo_job`, which an owner/admin runs and which prices every item from a price list
-- (never from anything the caller sends).
--
-- Additive: nothing here rewrites an existing row (every existing job is `quoted`).

/* ───────────────────────────── 1. model ───────────────────────────── */

alter table public.photo_jobs
  add column quote_status text not null default 'quoted'
    check(quote_status in ('quoted', 'pending_quote'));
create index photo_jobs_pending_quote_idx
  on public.photo_jobs(business_id, created_at) where quote_status = 'pending_quote';

-- Which public page the order came from. Professional-account orders are backfilled.
alter table public.public_photo_orders
  add column portal text not null default 'imprimir' check(portal in ('imprimir', 'profesionales'));
update public.public_photo_orders set portal = 'profesionales' where professional_account_id is not null;
-- An order placed from a professional ACCOUNT belongs to the professional portal by definition
-- (cc_professional_order_start predates this column and does not name it).
create function private.public_photo_order_portal() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.professional_account_id is not null then new.portal := 'profesionales'; end if;
  return new;
end;
$$;
revoke all on function private.public_photo_order_portal() from public, anon, authenticated;
create trigger public_photo_order_portal before insert or update of professional_account_id on public.public_photo_orders
for each row execute function private.public_photo_order_portal();
alter table public.public_photo_orders
  add constraint public_photo_orders_account_is_professional
    check(professional_account_id is null or portal = 'profesionales');
create index public_photo_orders_anon_request_idx
  on public.public_photo_orders(business_id, created_at)
  where portal = 'profesionales' and professional_account_id is null;
grant select(portal) on public.public_photo_orders to authenticated;

-- `quote_status` belongs to the server: a client can neither create a pending job nor flip one.
create function private.photo_job_quote_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.quote_status := 'quoted';
    else new.quote_status := old.quote_status;
    end if;
  end if;
  -- A job without an amount cannot be finished or handed over: that would be work given away.
  if new.quote_status = 'pending_quote' and new.status in ('ready', 'delivered')
     and current_user in ('authenticated', 'anon') then
    raise exception 'El pedido está pendiente de presupuestar: presupuestalo antes de marcarlo listo o entregado.';
  end if;
  return new;
end;
$$;
revoke all on function private.photo_job_quote_guard() from public, anon, authenticated;
create trigger photo_job_quote_guard before insert or update on public.photo_jobs
for each row execute function private.photo_job_quote_guard();

-- While a job is pending, a client cannot put an amount on its items by hand: the amount comes
-- from `quote_photo_job`. (Runs as the caller on purpose: it tells apart the panel from the server.)
create function private.photo_item_pending_quote_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.unit_price_cents <> 0 or new.total_cents <> 0 or new.price_list_id is not null)
     and exists(select 1 from public.photo_jobs j
       where j.business_id = new.business_id and j.id = new.photo_job_id and j.quote_status = 'pending_quote') then
    raise exception 'El pedido está pendiente de presupuestar: usá «Presupuestar» para fijar el importe.';
  end if;
  return new;
end;
$$;
revoke all on function private.photo_item_pending_quote_guard() from public, anon, authenticated;
create trigger photo_item_pending_quote_guard before insert or update on public.photo_job_items
for each row execute function private.photo_item_pending_quote_guard();

-- A pending job has no amount to charge: payments (and their voiding) refuse it explicitly instead
-- of treating the placeholder zero as a real total.
create or replace function private.work_source_total(p_business uuid,p_type text,p_id uuid) returns bigint
language plpgsql stable security definer set search_path=''
as $$
declare v_total bigint;
begin
  if p_type='event' then
    select coalesce((select sum(i.total_cents) from public.event_service_items i where i.business_id=p_business and i.event_id=p_id and i.is_active),0)
      + coalesce((select sum(r.price_cents) from public.resource_reservations r where r.business_id=p_business and r.event_id=p_id and r.is_active),0)
      into v_total;
  elsif p_type='frame_job' then
    select q.total_cents into v_total from public.frame_jobs j join public.frame_quotes q on q.business_id=j.business_id and q.id=j.quote_id where j.business_id=p_business and j.id=p_id;
  elsif p_type='photo_job' then
    if exists(select 1 from public.photo_jobs j where j.business_id=p_business and j.id=p_id and j.quote_status='pending_quote') then
      raise exception 'El pedido está pendiente de presupuestar: todavía no tiene un importe para cobrar.';
    end if;
    select coalesce(sum(i.total_cents),0) into v_total from public.photo_job_items i where i.business_id=p_business and i.photo_job_id=p_id and i.is_active;
  else
    raise exception 'Tipo de fuente inválido';
  end if;
  if v_total is null then raise exception 'No se encontró la fuente cobrable'; end if;
  return v_total;
end;
$$;
revoke all on function private.work_source_total(uuid,text,uuid) from public,anon,authenticated;

/* ───────────────────────────── 2. public catalog (no prices) ───────────────────────────── */

-- A size/paper a professional request may ask for: an active laboratory variant that is either
-- published for /imprimir or priced in an active Profesional list. Convenio lists never widen it,
-- so a size reserved to one client is not announced to visitors.
create function private.cc_professional_orderable(p_business_id uuid, p_variant_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.lab_variants v
    join public.photo_services s on s.business_id = v.business_id and s.id = v.photo_service_id
    where v.business_id = p_business_id and v.id = p_variant_id
      and v.channel = 'laboratory' and v.is_active
      and s.is_active and s.workflow_route = 'lab' and s.requires_customer_files
      and ((s.is_public and s.public_order_enabled)
        or exists(
          select 1 from public.lab_price_tiers t
          join public.price_lists l on l.business_id = t.business_id and l.id = t.price_list_id
          where t.business_id = v.business_id and t.variant_id = v.id and l.is_active and l.kind = 'professional'))
  )
$$;
revoke all on function private.cc_professional_orderable(uuid, uuid) from public, anon, authenticated;

-- Sizes and papers only. There is deliberately no price, tier, list or commercial column here.
create function public.cc_professional_public_catalog(p_business_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', case when v.paper = 'glossy' then s.id else v.id end,
    'variant_id', v.id, 'photo_service_id', s.id,
    'name', coalesce(s.public_name, s.name) || ' · ' || case v.paper when 'matte' then 'Mate' else 'Brillo' end,
    'description', s.public_description, 'width_mm', s.width_mm, 'height_mm', s.height_mm,
    'sort_order', s.public_sort_order, 'paper', v.paper
  ) order by s.public_sort_order, s.name, v.paper), '[]'::jsonb)
  from public.lab_variants v
  join public.photo_services s on s.business_id = v.business_id and s.id = v.photo_service_id
  where v.business_id = p_business_id and private.cc_professional_orderable(v.business_id, v.id)
$$;
revoke all on function public.cc_professional_public_catalog(uuid) from public, anon, authenticated;
grant execute on function public.cc_professional_public_catalog(uuid) to service_role;

/* ───────────────────────────── 3. anonymous request ───────────────────────────── */

-- Starts (or refreshes) a request in ONE transaction. Same shape as cc_public_order_start with the
-- difference that matters: nothing is priced. Items are stored with the placeholder zero, the job is
-- `pending_quote`, no price list is applied, and the Customer is only matched by phone / created, as
-- in /imprimir (staff decide afterwards which Customer and list apply).
create function public.cc_professional_request_start(
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
  v_key text := right(regexp_replace(coalesce(p_phone_e164, ''), '\D', '', 'g'), 10);
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
  perform pg_advisory_xact_lock(hashtextextended('cc_public_customer:' || p_business_id::text || ':' || v_key, 0));

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

  -- Customer: reuse the Business customer with the same phone (never edited), else create one.
  select c.id into v_customer from public.customers c
  where c.business_id = p_business_id and c.is_active and c.phone_match_key = v_key
  order by c.created_at, c.id limit 1;
  if v_customer is null then
    v_email := case when p_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then p_email end;
    insert into public.customers(id, business_id, full_name, phone, email)
    values (gen_random_uuid(), p_business_id, btrim(p_customer_name), p_phone_display, v_email)
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
revoke all on function public.cc_professional_request_start(uuid, text, text, text, text, text, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_professional_request_start(uuid, text, text, text, text, text, text, text, jsonb, text, timestamptz)
  to service_role;

-- Confirmation: same function as before, except that a pending job keeps the placeholder zero
-- (there is no price list to re-read tiers from). The quantity is still DERIVED from the uploaded
-- files, so the copies of every size are exactly what the photographer asked for.
create or replace function public.cc_public_order_confirm(
  p_business_id uuid, p_job_id uuid, p_upload_link_id uuid,
  p_tracking_token_hash text, p_tracking_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_item public.photo_job_items%rowtype;
  v_copies bigint;
  v_unit_price bigint;
  v_pending boolean;
  v_active integer := 0;
  v_tracking uuid;
  v_already boolean;
  v_items jsonb;
  v_total bigint;
begin
  select * into v_order from public.public_photo_orders o
  where o.business_id=p_business_id and o.photo_job_id=p_job_id for update;
  if not found then raise exception 'cc_error:order_not_found'; end if;
  v_already := v_order.status='submitted';
  select j.quote_status = 'pending_quote' into v_pending from public.photo_jobs j
  where j.business_id=p_business_id and j.id=p_job_id;
  if not v_already then
    if exists(select 1 from public.photo_job_files f where f.business_id=p_business_id
      and f.photo_job_id=p_job_id and f.status in ('pending','uploading')) then
      raise exception 'cc_error:uploads_pending';
    end if;
    for v_item in select * from public.photo_job_items i
      where i.business_id=p_business_id and i.photo_job_id=p_job_id order by i.created_at,i.id loop
      select coalesce(sum(f.copies),0) into v_copies from public.photo_job_files f
      where f.business_id=p_business_id and f.photo_job_item_id=v_item.id and f.status='uploaded';
      if v_copies>0 then
        v_active:=v_active+1;
        v_unit_price:=v_item.unit_price_cents;
        if v_pending then
          v_unit_price:=0;
        elsif v_item.lab_variant_id is not null then
          select t.unit_price_cents into v_unit_price from public.lab_price_tiers t
          where t.business_id=p_business_id and t.variant_id=v_item.lab_variant_id
            and t.price_list_id=v_item.price_list_id and t.min_quantity<=v_copies
            and (t.max_quantity is null or t.max_quantity>=v_copies);
          if not found then raise exception 'cc_error:price_changed'; end if;
        end if;
        update public.photo_job_items set quantity=v_copies::integer,unit_price_cents=v_unit_price,
          total_cents=v_copies*v_unit_price,is_active=true where id=v_item.id;
      else
        update public.photo_job_items set is_active=false where id=v_item.id;
      end if;
    end loop;
    if v_active=0 then raise exception 'cc_error:no_files'; end if;
    update public.photo_jobs set is_draft=false,file_intake_status='submitted'
    where business_id=p_business_id and id=p_job_id;
    update public.photo_job_files set status=status where business_id=p_business_id and photo_job_id=p_job_id;
    update public.public_photo_orders set status='submitted',submitted_at=pg_catalog.clock_timestamp(),
      updated_at=pg_catalog.clock_timestamp() where id=v_order.id;
    update public.photo_job_upload_links set submitted_at=coalesce(submitted_at,pg_catalog.clock_timestamp())
    where id=p_upload_link_id and business_id=p_business_id;
  end if;
  if (select count(*) from public.photo_job_upload_links l where l.business_id=p_business_id
    and l.photo_job_id=p_job_id and l.purpose='tracking')>=20 then
    raise exception 'cc_error:too_many_links';
  end if;
  insert into public.photo_job_upload_links(business_id,photo_job_id,token_hash,created_by,expires_at,purpose,submitted_at)
  values(p_business_id,p_job_id,p_tracking_token_hash,null,p_tracking_expires_at,'tracking',pg_catalog.clock_timestamp())
  returning id into v_tracking;
  select coalesce(jsonb_agg(jsonb_build_object('name',i.service_name_snapshot,'quantity',i.quantity,
      'unit_price_cents',i.unit_price_cents,'total_cents',i.total_cents) order by i.created_at,i.id),'[]'::jsonb),
    coalesce(sum(i.total_cents),0) into v_items,v_total
  from public.photo_job_items i where i.business_id=p_business_id and i.photo_job_id=p_job_id and i.is_active;
  return jsonb_build_object('status','submitted','already_submitted',v_already,'order_id',v_order.id,
    'tracking_link_id',v_tracking,'items',v_items,'total_cents',v_total);
end;
$$;
revoke all on function public.cc_public_order_confirm(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.cc_public_order_confirm(uuid,uuid,uuid,text,timestamptz) to service_role;

-- /imprimir must never reopen a draft that belongs to another portal (its prices would overwrite a
-- request waiting for a quote). The existing function keeps its body, renamed; the public name now
-- checks the key first and delegates, so every caller and grant stays as it was.
alter function public.cc_public_order_start(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  rename to cc_public_order_start_core;
create function public.cc_public_order_start(
  p_business_id uuid, p_client_key text, p_customer_name text, p_phone_e164 text, p_phone_display text,
  p_email text, p_notes text, p_whatsapp_opt_in boolean, p_ip_hash text, p_items jsonb, p_token_hash text,
  p_link_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.public_photo_orders o
    where o.business_id = p_business_id and o.client_key = p_client_key and o.portal <> 'imprimir') then
    raise exception 'cc_error:invalid_request';
  end if;
  return public.cc_public_order_start_core(p_business_id, p_client_key, p_customer_name, p_phone_e164,
    p_phone_display, p_email, p_notes, p_whatsapp_opt_in, p_ip_hash, p_items, p_token_hash, p_link_expires_at);
end;
$$;
revoke all on function public.cc_public_order_start(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_public_order_start(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  to service_role;
revoke all on function public.cc_public_order_start_core(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cc_public_order_start_core(uuid, text, text, text, text, text, text, boolean, text, jsonb, text, timestamptz)
  to service_role;

/* ───────────────────────────── 4. quoting (staff) ───────────────────────────── */

-- Quotes a pending job from ONE explicit price list, optionally linking it to another Customer.
-- Only owner/admin (the people who administer price lists and professional accounts) can run it.
-- The amount is computed here from the list's tiers and the copies the photographer asked for; the
-- caller only names the list. A size the list does not price aborts the whole quote.
create function public.quote_photo_job(
  p_business_id uuid, p_job_id uuid, p_price_list_id uuid, p_customer_id uuid default null
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
  v_customer := coalesce(p_customer_id, v_job.customer_id);
  if not exists(select 1 from public.customers c where c.business_id = p_business_id and c.id = v_customer and c.is_active) then
    raise exception 'El cliente elegido no existe o está inactivo';
  end if;

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
    notes = coalesce(notes || E'\n', '') || 'Presupuestado con la lista «' || v_list.name || '».'
  where business_id = p_business_id and id = p_job_id;
  update public.public_photo_orders set customer_id = v_customer, updated_at = pg_catalog.clock_timestamp()
  where business_id = p_business_id and photo_job_id = p_job_id;
  return jsonb_build_object('job_id', p_job_id, 'customer_id', v_customer, 'price_list_id', v_list.id,
    'price_list_name', v_list.name, 'total_cents', v_total);
end;
$$;
revoke all on function public.quote_photo_job(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.quote_photo_job(uuid, uuid, uuid, uuid) to authenticated;
