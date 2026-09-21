"""Check POS queue migration, ordering, pull origin and local sale atomicity."""
import sqlite3
from pathlib import Path

root = Path('apps/desktop/src-tauri/migrations')
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript((root / '0006_pos.sql').read_text(encoding='utf-8'))
db.execute("INSERT INTO product_categories VALUES ('c1','a','Marcos',1,'t1','t1')")
db.execute("INSERT INTO products VALUES ('p1','a','Marco','X',1000,NULL,'c1',1,'t1','t1')")
db.execute("INSERT INTO sales VALUES ('s1','a','branch',NULL,'user','completed',1000,1000,'cash','t1','t1')")
db.execute("INSERT INTO sale_items VALUES ('i1','a','s1','p1','Marco','X',1000,1,1000)")
db.commit()
db.executescript((root / '0007_pos_sync.sql').read_text(encoding='utf-8'))
assert db.execute("SELECT entity_type,entity_id FROM pos_sync_outbox ORDER BY entity_type").fetchall() == [
    ('category','c1'),('product','p1'),('sale','s1')]

db.execute("UPDATE products SET name='Marco nuevo',sync_origin='local',local_revision=local_revision+1 WHERE id='p1'")
assert db.execute("SELECT count(*),local_revision FROM pos_sync_outbox WHERE entity_type='product'").fetchone() == (1,1)
db.execute("UPDATE products SET name='Marco Web',sync_origin='remote',cloud_updated_at='t2' WHERE id='p1'")
assert db.execute("SELECT count(*) FROM pos_sync_outbox WHERE entity_type='product'").fetchone()[0] == 1
db.execute("DELETE FROM pos_sync_outbox WHERE entity_type='product'")
db.execute("UPDATE products SET name='Marco Desktop',sync_origin='local',local_revision=local_revision+1 WHERE id='p1'")
assert db.execute("SELECT local_revision FROM pos_sync_outbox WHERE entity_type='product'").fetchone() == (2,)

db.execute("INSERT INTO product_categories(id,business_id,name,is_active,created_at,updated_at,sync_origin,cloud_updated_at) VALUES ('c2','a','Álbumes',1,'t2','t2','remote','t2')")
db.execute("INSERT INTO products(id,business_id,name,barcode,sale_price_cents,is_active,created_at,updated_at,sync_origin,cloud_updated_at,category_id) VALUES ('p2','a','Álbum','Y',2000,1,'t2','t2','remote','t2','c2')")
assert db.execute("SELECT count(*) FROM pos_sync_outbox WHERE entity_id IN ('c2','p2')").fetchone()[0] == 0
try:
    db.execute("INSERT INTO products(id,business_id,name,barcode,sale_price_cents,is_active,created_at,updated_at) VALUES ('p3','a','Duplicado','Y',2000,1,'t2','t2')")
    raise AssertionError('barcode duplicado aceptado')
except sqlite3.IntegrityError:
    pass

with db:
    db.execute("INSERT INTO sales(id,business_id,branch_id,created_by,status,subtotal_cents,total_cents,payment_method,created_at,updated_at,sync_origin) VALUES ('s2','a','branch','user','completed',2000,2000,'cash','t2','t2','remote')")
    db.execute("INSERT INTO sale_items VALUES ('i2','a','s2','p2','Álbum','Y',2000,1,2000)")
assert db.execute("SELECT count(*) FROM pos_sync_outbox WHERE entity_id='s2'").fetchone()[0] == 0
assert db.execute("SELECT product_name,unit_price_cents FROM sale_items WHERE id='i2'").fetchone() == ('Álbum',2000)
print('POS sync SQLite: backfill, compact outbox, remote loop prevention, barcode, sale bundle passed')
