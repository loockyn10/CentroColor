from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "supabase" / "migrations" / "20261018000000_public_photo_orders.sql").read_text(encoding="utf-8").lower()


def main() -> None:
    # Public catalog lives on PhotoService (no second catalog) and direct orders need lab + files.
    for column in ["is_public", "public_name", "public_description", "public_sort_order", "public_order_enabled"]:
        assert f"add column {column}" in SQL, column
    assert "not public_order_enabled" in SQL and "workflow_route = 'lab'" in SQL

    # Drafts are hidden from every client role by RLS and are server-owned.
    assert "add column is_draft boolean not null default false" in SQL
    assert "using(private.has_active_membership(business_id) and not is_draft)" in SQL
    assert "and source_channel = 'manual'" in SQL
    assert "new.is_draft := old.is_draft" in SQL and "new.source_channel := old.source_channel" in SQL

    # Customers are matched through a derived key, never rewritten.
    assert "phone_match_key text generated always as" in SQL
    assert "update public.customers" not in SQL

    # Upload and tracking capabilities are separate purposes; tokens are only hashed.
    assert "purpose text not null default 'upload' check(purpose in ('upload','tracking'))" in SQL
    assert " token text" not in SQL and "plain_token" not in SQL

    # Atomic, idempotent RPCs: server-only, fixed search_path, no client grants.
    for function in ["cc_public_order_start", "cc_public_order_confirm", "cc_public_order_mark_abandoned"]:
        assert f"create function public.{function}" in SQL, function
        assert f"revoke all on function public.{function}" in SQL, function
        assert f"grant execute on function public.{function}" in SQL and "to service_role" in SQL
    assert SQL.count("security definer set search_path=''") >= 4
    assert "cc_error:price_changed" in SQL
    assert "unique(business_id, client_key)" in SQL

    # Nothing is deleted: abandonment only marks.
    assert "delete from public." not in SQL and "delete from vault" not in SQL
    assert "grant delete" not in SQL
    print("public_orders_cloud_sql: ok")


if __name__ == "__main__":
    main()
