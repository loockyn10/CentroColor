from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SQL = (
    ROOT
    / "supabase"
    / "migrations"
    / "20261017010000_google_drive_oauth_hardening.sql"
).read_text(encoding="utf-8").lower()


def main() -> None:
    assert "add column consumed_at timestamptz" in SQL
    assert "grant select,insert,update on public.google_oauth_states to service_role" in SQL
    assert "grant select,insert,update on public.google_drive_integrations to service_role" in SQL
    assert "cc_complete_google_drive_oauth" in SQL
    integration_position = SQL.index("insert into public.google_drive_integrations")
    vault_cleanup_position = SQL.index("delete from vault.secrets")
    consumed_position = SQL.index("set consumed_at=pg_catalog.clock_timestamp()")
    assert integration_position < vault_cleanup_position < consumed_position
    assert "to service_role" in SQL
    assert "to authenticated" not in SQL.split("create function", 1)[0]
    print("google_drive_oauth_hardening_sql: ok")


if __name__ == "__main__":
    main()
