import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        db = sqlite3.connect(Path(directory) / "public-orders.db")
        db.execute("pragma foreign_keys=on")
        db.execute("create table app_meta(key text primary key,value text not null)")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))
        now = "2026-10-18T12:00:00Z"

        # An existing (pre-Sprint 14) service keeps working and is not public by default.
        db.execute("insert into photo_services(id,business_id,name,service_type,default_unit_price_cents,workflow_route,requires_customer_files,is_active,created_at,updated_at,sync_origin) values('service','business','10x15','print',100,'lab',1,1,?,?,'remote')", (now, now))
        assert db.execute("select is_public,public_name,public_description,public_sort_order,public_order_enabled from photo_services").fetchone() == (0, None, None, 0, 0)

        # Public flags are validated and are part of the sync outbox trigger.
        try:
            db.execute("update photo_services set is_public=2 where id='service'")
            raise AssertionError("is_public must be 0 or 1")
        except sqlite3.IntegrityError:
            pass
        before = db.execute("select count(*) from photo_sync_outbox").fetchone()[0]
        db.execute("update photo_services set public_order_enabled=1,is_public=1,public_name='10x15',public_sort_order=2,sync_origin='local',local_revision=local_revision+1 where id='service'")
        assert db.execute("select count(*) from photo_sync_outbox where entity_type='photo_service' and entity_id='service'").fetchone()[0] == 1
        assert db.execute("select count(*) from photo_sync_outbox").fetchone()[0] == before + 1
        # A remote apply (pull) must not queue anything.
        db.execute("delete from photo_sync_outbox")
        db.execute("update photo_services set public_description='Papel brillante',sync_origin='remote' where id='service'")
        assert db.execute("select count(*) from photo_sync_outbox").fetchone()[0] == 0

        # The order channel defaults to manual and only accepts the known channels.
        db.execute("insert into authorized_context values(1,'user','Owner','business','CentroColor','branch','Principal','owner',?)", (now,))
        db.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values('customer','business','Juan Perez',1,?,?,'remote',0)", (now, now))
        db.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,created_by,created_at,updated_at,sync_origin) values('manual','business','branch','customer','received','normal','user',?,?,'local')", (now, now))
        assert db.execute("select source_channel from photo_jobs where id='manual'").fetchone() == ("manual",)
        db.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,file_intake_status,source_channel,created_by,created_at,updated_at,sync_origin) values('web','business','branch','customer','received','normal','submitted','public_web','owner-user',?,?,'remote')", (now, now))
        assert db.execute("select source_channel from photo_jobs where id='web'").fetchone() == ("public_web",)
        try:
            db.execute("update photo_jobs set source_channel='whatever' where id='web'")
            raise AssertionError("unknown channel must be rejected")
        except sqlite3.IntegrityError:
            pass

        # Marking a pulled web job ready offline is an ordinary local change that syncs.
        db.execute("delete from photo_sync_outbox")
        db.execute("update photo_jobs set status='ready',sync_origin='local',local_revision=local_revision+1 where id='web'")
        assert db.execute("select entity_type,entity_id from photo_sync_outbox").fetchall() == [("photo_job", "web")]
        db.close()
    print("public_orders_sqlite.py: ok")


if __name__ == "__main__":
    main()
