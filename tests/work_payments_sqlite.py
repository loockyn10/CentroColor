import sqlite3
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/'apps'/'desktop'/'src-tauri'/'migrations'
def rejected(connection,sql,args,message):
    try: connection.execute(sql,args); raise AssertionError('operation should fail')
    except sqlite3.IntegrityError as error: assert message.lower() in str(error).lower(),str(error)
def main():
    with tempfile.TemporaryDirectory() as directory:
        c=sqlite3.connect(Path(directory)/'payments.db');c.execute('pragma foreign_keys=on');c.execute('create table app_meta(key text primary key,value text not null)')
        for path in sorted(MIGRATIONS.glob('*.sql')): c.executescript(path.read_text(encoding='utf-8'))
        now='2026-10-16T12:00:00Z';b='b';branch='br';user='u'
        c.execute('insert into authorized_context values(1,?,?,?,?,?,?,?,?)',(user,'Owner',b,'CentroColor',branch,'Principal','owner',now))
        c.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values('customer',?,'Cliente',1,?,?,'remote',0)",(b,now,now))
        c.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values('customer-2',?,'Otro',1,?,?,'remote',0)",(b,now,now))
        c.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values('other-customer','other','Otro negocio',1,?,?,'remote',0)",(now,now))
        c.execute("insert into event_types values('type',?,'Evento',1,?,?,'remote',0,null)",(b,now,now))
        c.execute("insert into events values('event',?,?,?,'type','Casamiento',?,?,null,null,'reserved',null,?,?,?,'remote',0,null)",(b,branch,'customer',now,'2026-10-17T12:00:00Z',user,now,now))
        c.execute("insert into event_service_items values('service',?,'event',null,'Cobertura',null,1,100000,100000,1,?,?,'remote',0,null,null,null)",(b,now,now))
        c.execute("insert into frame_quotes(id,business_id,branch_id,customer_id,width_mm,height_mm,measurement_mode,status,subtotal_cents,total_cents,created_by,created_at,updated_at,sync_origin,local_revision) values('quote',?,?,?,400,600,'opening','accepted',80000,80000,?,?,?,'remote',0)",(b,branch,'customer',user,now,now))
        c.execute("insert into frame_jobs(id,business_id,branch_id,quote_id,customer_id,status,created_at,updated_at,sync_origin,local_revision) values('frame',?,?, 'quote','customer','pending',?,?,'remote',0)",(b,branch,now,now))
        c.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,created_at,updated_at,sync_origin,local_revision) values('photo',?,?,?,'received','normal',?,?,?,'remote',0)",(b,branch,'customer',user,now,now))
        c.execute("insert into photo_job_items(id,business_id,photo_job_id,service_name_snapshot,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at,sync_origin,local_revision) values('photo-item',?,'photo','20 fotos 10x15',20,500,10000,1,?,?,'remote',0)",(b,now,now))
        insert="insert into work_payments(id,business_id,branch_id,customer_id,source_type,event_id,frame_job_id,photo_job_id,payment_kind,payment_method,amount_cents,occurred_at,notes,status,created_by,voided_at,voided_by,void_reason,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,null,null,null,?,?)"
        c.execute(insert,('deposit',b,branch,'customer','event','event',None,None,'deposit','cash',30000,now,None,user,now,now))
        c.execute(insert,('payment',b,branch,'customer','event','event',None,None,'payment','transfer',70000,now,None,user,now,now))
        rejected(c,insert,('over',b,branch,'customer','event','event',None,None,'payment','cash',1,now,None,user,now,now),'saldo máximo')
        c.execute("update work_payments set status='voided',voided_at=?,voided_by=?,void_reason='Importe incorrecto',updated_at=?,local_revision=local_revision+1 where id='payment'",(now,user,now))
        c.execute(insert,('refund',b,branch,'customer','event','event',None,None,'refund','cash',10000,now,None,user,now,now))
        rejected(c,insert,('refund-over',b,branch,'customer','event','event',None,None,'refund','cash',20001,now,None,user,now,now),'devolución supera')
        assert c.execute("select count(*) from work_payment_sync_outbox where status='pending'").fetchone()[0]==3
        c.execute("update work_payments set status='voided',voided_at=?,voided_by=?,void_reason='Devolución anulada',updated_at=?,local_revision=local_revision+1 where id='refund'",(now,user,now))
        assert c.execute("select sum(case when payment_kind='refund' then -amount_cents else amount_cents end) from work_payments where status='posted'").fetchone()[0]==30000
        c.execute(insert,('frame-deposit',b,branch,'customer','frame_job',None,'frame',None,'deposit','cash',30000,now,None,user,now,now))
        assert c.execute("select 80000-coalesce(sum(case when payment_kind='refund' then -amount_cents else amount_cents end),0) from work_payments where frame_job_id='frame' and status='posted'").fetchone()[0]==50000
        c.execute(insert,('photo-paid',b,branch,'customer','photo_job',None,None,'photo','payment','mercado_pago',10000,now,None,user,now,now))
        assert c.execute("select 10000-sum(amount_cents) from work_payments where photo_job_id='photo' and status='posted'").fetchone()[0]==0
        c.execute("update photo_jobs set status='cancelled' where id='photo'")
        assert c.execute("select count(*) from work_payments where photo_job_id='photo'").fetchone()[0]==1
        rejected(c,insert,('wrong-customer',b,branch,'customer-2','event','event',None,None,'payment','cash',1,now,None,user,now,now),'cliente o sucursal')
        rejected(c,insert,('wrong-business','other',branch,'other-customer','event','event',None,None,'payment','cash',1,now,None,user,now,now),'contexto autorizado')
        rejected(c,insert,('bad-source',b,branch,'customer','event','event',None,'photo','payment','cash',1,now,None,user,now,now),'check constraint')
        c.execute("update authorized_context set role='staff' where slot=1")
        rejected(c,"update work_payments set status='voided',voided_at=?,voided_by=?,void_reason='staff',updated_at=? where id='photo-paid'",(now,user,now),'owner/admin')
        c.execute("update authorized_context set role='owner' where slot=1")
        c.close()
        print('Work payments SQLite: deposits, full payment, refund, void, overpayment, exact source and outbox checks passed')
if __name__=='__main__': main()
