import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        connection = sqlite3.connect(Path(directory) / "photo.db")
        connection.execute("pragma foreign_keys=on")
        connection.execute("create table app_meta(key text primary key,value text not null)")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            connection.executescript(path.read_text(encoding="utf-8"))
        business, other, branch, user = "b", "other", "branch", "user"
        now = "2026-10-16T12:00:00.000Z"
        connection.execute("insert into authorized_context values(1,?,?,?,?,?,?,?,?)", (user,"Owner",business,"CentroColor",branch,"Principal","owner",now))
        for bid, cid in [(business,"customer"),(other,"other-customer")]:
            connection.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values(?,?,?,1,?,?,'remote',0)",(cid,bid,"Cliente",now,now))
        connection.execute("insert into photo_services(id,business_id,name,service_type,width_mm,height_mm,default_unit_price_cents,is_active,created_at,updated_at) values('service',?,'Impresión 10x15','print',100,150,500,1,?,?)",(business,now,now))
        connection.execute("insert into photo_services(id,business_id,name,service_type,default_unit_price_cents,is_active,created_at,updated_at) values('inactive',?,'Viejo','other',0,0,?,?)",(business,now,now))
        assert connection.execute("select count(*) from photo_services where business_id=? and is_active=1",(business,)).fetchone()[0] == 1
        connection.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,promised_at,created_by,created_at,updated_at) values('job',?,?,?,'received','urgent','2026-10-16T18:00:00Z',?,?,?)",(business,branch,"customer",user,now,now))
        connection.execute("insert into photo_job_items(id,business_id,photo_job_id,photo_service_id,service_name_snapshot,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at) values('item',?,'job','service','Impresión 10x15',20,450,9000,1,?,?)",(business,now,now))
        assert connection.execute("select sum(total_cents) from photo_job_items where photo_job_id='job' and is_active=1").fetchone()[0] == 9000
        connection.execute("update photo_services set default_unit_price_cents=600 where id='service'")
        assert connection.execute("select unit_price_cents from photo_job_items where id='item'").fetchone()[0] == 450
        connection.execute("update photo_jobs set status='in_progress',local_revision=local_revision+1 where id='job'")
        assert connection.execute("select count(*) from photo_sync_outbox where entity_type='photo_job' and status='pending'").fetchone()[0] == 1
        before = connection.execute("select count(*) from photo_sync_outbox").fetchone()[0]
        connection.execute("insert into photo_services(id,business_id,name,service_type,default_unit_price_cents,is_active,created_at,updated_at,sync_origin,local_revision,cloud_updated_at) values('remote',?,'Remoto','other',0,1,?,?,'remote',0,?)",(business,now,now,now))
        assert connection.execute("select count(*) from photo_sync_outbox").fetchone()[0] == before
        try:
            connection.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,created_at,updated_at) values('bad',?,?,?,'received','normal',?,?,?)",(business,branch,"other-customer",user,now,now))
            raise AssertionError("cross-business customer should fail")
        except sqlite3.IntegrityError:
            pass
        connection.close()
    print("photo_sqlite.py: ok")


if __name__ == "__main__":
    main()
