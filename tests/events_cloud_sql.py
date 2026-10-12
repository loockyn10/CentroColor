from pathlib import Path

SQL = (Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261012000000_events_resources.sql").read_text(encoding="utf-8").lower()


def require(value: str) -> None:
    assert value in SQL, f"missing cloud SQL protection: {value}"


def main() -> None:
    for table in ["event_types", "events", "event_service_items", "resources", "resource_reservations"]:
        require(f"create table public.{table}")
        require(f"alter table public.{table} enable row level security")
    require("foreign key (business_id,customer_id)")
    require("foreign key (business_id,resource_id)")
    require("foreign key (business_id,event_id)")
    require("security definer set search_path=''")
    require("auth.uid()")
    require("pg_advisory_xact_lock")
    require("resource_reservation_conflict")
    require("rr.starts_at<new.ends_at and rr.ends_at>new.starts_at")
    require("e.status in ('reserved','completed')")
    require("grant update(resource_id,starts_at,ends_at,price_cents,notes,is_active)")
    assert "service_role" not in SQL
    assert "grant delete" not in SQL
    print("events_cloud_sql.py: ok")


if __name__ == "__main__":
    main()
