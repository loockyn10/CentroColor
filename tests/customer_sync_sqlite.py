"""Focused migration test using Python's standard SQLite driver."""

import pathlib
import sqlite3
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"


class CustomerSyncSqliteTests(unittest.TestCase):
    def test_migration_and_atomic_outbox(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "centrocolor.db"
            db = sqlite3.connect(path)
            db.executescript((MIGRATIONS / "0004_customers.sql").read_text())
            db.execute(
                "INSERT INTO customers (id,business_id,full_name,created_at,updated_at) "
                "VALUES (?,?,?,?,?)",
                ("old", "business-a", "Anterior", "2026-09-20T00:00:00Z", "2026-09-20T00:00:00Z"),
            )
            db.executescript((MIGRATIONS / "0005_customer_sync.sql").read_text())
            self.assertEqual(
                db.execute("SELECT entity_id FROM sync_outbox").fetchall(), [("old",)]
            )

            db.execute(
                "INSERT INTO customers (id,business_id,full_name,created_at,updated_at,local_revision) "
                "VALUES (?,?,?,?,?,1)",
                ("new", "business-a", "Nueva", "2026-09-20T01:00:00Z", "2026-09-20T01:00:00Z"),
            )
            self.assertEqual(
                db.execute("SELECT count(*) FROM sync_outbox WHERE entity_id='new'").fetchone()[0], 1
            )
            db.execute(
                "UPDATE customers SET phone=?,updated_at=?,sync_origin='local',"
                "local_revision=local_revision+1 WHERE id='new'",
                ("123", "2026-09-20T02:00:00Z"),
            )
            db.execute(
                "UPDATE customers SET is_active=0,updated_at=?,sync_origin='local',"
                "local_revision=local_revision+1 WHERE id='new'",
                ("2026-09-20T03:00:00Z",),
            )
            db.execute(
                "UPDATE customers SET is_active=1,updated_at=?,sync_origin='local',"
                "local_revision=local_revision+1 WHERE id='new'",
                ("2026-09-20T04:00:00Z",),
            )
            self.assertEqual(
                db.execute(
                    "SELECT count(*),max(local_revision) FROM sync_outbox WHERE entity_id='new'"
                ).fetchone(), (1, 4)
            )

            db.execute(
                "INSERT INTO customers (id,business_id,full_name,created_at,updated_at,"
                "sync_origin,cloud_updated_at) VALUES (?,?,?,?,?,'remote',?)",
                ("web", "business-b", "Desde Web", "2026-09-20T01:00:00Z", "2026-09-20T01:00:00Z", "2026-09-20T01:00:00Z"),
            )
            db.execute(
                "UPDATE customers SET full_name='Editado en Web',sync_origin='remote' WHERE id='web'"
            )
            self.assertEqual(
                db.execute("SELECT count(*) FROM sync_outbox WHERE entity_id='web'").fetchone()[0], 0
            )
            db.commit()
            db.close()

            reopened = sqlite3.connect(path)
            self.assertEqual(
                reopened.execute("SELECT count(*) FROM sync_outbox WHERE business_id='business-a'").fetchone()[0], 2
            )
            self.assertEqual(
                reopened.execute("SELECT full_name FROM customers WHERE id='web' AND business_id='business-b'").fetchone()[0],
                "Editado en Web",
            )
            reopened.close()


if __name__ == "__main__":
    unittest.main()
