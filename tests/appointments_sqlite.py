"""Exercise local appointment storage, overlap, isolation and no-loop triggers."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in ('0003_authorized_context.sql', '0004_customers.sql', '0005_customer_sync.sql', '0009_appointments.sql'):
    db.executescript((root / 'apps/desktop/src-tauri/migrations' / migration).read_text(encoding='utf-8'))

db.execute("""INSERT INTO authorized_context VALUES
  (1,'owner','Owner','business-a','A','branch-a','Principal','owner','now')""")
for customer_id, business in [('customer-a','business-a'),('customer-b','business-b')]:
    db.execute("""INSERT INTO customers
      (id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision)
      VALUES(?,?,?,1,'now','now','remote',0)""", (customer_id,business,customer_id))

db.execute("""INSERT INTO appointment_types
  (id,business_id,name,default_duration_minutes,is_active,created_at,updated_at,local_revision)
  VALUES('type-a','business-a','Foto carnet',15,1,'now','now',1)""")
assert db.execute("SELECT count(*) FROM appointment_sync_outbox WHERE entity_type='appointment_type'").fetchone()[0] == 1
db.execute("UPDATE appointment_types SET is_active=0,local_revision=local_revision+1 WHERE id='type-a'")
assert db.execute("SELECT is_active FROM appointment_types WHERE id='type-a'").fetchone()[0] == 0
db.execute("UPDATE appointment_types SET is_active=1,local_revision=local_revision+1 WHERE id='type-a'")

def insert_appointment(identifier, start, end, status='scheduled', origin='local', branch='branch-a'):
    db.execute("""INSERT INTO appointments
      (id,business_id,branch_id,customer_id,appointment_type_id,title,starts_at,ends_at,status,
       created_by,created_at,updated_at,sync_origin,local_revision)
      VALUES(?,'business-a',?,'customer-a','type-a','Foto carnet',?,?,?,'owner','now','now',?,1)""",
      (identifier,branch,start,end,status,origin))

# ISO UTC storage round-trips without hardcoded offsets.
insert_appointment('a','2026-10-11T13:00:00.000Z','2026-10-11T13:15:00.000Z')
stored = db.execute("SELECT starts_at,ends_at FROM appointments WHERE id='a'").fetchone()
assert stored == ('2026-10-11T13:00:00.000Z','2026-10-11T13:15:00.000Z')
assert db.execute("SELECT count(*) FROM appointment_sync_outbox WHERE entity_type='appointment'").fetchone()[0] == 1

# Reprogramming preserves UUID and compacts the outbox.
db.execute("""UPDATE appointments SET starts_at='2026-10-11T14:00:00.000Z',
  ends_at='2026-10-11T14:15:00.000Z',local_revision=local_revision+1 WHERE id='a'""")
assert db.execute("SELECT id,starts_at FROM appointments WHERE id='a'").fetchone() == ('a','2026-10-11T14:00:00.000Z')
assert db.execute("SELECT count(*) FROM appointment_sync_outbox WHERE entity_type='appointment'").fetchone()[0] == 1

insert_appointment('overlap','2026-10-11T14:10:00.000Z','2026-10-11T14:30:00.000Z')
overlaps = db.execute("""SELECT count(*) FROM appointments WHERE business_id='business-a'
  AND branch_id='branch-a' AND status='scheduled' AND starts_at<? AND ends_at>? AND id<>?""",
  ('2026-10-11T14:20:00.000Z','2026-10-11T14:05:00.000Z','candidate')).fetchone()[0]
assert overlaps == 2
db.execute("UPDATE appointments SET status='cancelled',local_revision=local_revision+1 WHERE id='overlap'")
active = db.execute("""SELECT count(*) FROM appointments WHERE business_id='business-a'
  AND branch_id='branch-a' AND status='scheduled' AND starts_at<? AND ends_at>?""",
  ('2026-10-11T14:20:00.000Z','2026-10-11T14:05:00.000Z')).fetchone()[0]
assert active == 1
assert db.execute("SELECT status FROM appointments WHERE id='overlap'").fetchone()[0] == 'cancelled'
db.execute("UPDATE appointments SET status='completed',local_revision=local_revision+1 WHERE id='a'")
assert db.execute("SELECT status FROM appointments WHERE id='a'").fetchone()[0] == 'completed'
db.execute("UPDATE appointments SET status='no_show',local_revision=local_revision+1 WHERE id='a'")
assert db.execute("SELECT status FROM appointments WHERE id='a'").fetchone()[0] == 'no_show'

# Pulls are local only and do not make a new outbox operation.
pending = db.execute("SELECT count(*) FROM appointment_sync_outbox").fetchone()[0]
insert_appointment('web','2026-10-12T13:00:00.000Z','2026-10-12T13:15:00.000Z',origin='remote')
assert db.execute("SELECT count(*) FROM appointment_sync_outbox").fetchone()[0] == pending

# Same-business customer/type checks reject cross-tenant references.
try:
    db.execute("""INSERT INTO appointments
      (id,business_id,branch_id,customer_id,title,starts_at,ends_at,status,created_by,created_at,updated_at)
      VALUES('bad','business-a','branch-a','customer-b','Bad','2026-10-13T10:00:00Z','2026-10-13T11:00:00Z','scheduled','owner','now','now')""")
    raise AssertionError('cross-business customer accepted')
except sqlite3.IntegrityError:
    pass

insert_appointment('other-branch','2026-10-14T13:00:00.000Z','2026-10-14T13:15:00.000Z',branch='branch-b')
assert db.execute("SELECT count(*) FROM appointments WHERE branch_id='branch-a'").fetchone()[0] == 3
assert db.execute("SELECT count(*) FROM appointments WHERE branch_id='branch-b'").fetchone()[0] == 1
print('Appointments SQLite: create, reprogram, cancel, overlap, UTC, no-loop and isolation checks passed')
