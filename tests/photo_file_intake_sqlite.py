import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        db = sqlite3.connect(Path(directory) / "intake.db")
        db.execute("pragma foreign_keys=on")
        db.execute("create table app_meta(key text primary key,value text not null)")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))
        now = "2026-10-16T12:00:00Z"
        db.execute("insert into authorized_context values(1,'user','Owner','business','CentroColor','branch','Principal','owner',?)", (now,))
        db.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values('customer','business','Juan Perez',1,?,?,'remote',0)", (now, now))
        db.execute("insert into photo_services(id,business_id,name,service_type,default_unit_price_cents,workflow_route,requires_customer_files,is_active,created_at,updated_at,sync_origin) values('service','business','10x15','print',100,'lab',1,1,?,?,'remote')", (now, now))
        db.execute("insert into photo_jobs(id,business_id,branch_id,customer_id,status,priority,file_intake_status,created_by,created_at,updated_at,sync_origin) values('job','business','branch','customer','received','normal','submitted','user',?,?,'remote')", (now, now))
        db.execute("insert into photo_job_items(id,business_id,photo_job_id,photo_service_id,service_name_snapshot,quantity,unit_price_cents,total_cents,is_active,created_at,updated_at,sync_origin) values('item','business','job','service','10x15',2,100,200,1,?,?,'remote')", (now, now))
        before = db.execute("select count(*) from photo_sync_outbox").fetchone()[0]
        db.execute("insert into photo_job_files values('file','business','job','item','drive-file','drive-folder','IMG.jpg','safe-IMG.jpg','image/jpeg',1000,2,'lab','uploaded',?,?,?)", (now, now, now))
        assert db.execute("select copies,status from photo_job_files where id='file'").fetchone() == (2, "uploaded")
        assert db.execute("select count(*) from photo_sync_outbox").fetchone()[0] == before
        assert "blob" not in {row[1].lower() for row in db.execute("pragma table_info(photo_job_files)")}
        try:
            db.execute("insert into photo_job_files values('bad','business','job','missing','x','folder','x.jpg','x.jpg','image/jpeg',1,1,'lab','uploaded',?,?,?)", (now, now, now))
            raise AssertionError("cross-item metadata should fail")
        except sqlite3.IntegrityError:
            pass
        db.close()
    print("photo_file_intake_sqlite.py: ok")


if __name__ == "__main__":
    main()
