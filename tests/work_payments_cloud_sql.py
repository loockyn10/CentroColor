from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'supabase'/'migrations'/'20261016000000_work_payments.sql').read_text(encoding='utf-8').lower()
def main():
    required=[
        'create table public.work_payments','source_type text not null','payment_kind text not null','payment_method text not null',
        "status text not null default 'posted'",'foreign key(business_id,event_id)','foreign key(business_id,frame_job_id)',
        'foreign key(business_id,photo_job_id)','create function public.post_work_payment','pg_advisory_xact_lock',
        'private.work_source_net_paid','create function public.void_work_payment','m.role in(\'owner\',\'admin\')',
        'alter table public.work_payments enable row level security','grant select on public.work_payments to authenticated',
        'grant execute on function public.post_work_payment(jsonb) to authenticated',
    ]
    for token in required: assert token in SQL,token
    assert 'grant insert on public.work_payments' not in SQL
    assert 'grant update on public.work_payments' not in SQL
    assert 'grant delete' not in SQL
    assert 'service_role' not in SQL
    print('Work payments Cloud SQL: FK, atomic lock/RPC, RLS, role and no direct mutation checks passed')
if __name__=='__main__': main()
