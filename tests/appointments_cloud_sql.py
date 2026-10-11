"""Static safety checks for the PostgreSQL appointments migration."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sql = (root / 'supabase/migrations/20261011000000_appointments.sql').read_text(encoding='utf-8').lower()

required = (
    'create table public.appointment_types',
    'create table public.appointments',
    'foreign key (business_id,branch_id)',
    'foreign key (business_id,customer_id)',
    'foreign key (business_id,appointment_type_id)',
    'alter table public.appointment_types enable row level security',
    'alter table public.appointments enable row level security',
    'private.has_active_membership(business_id)',
    "m.role in ('owner','admin')",
    "new.status='cancelled' or old.status='cancelled'",
    'create table private.appointment_sync_clock',
    'create index appointments_business_updated_id_idx',
)
for statement in required:
    assert statement in sql, f'missing Cloud safety clause: {statement}'
assert 'service_role' not in sql
assert 'grant delete' not in sql
assert 'drop table' not in sql
print('Appointments Cloud SQL: tenant FKs, RLS, roles, clock and no DELETE verified')
