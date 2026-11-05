"""Papelera de catálogos en SQLite (migración 0020): eliminar ≠ inactivo, outbox, código de barras,
historial intacto y restauración."""
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"
B = "business-a"


def outbox(db, table, entity_type):
    return db.execute(
        f"SELECT count(*) FROM {table} WHERE entity_type=? AND business_id=?", (entity_type, B)
    ).fetchone()[0]


def expect_unique_violation(db, sql, params=()):
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError as error:
        assert "UNIQUE" in str(error), error
        return
    raise AssertionError("se esperaba una violación UNIQUE")


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        db = sqlite3.connect(Path(directory) / "trash.db")
        db.execute("pragma foreign_keys=on")
        db.execute("create table app_meta(key text primary key,value text not null)")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            db.executescript(path.read_text(encoding="utf-8"))
        assert (MIGRATIONS / "0020_catalog_trash.sql").exists()

        # ── Productos ────────────────────────────────────────────────────────────────────
        db.execute("INSERT INTO product_categories(id,business_id,name,created_at,updated_at) VALUES('c1',?,'Marcos','t','t')", (B,))
        db.execute(
            "INSERT INTO products(id,business_id,name,barcode,sale_price_cents,category_id,created_at,updated_at)"
            " VALUES('p1',?,'Producto prueba 123','777',1500,'c1','t','t')",
            (B,),
        )
        db.execute("INSERT INTO sales(id,business_id,branch_id,created_by,status,subtotal_cents,total_cents,payment_method,created_at,updated_at)"
                   " VALUES('s1',?,'branch','user','completed',1500,1500,'cash','t','t')", (B,))
        db.execute("INSERT INTO sale_items(id,business_id,sale_id,product_id,product_name,barcode,unit_price_cents,quantity,total_cents)"
                   " VALUES('i1',?,'s1','p1','Producto prueba 123','777',1500,1,1500)", (B,))
        db.execute("DELETE FROM pos_sync_outbox")

        # Eliminar: sólo deleted_at; is_active NO cambia (eliminado ≠ inactivo).
        db.execute(
            "UPDATE products SET deleted_at='2026-11-05T10:00:00Z',updated_at='t2',sync_origin='local',local_revision=local_revision+1 WHERE id='p1'"
        )
        assert db.execute("SELECT is_active,deleted_at FROM products WHERE id='p1'").fetchone() == (1, "2026-11-05T10:00:00Z")
        assert outbox(db, "pos_sync_outbox", "product") == 1, "la eliminación debe salir por el outbox"

        # Los listados normales no lo ven; el inactivo sí se ve.
        live = "SELECT id FROM products WHERE business_id=? AND deleted_at IS NULL"
        assert db.execute(live, (B,)).fetchall() == []
        db.execute(
            "INSERT INTO products(id,business_id,name,barcode,sale_price_cents,is_active,created_at,updated_at)"
            " VALUES('p-inactive',?,'Inactivo','888',1,0,'t','t')",
            (B,),
        )
        assert db.execute(live, (B,)).fetchall() == [("p-inactive",)], "inactivo sigue en el listado; eliminado no"

        # Historial: la venta conserva el producto (fila y snapshot).
        item = db.execute(
            "SELECT i.product_id,i.product_name,p.name FROM sale_items i JOIN products p ON p.id=i.product_id WHERE i.id='i1'"
        ).fetchone()
        assert item == ("p1", "Producto prueba 123", "Producto prueba 123")

        # El código de barras queda libre mientras está en la Papelera…
        db.execute(
            "INSERT INTO products(id,business_id,name,barcode,sale_price_cents,created_at,updated_at)"
            " VALUES('p2',?,'Reposición','777',1600,'t','t')",
            (B,),
        )
        # …y restaurar el viejo choca con el vivo.
        expect_unique_violation(db, "UPDATE products SET deleted_at=NULL WHERE id='p1'")
        # Dos vivos con el mismo código siguen prohibidos.
        expect_unique_violation(
            db,
            "INSERT INTO products(id,business_id,name,barcode,sale_price_cents,created_at,updated_at)"
            " VALUES('p3',?,'Duplicado','777',1,'t','t')",
            (B,),
        )
        # Al eliminar el vivo, el viejo se puede restaurar y conserva su estado Activo.
        db.execute("DELETE FROM pos_sync_outbox")
        db.execute("UPDATE products SET deleted_at='x',sync_origin='local',local_revision=local_revision+1 WHERE id='p2'")
        db.execute("UPDATE products SET deleted_at=NULL,updated_at='t3',sync_origin='local',local_revision=local_revision+1 WHERE id='p1'")
        assert db.execute("SELECT is_active,deleted_at FROM products WHERE id='p1'").fetchone() == (1, None)
        assert outbox(db, "pos_sync_outbox", "product") == 2, "p1 y p2 pendientes de subir"

        # Un cambio que llega de Cloud (sync_origin='remote') no vuelve a encolarse.
        db.execute("DELETE FROM pos_sync_outbox")
        db.execute("UPDATE products SET deleted_at='2026-11-05T11:00:00Z',sync_origin='remote',cloud_updated_at='c' WHERE id='p1'")
        assert outbox(db, "pos_sync_outbox", "product") == 0

        # Categorías: eliminar encola; los productos conservan category_id; el nombre sigue reservado.
        db.execute("DELETE FROM pos_sync_outbox")
        db.execute("UPDATE product_categories SET deleted_at='x',sync_origin='local',local_revision=local_revision+1 WHERE id='c1'")
        assert outbox(db, "pos_sync_outbox", "category") == 1
        assert db.execute("SELECT category_id FROM products WHERE id='p1'").fetchone() == ("c1",)
        expect_unique_violation(
            db,
            "INSERT INTO product_categories(id,business_id,name,created_at,updated_at) VALUES('c2',?,'Marcos','t','t')",
            (B,),
        )

        # ── Turnos, eventos, recursos y marquetería: el trigger de salida mira deleted_at ──
        db.execute("INSERT INTO appointment_types(id,business_id,name,default_duration_minutes,created_at,updated_at) VALUES('at1',?,'Retiro',15,'t','t')", (B,))
        db.execute("INSERT INTO event_types(id,business_id,name,created_at,updated_at) VALUES('et1',?,'Casamiento','t','t')", (B,))
        db.execute("INSERT INTO resources(id,business_id,name,created_at,updated_at) VALUES('r1',?,'Proyector','t','t')", (B,))
        db.execute("INSERT INTO frame_mouldings(id,business_id,name,cost_per_meter_cents,created_at,updated_at) VALUES('m1',?,'Roble',1000,'t','t')", (B,))
        db.execute(
            "INSERT INTO frame_materials(id,business_id,name,material_type,pricing_unit,cost_cents,created_at,updated_at)"
            " VALUES('f1',?,'Vidrio 2mm','glass','square_meter',500,'t','t')",
            (B,),
        )
        for outbox_table in ("appointment_sync_outbox", "event_sync_outbox", "framing_sync_outbox"):
            db.execute(f"DELETE FROM {outbox_table}")
        cases = [
            ("appointment_types", "at1", "appointment_sync_outbox", "appointment_type"),
            ("event_types", "et1", "event_sync_outbox", "event_type"),
            ("resources", "r1", "event_sync_outbox", "resource"),
            ("frame_mouldings", "m1", "framing_sync_outbox", "moulding"),
            ("frame_materials", "f1", "framing_sync_outbox", "material"),
        ]
        for table, entity_id, outbox_table, entity_type in cases:
            db.execute(
                f"UPDATE {table} SET deleted_at='2026-11-05T12:00:00Z',updated_at='t9',sync_origin='local',local_revision=local_revision+1 WHERE id=?",
                (entity_id,),
            )
            assert outbox(db, outbox_table, entity_type) == 1, f"{table}: eliminar debe encolarse"
            assert db.execute(f"SELECT is_active FROM {table} WHERE id=?", (entity_id,)).fetchone() == (1,)
            db.execute(f"DELETE FROM {outbox_table} WHERE entity_type=?", (entity_type,))
            db.execute(
                f"UPDATE {table} SET deleted_at=NULL,updated_at='t10',sync_origin='local',local_revision=local_revision+1 WHERE id=?",
                (entity_id,),
            )
            assert outbox(db, outbox_table, entity_type) == 1, f"{table}: restaurar debe encolarse"
            assert db.execute(f"SELECT deleted_at FROM {table} WHERE id=?", (entity_id,)).fetchone() == (None,)

        db.commit()
        db.close()
    print("catalog_trash_sqlite: OK")


if __name__ == "__main__":
    main()
