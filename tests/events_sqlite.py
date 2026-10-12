import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "desktop" / "src-tauri" / "migrations"


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        connection = sqlite3.connect(Path(directory) / "events.db")
        connection.execute("pragma foreign_keys=on")
        connection.execute("create table app_meta(key text primary key,value text not null)")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            connection.executescript(path.read_text(encoding="utf-8"))

        business = "00000000-0000-4000-8000-000000000001"
        other_business = "00000000-0000-4000-8000-000000000002"
        branch = "00000000-0000-4000-8000-000000000011"
        user = "00000000-0000-4000-8000-000000000021"
        now = "2026-10-11T12:00:00.000Z"
        connection.execute(
            "insert into authorized_context values(1,?,?,?,?,?,?,?,?)",
            (user, "Owner", business, "CentroColor", branch, "Principal", "owner", now),
        )
        for bid, customer in [(business, "c1"), (other_business, "c2")]:
            connection.execute(
                "insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin,local_revision) values(?,?,?,1,?,?,'remote',0)",
                (customer, bid, "Cliente", now, now),
            )
        connection.execute(
            "insert into event_types values('type',?,'Alquiler',1,?,?,'local',1,null)",
            (business, now, now),
        )
        connection.execute(
            "insert into resources values('cabina',?,'Cabina',null,10000,1,?,?,'local',1,null)",
            (business, now, now),
        )
        connection.execute(
            "insert into resources values('pantalla',?,'Pantalla',null,12000,1,?,?,'local',1,null)",
            (business, now, now),
        )
        connection.execute(
            "insert into resources values('inactivo',?,'Inactivo',null,0,0,?,?,'local',1,null)",
            (business, now, now),
        )

        def event(identifier: str, status: str, customer: str = "c1") -> None:
            connection.execute(
                "insert into events values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'local',1,null)",
                (
                    identifier,
                    business,
                    branch,
                    customer,
                    "type",
                    f"Evento {identifier}",
                    "2026-11-21T20:00:00.000Z",
                    "2026-11-22T05:00:00.000Z",
                    None,
                    None,
                    status,
                    None,
                    user,
                    now,
                    now,
                ),
            )

        event("event-a", "reserved")
        connection.execute(
            "insert into resource_reservations values('rr-a',?,'event-a','cabina','2026-11-21T22:00:00.000Z','2026-11-22T02:00:00.000Z',10000,null,1,?,?,'local',1,null)",
            (business, now, now),
        )

        event("event-b", "inquiry")
        connection.execute(
            "insert into resource_reservations values('rr-b',?,'event-b','cabina','2026-11-21T23:00:00.000Z','2026-11-22T01:00:00.000Z',10000,null,1,?,?,'local',1,null)",
            (business, now, now),
        )
        try:
            connection.execute("update events set status='reserved' where id='event-b'")
            raise AssertionError("overlap should block reservation")
        except sqlite3.IntegrityError as error:
            assert "no está disponible" in str(error)

        connection.execute(
            "update resource_reservations set starts_at='2026-11-22T02:00:00.000Z',ends_at='2026-11-22T03:00:00.000Z' where id='rr-b'"
        )
        connection.execute("update events set status='reserved' where id='event-b'")

        event("event-c", "reserved")
        connection.execute(
            "insert into resource_reservations values('rr-c',?,'event-c','pantalla','2026-11-21T23:00:00.000Z','2026-11-22T01:00:00.000Z',12000,null,1,?,?,'local',1,null)",
            (business, now, now),
        )
        try:
            connection.execute(
                "insert into resource_reservations values('rr-inactive',?,'event-c','inactivo','2026-11-22T02:00:00.000Z','2026-11-22T03:00:00.000Z',0,null,1,?,?,'local',1,null)",
                (business, now, now),
            )
            raise AssertionError("inactive resource should fail")
        except sqlite3.IntegrityError as error:
            assert "inactivo" in str(error).lower()

        connection.execute("update events set status='cancelled' where id='event-a'")
        event("event-d", "reserved")
        connection.execute(
            "insert into resource_reservations values('rr-d',?,'event-d','cabina','2026-11-21T22:00:00.000Z','2026-11-22T02:00:00.000Z',10000,null,1,?,?,'local',1,null)",
            (business, now, now),
        )

        try:
            event("bad-business", "inquiry", "c2")
            raise AssertionError("customer business mismatch should fail")
        except sqlite3.IntegrityError as error:
            assert "cliente" in str(error).lower()

        try:
            connection.execute(
                "insert into events values('bad-branch',?,?,?,?,?,?,?,?,?,?,?,?,?,?,'local',1,null)",
                (
                    business,
                    "otra-sucursal",
                    "c1",
                    "type",
                    "Sucursal inválida",
                    "2026-11-21T20:00:00.000Z",
                    "2026-11-22T05:00:00.000Z",
                    None,
                    None,
                    "inquiry",
                    None,
                    user,
                    now,
                    now,
                ),
            )
            raise AssertionError("branch outside authorized context should fail")
        except sqlite3.IntegrityError as error:
            assert "contexto autorizado" in str(error).lower()

        before = connection.execute(
            "select count(*) from event_sync_outbox where entity_type='resource'"
        ).fetchone()[0]
        connection.execute(
            "insert into resources values('remote',?,'Remoto',null,null,1,?,?,'remote',0,?)",
            (business, now, now, now),
        )
        after = connection.execute(
            "select count(*) from event_sync_outbox where entity_type='resource'"
        ).fetchone()[0]
        assert before == after, "pull remoto no debe generar outbox"
        assert connection.execute(
            "select count(*) from event_service_items where event_id='event-d'"
        ).fetchone()[0] == 0, "alquiler puro debe admitir cero servicios"
        assert connection.execute(
            "select count(*) from event_sync_outbox where entity_type='event'"
        ).fetchone()[0] >= 1, "evento offline debe entrar al outbox"
        connection.close()
    print("events_sqlite.py: ok")


if __name__ == "__main__":
    main()
