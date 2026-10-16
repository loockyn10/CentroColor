from pathlib import Path

SQL = (Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261015000000_photo_jobs.sql").read_text(encoding="utf-8").lower()


def require(value: str) -> None:
    assert value in SQL, f"missing cloud SQL protection: {value}"


def main() -> None:
    for table in ["photo_services", "photo_jobs", "photo_job_items"]:
        require(f"create table public.{table}")
        require(f"alter table public.{table} enable row level security")
    require("foreign key(business_id,customer_id)")
    require("foreign key(business_id,source_appointment_id)")
    require("foreign key(business_id,source_event_id)")
    require("foreign key(business_id,photo_job_id)")
    require("foreign key(business_id,photo_service_id)")
    require("security definer set search_path=''")
    require("auth.uid()")
    require("created_by=(select auth.uid())")
    require("m.role in('owner','admin')")
    require("photo_guard_immutable_identity")
    require("grant select,insert,update")
    assert "service_role" not in SQL
    assert "grant delete" not in SQL
    print("photo_cloud_sql.py: ok")


if __name__ == "__main__":
    main()
