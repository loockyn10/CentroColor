-- Sprint 12: append-only payments for Event, FrameJob and PhotoJob.
create table public.work_payments (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  source_type text not null check(source_type in('event','frame_job','photo_job')),
  event_id uuid,
  frame_job_id uuid,
  photo_job_id uuid,
  payment_kind text not null check(payment_kind in('deposit','payment','refund')),
  payment_method text not null check(payment_method in('cash','transfer','debit_card','credit_card','mercado_pago','other')),
  amount_cents bigint not null check(amount_cents > 0),
  occurred_at timestamptz not null,
  notes text,
  status text not null default 'posted' check(status in('posted','voided')),
  created_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  foreign key(business_id,branch_id) references public.branches(business_id,id),
  foreign key(business_id,customer_id) references public.customers(business_id,id),
  foreign key(business_id,event_id) references public.events(business_id,id),
  foreign key(business_id,frame_job_id) references public.frame_jobs(business_id,id),
  foreign key(business_id,photo_job_id) references public.photo_jobs(business_id,id),
  check(
    (source_type='event' and event_id is not null and frame_job_id is null and photo_job_id is null) or
    (source_type='frame_job' and event_id is null and frame_job_id is not null and photo_job_id is null) or
    (source_type='photo_job' and event_id is null and frame_job_id is null and photo_job_id is not null)
  ),
  check(
    (status='posted' and voided_at is null and voided_by is null and void_reason is null) or
    (status='voided' and voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  )
);
create index work_payments_source_idx on public.work_payments(business_id,source_type,event_id,frame_job_id,photo_job_id,occurred_at desc);
create index work_payments_customer_idx on public.work_payments(business_id,customer_id,occurred_at desc);
create index work_payments_sync_idx on public.work_payments(business_id,updated_at,id);

create table private.work_payment_sync_clock (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  last_updated_at timestamptz not null
);
revoke all on private.work_payment_sync_clock from public,anon,authenticated;
create function private.work_payment_next_version() returns trigger
language plpgsql security definer set search_path=''
as $$
declare v timestamptz;
begin
  insert into private.work_payment_sync_clock as c(business_id,last_updated_at)
  values(new.business_id,pg_catalog.clock_timestamp())
  on conflict(business_id) do update
    set last_updated_at=greatest(pg_catalog.clock_timestamp(),c.last_updated_at+interval '1 microsecond')
  returning last_updated_at into v;
  new.updated_at:=v;
  return new;
end;
$$;
revoke all on function private.work_payment_next_version() from public,anon,authenticated;
create trigger work_payment_version before insert or update on public.work_payments for each row execute function private.work_payment_next_version();

create function private.work_source_total(p_business uuid,p_type text,p_id uuid) returns bigint
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
    select coalesce(sum(i.total_cents),0) into v_total from public.photo_job_items i where i.business_id=p_business and i.photo_job_id=p_id and i.is_active;
  else
    raise exception 'Tipo de fuente inválido';
  end if;
  if v_total is null then raise exception 'No se encontró la fuente cobrable'; end if;
  return v_total;
end;
$$;
revoke all on function private.work_source_total(uuid,text,uuid) from public,anon,authenticated;

create function private.work_source_net_paid(p_business uuid,p_type text,p_id uuid,p_exclude uuid default null) returns bigint
language sql stable security definer set search_path=''
as $$
  select coalesce(sum(case when p.payment_kind='refund' then -p.amount_cents else p.amount_cents end),0)::bigint
  from public.work_payments p
  where p.business_id=p_business and p.source_type=p_type and p.status='posted' and p.id is distinct from p_exclude
    and ((p_type='event' and p.event_id=p_id) or (p_type='frame_job' and p.frame_job_id=p_id) or (p_type='photo_job' and p.photo_job_id=p_id));
$$;
revoke all on function private.work_source_net_paid(uuid,text,uuid,uuid) from public,anon,authenticated;

create function private.work_payment_immutable() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.id<>old.id or new.business_id<>old.business_id or new.branch_id<>old.branch_id or new.customer_id<>old.customer_id or new.source_type<>old.source_type
    or new.event_id is distinct from old.event_id or new.frame_job_id is distinct from old.frame_job_id or new.photo_job_id is distinct from old.photo_job_id
    or new.payment_kind<>old.payment_kind or new.payment_method<>old.payment_method or new.amount_cents<>old.amount_cents or new.occurred_at<>old.occurred_at
    or new.notes is distinct from old.notes or new.created_by<>old.created_by or new.created_at<>old.created_at then
    raise exception 'Los datos históricos del pago son inmutables';
  end if;
  if old.status='voided' and new.status<>'voided' then raise exception 'Un pago anulado no puede reactivarse'; end if;
  return new;
end;
$$;
revoke all on function private.work_payment_immutable() from public,anon,authenticated;
create trigger work_payment_immutable before update on public.work_payments for each row execute function private.work_payment_immutable();

create function public.post_work_payment(p_payment jsonb) returns public.work_payments
language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid := (p_payment->>'id')::uuid;
  v_business uuid := (p_payment->>'business_id')::uuid;
  v_branch uuid := (p_payment->>'branch_id')::uuid;
  v_customer uuid := (p_payment->>'customer_id')::uuid;
  v_type text := p_payment->>'source_type';
  v_source uuid := coalesce((p_payment->>'event_id')::uuid,(p_payment->>'frame_job_id')::uuid,(p_payment->>'photo_job_id')::uuid);
  v_kind text := p_payment->>'payment_kind';
  v_amount bigint := (p_payment->>'amount_cents')::bigint;
  v_existing public.work_payments;
  v_total bigint;
  v_paid bigint;
  v_result public.work_payments;
begin
  if v_user is null or not exists(select 1 from public.business_memberships m where m.business_id=v_business and m.user_id=v_user and m.is_active) then
    raise exception 'Acceso Cloud no autorizado';
  end if;
  if (p_payment->>'created_by')::uuid<>v_user then raise exception 'El creador debe ser el usuario autenticado'; end if;
  select * into v_existing from public.work_payments p where p.id=v_id;
  if found then
    if v_existing.business_id=v_business and v_existing.branch_id=v_branch and v_existing.customer_id=v_customer and v_existing.source_type=v_type
      and v_existing.event_id is not distinct from (p_payment->>'event_id')::uuid
      and v_existing.frame_job_id is not distinct from (p_payment->>'frame_job_id')::uuid
      and v_existing.photo_job_id is not distinct from (p_payment->>'photo_job_id')::uuid
      and v_existing.payment_kind=v_kind and v_existing.payment_method=p_payment->>'payment_method' and v_existing.amount_cents=v_amount
      and v_existing.occurred_at=(p_payment->>'occurred_at')::timestamptz
      and v_existing.notes is not distinct from nullif(btrim(p_payment->>'notes'),'')
      and v_existing.created_by=v_user then return v_existing;
    end if;
    raise exception 'El UUID del pago ya existe con otro contenido';
  end if;
  if v_amount<=0 then raise exception 'El importe debe ser mayor a cero'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business::text||':'||v_type||':'||v_source::text,0));
  if v_type='event' and not exists(select 1 from public.events e where e.business_id=v_business and e.id=v_source and e.branch_id=v_branch and e.customer_id=v_customer) then raise exception 'Evento, cliente o sucursal no corresponden al pago'; end if;
  if v_type='frame_job' and not exists(select 1 from public.frame_jobs j where j.business_id=v_business and j.id=v_source and j.branch_id=v_branch and j.customer_id=v_customer) then raise exception 'Trabajo de marquetería, cliente o sucursal no corresponden al pago'; end if;
  if v_type='photo_job' and not exists(select 1 from public.photo_jobs j where j.business_id=v_business and j.id=v_source and j.branch_id=v_branch and j.customer_id=v_customer) then raise exception 'Trabajo fotográfico, cliente o sucursal no corresponden al pago'; end if;
  v_total:=private.work_source_total(v_business,v_type,v_source);
  v_paid:=private.work_source_net_paid(v_business,v_type,v_source);
  if v_kind='refund' and v_amount>v_paid then raise exception 'La devolución supera el neto efectivamente pagado'; end if;
  if v_kind in('deposit','payment') and v_amount>v_total-v_paid then raise exception 'El importe supera el saldo máximo cobrable: % centavos',v_total-v_paid; end if;
  insert into public.work_payments(id,business_id,branch_id,customer_id,source_type,event_id,frame_job_id,photo_job_id,payment_kind,payment_method,amount_cents,occurred_at,notes,status,created_by,created_at)
  values(v_id,v_business,v_branch,v_customer,v_type,(p_payment->>'event_id')::uuid,(p_payment->>'frame_job_id')::uuid,(p_payment->>'photo_job_id')::uuid,v_kind,p_payment->>'payment_method',v_amount,(p_payment->>'occurred_at')::timestamptz,nullif(btrim(p_payment->>'notes'),''),'posted',v_user,coalesce((p_payment->>'created_at')::timestamptz,now()))
  returning * into v_result;
  return v_result;
end;
$$;

create function public.void_work_payment(p_business_id uuid,p_payment_id uuid,p_reason text,p_voided_at timestamptz default now()) returns public.work_payments
language plpgsql security definer set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_payment public.work_payments; v_source uuid; v_net bigint; v_total bigint;
begin
  if v_user is null or not exists(select 1 from public.business_memberships m where m.business_id=p_business_id and m.user_id=v_user and m.is_active and m.role in('owner','admin')) then
    raise exception 'Sólo owner/admin puede anular pagos';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'El motivo de anulación es obligatorio'; end if;
  select * into v_payment from public.work_payments p where p.business_id=p_business_id and p.id=p_payment_id;
  if not found then raise exception 'No se encontró el pago'; end if;
  if v_payment.status='voided' then return v_payment; end if;
  v_source:=coalesce(v_payment.event_id,v_payment.frame_job_id,v_payment.photo_job_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||v_payment.source_type||':'||v_source::text,0));
  v_net:=private.work_source_net_paid(p_business_id,v_payment.source_type,v_source,p_payment_id);
  v_total:=private.work_source_total(p_business_id,v_payment.source_type,v_source);
  if v_net<0 then raise exception 'La anulación dejaría devoluciones sin pago que las respalde'; end if;
  if v_net>v_total then raise exception 'La anulación dejaría el trabajo con sobrepago'; end if;
  update public.work_payments set status='voided',voided_at=p_voided_at,voided_by=v_user,void_reason=btrim(p_reason) where business_id=p_business_id and id=p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

alter table public.work_payments enable row level security;
create policy work_payments_read on public.work_payments for select to authenticated using(private.has_active_membership(business_id));
revoke all on public.work_payments from public,anon,authenticated;
grant select on public.work_payments to authenticated;
revoke all on function public.post_work_payment(jsonb) from public,anon;
revoke all on function public.void_work_payment(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.post_work_payment(jsonb) to authenticated;
grant execute on function public.void_work_payment(uuid,uuid,text,timestamptz) to authenticated;
