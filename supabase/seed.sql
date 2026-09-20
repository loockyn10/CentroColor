-- Development seed only. Supabase CLI applies this after local migrations.
insert into public.businesses (name, slug)
values ('CentroColor', 'centrocolor')
on conflict (slug) do nothing;

insert into public.branches (business_id, name)
select id, 'Sucursal principal'
from public.businesses
where slug = 'centrocolor'
on conflict (business_id, name) do nothing;
