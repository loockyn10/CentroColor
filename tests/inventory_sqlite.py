"""Exercise SQLite inventory migration and its atomic ledger triggers."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in ('0003_authorized_context.sql', '0006_pos.sql', '0007_pos_sync.sql', '0008_inventory.sql'):
    db.executescript((root / 'apps/desktop/src-tauri/migrations' / migration).read_text(encoding='utf-8'))

db.execute("""INSERT INTO authorized_context VALUES
  (1,'owner','Owner','business-a','A','branch-a','A','owner','now')""")
for product_id, business in [('p1','business-a'),('p2','business-a'),('p3','business-a'),('other','business-b')]:
    db.execute("""INSERT INTO products(id,business_id,name,sale_price_cents,is_active,created_at,updated_at)
      VALUES(?,?,?,100,1,'now','now')""", (product_id,business,product_id))

# Products and sales from earlier sprints remain untracked.
assert db.execute('SELECT sum(tracks_inventory) FROM products').fetchone()[0] == 0
db.execute("""INSERT INTO sales(id,business_id,branch_id,created_by,status,subtotal_cents,total_cents,payment_method,created_at,updated_at)
  VALUES('old','business-a','branch-a','owner','completed',100,100,'cash','old','old')""")
db.execute("""INSERT INTO sale_items(id,business_id,sale_id,product_id,product_name,unit_price_cents,quantity,total_cents)
  VALUES('old-item','business-a','old','p1','p1',100,1,100)""")
assert db.execute('SELECT count(*) FROM stock_movements').fetchone()[0] == 0

db.execute("UPDATE products SET tracks_inventory=1,sync_origin='local' WHERE id='p1'")
db.execute("UPDATE products SET tracks_inventory=1,sync_origin='local' WHERE id='p2'")

def movement(mid, product, branch, kind, delta, origin='local'):
    db.execute("""INSERT OR IGNORE INTO stock_movements
      (id,business_id,branch_id,product_id,movement_type,quantity_delta,created_by,occurred_at,sync_origin)
      VALUES(?,'business-a',?,?,?,?,'owner','now',?)""", (mid,branch,product,kind,delta,origin))

def balance(product='p1', branch='branch-a'):
    row = db.execute('SELECT quantity FROM inventory_balances WHERE business_id=? AND branch_id=? AND product_id=?',
                     ('business-a',branch,product)).fetchone()
    return row[0] if row else 0

movement('initial', 'p1', 'branch-a', 'initial', 10)
assert balance() == 10
movement('entry', 'p1', 'branch-a', 'entry', 5)
assert balance() == 15
movement('adjust-down', 'p1', 'branch-a', 'adjustment', -4)
assert balance() == 11
movement('adjust-up', 'p1', 'branch-a', 'adjustment', 2)
assert balance() == 13
movement('other-branch', 'p1', 'branch-b', 'entry', 3)
assert balance() == 13 and balance(branch='branch-b') == 3

db.execute("""INSERT INTO sales(id,business_id,branch_id,created_by,status,subtotal_cents,total_cents,payment_method,created_at,updated_at)
  VALUES('sale','business-a','branch-a','owner','completed',600,600,'cash','now','now')""")
for item_id, product, quantity, tracked in [('item-1','p1',2,1),('item-2','p2',3,1),('item-3','p3',1,0)]:
    db.execute("""INSERT INTO sale_items(id,business_id,sale_id,product_id,product_name,
      unit_price_cents,quantity,total_cents,tracks_inventory) VALUES(?,?,?,?,?,100,?,?,?)""",
      (item_id,'business-a','sale',product,product,quantity,quantity*100,tracked))
assert balance() == 11 and balance('p2') == -3 and balance('p3') == 0
assert db.execute("SELECT count(*) FROM stock_movements WHERE sale_id='sale'").fetchone()[0] == 2
assert db.execute("SELECT quantity_delta FROM stock_movements WHERE sale_item_id='item-1'").fetchone()[0] == -2

# Retrying the same sale item/movement UUID does not apply the delta twice.
db.execute("""INSERT OR IGNORE INTO sale_items(id,business_id,sale_id,product_id,product_name,
  unit_price_cents,quantity,total_cents,tracks_inventory) VALUES('item-1','business-a','sale','p1','p1',100,2,200,1)""")
assert balance() == 11
assert db.execute("SELECT count(*) FROM stock_sync_outbox").fetchone()[0] == 7

# Pulls materialize once and never enqueue a push.
pending = db.execute('SELECT count(*) FROM stock_sync_outbox').fetchone()[0]
movement('web-entry', 'p1', 'branch-a', 'entry', 4, 'remote')
movement('web-entry', 'p1', 'branch-a', 'entry', 4, 'remote')
assert balance() == 15
assert db.execute('SELECT count(*) FROM stock_sync_outbox').fetchone()[0] == pending

# Business isolation and staff restrictions.
try:
    movement('bad', 'other', 'branch-a', 'entry', 1)
    raise AssertionError('cross-business movement accepted')
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE authorized_context SET role='staff' WHERE slot=1")
try:
    db.execute("UPDATE products SET tracks_inventory=0,sync_origin='local' WHERE id='p1'")
    raise AssertionError('staff changed tracking')
except sqlite3.IntegrityError:
    pass
db.execute("UPDATE authorized_context SET role='admin' WHERE slot=1")
db.execute("UPDATE products SET tracks_inventory=0,sync_origin='local' WHERE id='p1'")
assert db.execute("SELECT count(*) FROM stock_movements WHERE product_id='p1'").fetchone()[0] == 7
print('Inventory SQLite: ledger, sale, retry, negative, pull, branch/business and role checks passed')
