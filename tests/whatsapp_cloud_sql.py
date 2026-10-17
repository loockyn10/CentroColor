from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "supabase" / "migrations" / "20261018010000_whatsapp_notifications.sql").read_text(encoding="utf-8").lower()


def main() -> None:
    # The access token is never a column: only a reference to a Vault secret.
    table = SQL.split("create table public.whatsapp_integrations", 1)[1].split(");", 1)[0]
    assert "access_token_secret_id uuid not null" in table
    assert "access_token text" not in table and " token text" not in table
    assert "revoke all on public.whatsapp_integrations from public, anon, authenticated" in SQL
    assert "grant select on public.whatsapp_integrations to service_role" in SQL

    # One automatic ready notice per job, enforced by a UNIQUE key (not by the UI).
    assert "unique(business_id, idempotency_key)" in SQL
    assert "'photo_job:' || new.id::text || ':ready:whatsapp'" in SQL
    assert "on conflict(business_id, idempotency_key) do nothing" in SQL
    assert "when (new.status = 'ready' and old.status is distinct from 'ready')" in SQL

    # The trigger can never block a status change.
    assert "exception when others then" in SQL and "raise warning" in SQL

    # Statuses and fields required by the audit trail; no DELETE anywhere.
    for status in ["pending", "sending", "sent", "failed", "delivered"]:
        assert f"'{status}'" in SQL, status
    assert "grant delete" not in SQL and "grant update on public.outbound_notifications" not in SQL
    assert "grant select on public.outbound_notifications, public.outbound_notification_events to authenticated" in SQL

    # Manual resend is a new, audited row; webhook receipts never move a status backwards.
    assert "':ready:whatsapp:resend:'" in SQL and "'manual_resend'" in SQL
    assert "status = 'failed' returning id into v_id" in SQL
    assert "v_row.status in ('sent')" in SQL
    print("whatsapp_cloud_sql: ok")


if __name__ == "__main__":
    main()
