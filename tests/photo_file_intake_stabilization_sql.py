from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SQL = (
    ROOT / "supabase" / "migrations" / "20261017020000_photo_file_intake_stabilization.sql"
).read_text(encoding="utf-8").lower()


def main() -> None:
    # service_role needs explicit DML: the project does not auto-grant it on new tables.
    assert "grant select on" in SQL and "public.photo_jobs" in SQL
    assert "grant update (file_intake_status, drive_folder_id, drive_edited_folder_id)" in SQL
    assert "grant select, insert, update on" in SQL
    for table in ["photo_job_upload_links", "photo_job_files", "photo_job_drive_folders"]:
        assert f"public.{table}" in SQL
    assert " delete" not in SQL.replace("no delete", "")
    assert "to anon" not in SQL and "to authenticated" not in SQL

    # The shared identity guard must branch per table (no table-specific NEW fields in one expression).
    function = SQL.split("create or replace function private.photo_guard_immutable_identity", 1)[1].split("$$;", 1)[0]
    assert "if tg_table_name='photo_jobs' then" in function
    assert "elsif tg_table_name='photo_job_items' then" in function
    assert " and new." not in function

    # Intake columns are server-owned for client roles.
    assert "current_user in ('authenticated','anon')" in SQL
    assert "new.file_intake_status := old.file_intake_status" in SQL
    print("photo_file_intake_stabilization_sql: ok")


if __name__ == "__main__":
    main()
