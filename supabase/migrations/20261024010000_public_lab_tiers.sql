-- SERVICIOS-01: public portal reads public tiers and real paper variants.
create or replace function public.cc_public_order_start(
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
  v_variant public.lab_variants%rowtype;
  v_list_id uuid;
  v_unit_price bigint;
  v_snapshot_name text;
  v_variant_ids uuid[] := '{}';
  v_selected_variant uuid;
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
    if v_entry ? 'variant_id' then
      v_selected_variant := (v_entry ->> 'variant_id')::uuid;
      select * into v_variant from public.lab_variants v
      where v.business_id=p_business_id and v.id=v_selected_variant and v.channel='laboratory' and v.is_active;
      if not found then raise exception 'cc_error:service_unavailable'; end if;
      select * into v_service from public.photo_services s
      where s.business_id=p_business_id and s.id=v_variant.photo_service_id;
      if not found or not v_service.is_active or not v_service.is_public or not v_service.public_order_enabled
         or (v_entry ->> 'service_id')::uuid <> (case when v_variant.paper='glossy' then v_service.id else v_variant.id end) then
        raise exception 'cc_error:service_unavailable';
      end if;
      if v_variant.id = any(v_variant_ids) then raise exception 'cc_error:invalid_items'; end if;
      select p.id into v_list_id from public.price_lists p
      where p.business_id=p_business_id and p.is_default and p.is_active;
      select t.unit_price_cents into v_unit_price from public.lab_price_tiers t
      where t.business_id=p_business_id and t.variant_id=v_variant.id and t.price_list_id=v_list_id
        and t.min_quantity<=v_qty and (t.max_quantity is null or t.max_quantity>=v_qty);
      if not found then raise exception 'cc_error:service_unavailable'; end if;
      if (v_entry ->> 'expected_unit_price_cents')::bigint <> v_unit_price then
        raise exception 'cc_error:price_changed';
      end if;
      v_variant_ids := v_variant_ids || v_variant.id;
    else
      -- Compatible with an order draft started by a pre-SERVICIOS-01 browser.
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
    end if;
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
    v_qty := (v_entry ->> 'quantity')::integer;
    if v_entry ? 'variant_id' then
      v_selected_variant := (v_entry ->> 'variant_id')::uuid;
      select * into v_variant from public.lab_variants v where v.business_id=p_business_id and v.id=v_selected_variant;
      select * into v_service from public.photo_services s where s.business_id=p_business_id and s.id=v_variant.photo_service_id;
      select p.id into v_list_id from public.price_lists p where p.business_id=p_business_id and p.is_default and p.is_active;
      select t.unit_price_cents into v_unit_price from public.lab_price_tiers t
      where t.business_id=p_business_id and t.variant_id=v_variant.id and t.price_list_id=v_list_id
        and t.min_quantity<=v_qty and (t.max_quantity is null or t.max_quantity>=v_qty);
      v_snapshot_name := coalesce(v_service.public_name,v_service.name) || ' · ' ||
        case v_variant.paper when 'matte' then 'Mate' else 'Brillo' end || ' · Público';
      select i.id into v_item from public.photo_job_items i
      where i.business_id=p_business_id and i.photo_job_id=v_job and i.lab_variant_id=v_variant.id
      order by i.created_at,i.id limit 1;
    else
      v_selected_variant := null;
      v_list_id := null;
      select * into v_service from public.photo_services s
      where s.business_id = p_business_id and s.id = (v_entry ->> 'service_id')::uuid;
      v_unit_price := v_service.default_unit_price_cents;
      v_snapshot_name := coalesce(v_service.public_name,v_service.name);
      select i.id into v_item from public.photo_job_items i
      where i.business_id = p_business_id and i.photo_job_id = v_job and i.photo_service_id = v_service.id
        and i.lab_variant_id is null
      order by i.created_at, i.id limit 1;
    end if;
    if v_item is null then
      insert into public.photo_job_items(id, business_id, photo_job_id, photo_service_id, lab_variant_id,
        price_list_id, service_name_snapshot, quantity, unit_price_cents, total_cents,
        width_mm, height_mm, is_active, created_at)
      values (gen_random_uuid(), p_business_id, v_job, v_service.id, v_selected_variant,
        v_list_id, v_snapshot_name, v_qty, v_unit_price, v_qty * v_unit_price,
        v_service.width_mm, v_service.height_mm, true,
        v_started + v_ordinal * interval '1 microsecond');
    else
      update public.photo_job_items set
        service_name_snapshot = v_snapshot_name, quantity = v_qty,
        lab_variant_id = v_selected_variant, price_list_id = v_list_id,
        unit_price_cents = v_unit_price,
        total_cents = v_qty * v_unit_price,
        width_mm = v_service.width_mm, height_mm = v_service.height_mm, is_active = true
      where id = v_item;
    end if;
  end loop;
  -- Services dropped on a refresh stop counting, unless files were already attached to them.
  update public.photo_job_items i set is_active = false
  where i.business_id = p_business_id and i.photo_job_id = v_job and i.is_active
    and not ((i.lab_variant_id = any(v_variant_ids)) or (i.lab_variant_id is null and i.photo_service_id = any(v_service_ids)))
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
      'item_id', i.id, 'service_id', case when v.paper='matte' then i.lab_variant_id else i.photo_service_id end, 'name', i.service_name_snapshot,
      'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents
    ) order by i.created_at, i.id), '[]'::jsonb),
    coalesce(sum(i.total_cents), 0)
  into v_items, v_total
  from public.photo_job_items i left join public.lab_variants v
    on v.business_id=i.business_id and v.id=i.lab_variant_id
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

-- Confirm uses uploaded copies as the quantity for this variant's tier, then freezes the item.
create or replace function public.cc_public_order_confirm(
  p_business_id uuid, p_job_id uuid, p_upload_link_id uuid,
  p_tracking_token_hash text, p_tracking_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.public_photo_orders%rowtype;
  v_item public.photo_job_items%rowtype;
  v_copies bigint;
  v_unit_price bigint;
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
        if v_item.lab_variant_id is not null then
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
