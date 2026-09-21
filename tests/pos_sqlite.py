"""Exercise the incremental POS schema with the same SQLite engine semantics."""
import sqlite3
from pathlib import Path


sql = Path('apps/desktop/src-tauri/migrations/0006_pos.sql').read_text(encoding='utf-8')
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript(sql)

def product(product_id, business, barcode):
    db.execute('''INSERT INTO products
      (id,business_id,name,barcode,sale_price_cents,cost_price_cents,category_id,is_active,created_at,updated_at)
      VALUES (?,?,?,?,1299,NULL,NULL,1,'now','now')''', (product_id, business, 'Album', barcode))

product('p1', 'a', None)
product('p2', 'a', None)
product('p3', 'a', '779')
product('p4', 'b', '779')
assert db.execute('SELECT id FROM products WHERE business_id=? AND barcode=?', ('a', '779')).fetchone() == ('p3',)
try:
    product('p5', 'a', '779')
    raise AssertionError('same-business barcode duplicate accepted')
except sqlite3.IntegrityError:
    pass
db.commit()

try:
    db.execute('BEGIN')
    db.execute('''INSERT INTO sales VALUES
      ('s1','a','branch',NULL,'user','completed',1299,1299,'cash','now','now')''')
    db.execute('''INSERT INTO sale_items VALUES
      ('i1','a','s1','p4','Album','779',1299,1,1299)''')
    db.commit()
    raise AssertionError('cross-business item accepted')
except sqlite3.IntegrityError:
    db.rollback()
assert db.execute('SELECT count(*) FROM sales').fetchone()[0] == 0

with db:
    db.execute('''INSERT INTO sales VALUES
      ('s2','a','branch',NULL,'user','completed',2598,2598,'debit','now','now')''')
    db.execute('''INSERT INTO sale_items VALUES
      ('i2','a','s2','p3','Album','779',1299,2,2598)''')
db.execute('UPDATE products SET name=?,sale_price_cents=? WHERE id=?', ('Renamed', 9000, 'p3'))
assert db.execute('SELECT product_name,unit_price_cents,total_cents FROM sale_items WHERE id=?', ('i2',)).fetchone() == ('Album', 1299, 2598)
print('POS SQLite schema: constraints, business isolation, rollback and snapshots passed')
