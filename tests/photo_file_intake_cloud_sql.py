from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "supabase" / "migrations" / "20261017000000_photo_file_intake.sql").read_text(encoding="utf-8").lower()
FUNCTIONS = "\n".join(path.read_text(encoding="utf-8").lower() for path in (ROOT / "supabase" / "functions").rglob("*.ts"))


def require(source: str, value: str) -> None:
    assert value in source, f"missing Sprint 13 protection: {value}"


def main() -> None:
    for table in ["google_drive_integrations", "photo_job_upload_links", "photo_job_files"]:
        require(SQL, f"create table public.{table}")
        require(SQL, f"alter table public.{table} enable row level security")
    require(SQL, "refresh_token_secret_id uuid not null")
    require(SQL, "vault.create_secret")
    require(SQL, "photojobitem does not belong to photojob")
    require(SQL, "grant select on public.google_drive_integrations,public.photo_job_upload_links,public.photo_job_files to authenticated")
    assert "grant insert" not in SQL.split("alter table public.google_drive_integrations enable row level security")[1]
    assert "bytea" not in SQL and " blob" not in SQL
    for protection in ["sha-256", "randomtoken(32)", "link.revoked_at", "link.expires_at", "photo_job_item_id", "drive_file", "remote.parents", "remote.size", "uploadtype=resumable", "drive.file", "reconnect_required", "pedido.txt"]:
        require(FUNCTIONS, protection)
    assert "vite_" not in FUNCTIONS
    assert "refresh_token" not in (ROOT / "apps" / "web" / "src" / "photo-upload-portal.tsx").read_text(encoding="utf-8").lower()
    print("photo_file_intake_cloud_sql.py: ok")


if __name__ == "__main__":
    main()
