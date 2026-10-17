-- Sprint 13 stabilization: explicit server-side privileges for the photo file intake Edge Functions.
--
-- Root cause: this project does not auto-grant DML on new public tables to service_role
-- (verified on the linked project: service_role only held REFERENCES/TRIGGER/TRUNCATE).
-- The Edge Functions use service_role only AFTER authenticating the admin JWT (admin
-- functions) or validating the hashed public token (portal functions), and every query
-- failed with "permission denied" (42501). Reads returned no rows silently and the first
-- INSERT surfaced as a non-2xx response.
--
-- RLS stays enabled; service_role bypasses it by design. No privilege is granted to
-- anon or authenticated, and no DELETE is granted: intake rows are revoked/closed, never
-- hard-deleted by the Edge Functions.

-- Read-only access to the rows that describe a job, its customer and its services.
grant select on
  public.businesses,
  public.customers,
  public.photo_services,
  public.photo_job_items,
  public.photo_jobs
to service_role;

-- The functions only move intake/Drive metadata on the job. Column-scoped so the
-- service role cannot rewrite commercial fields through these functions.
grant update (file_intake_status, drive_folder_id, drive_edited_folder_id)
  on public.photo_jobs to service_role;

-- Intake state written exclusively by Edge Functions.
grant select, insert, update on
  public.photo_job_upload_links,
  public.photo_job_files,
  public.photo_job_drive_folders
to service_role;

-- Latent Sprint 11 bug: every UPDATE on photo_jobs, photo_job_items and photo_services failed
-- with 42703 ('record "new" has no field ...') because one shared trigger function put
-- table-specific NEW fields inside a single boolean expression. PostgreSQL does not guarantee
-- AND short-circuiting, so the field of the other table was resolved anyway. Verified on the
-- linked project (rolled-back probe): status changes, edits and the Edge Functions' own
-- intake/Drive updates could never succeed. Same checks, one branch per table.
create or replace function private.photo_guard_immutable_identity() returns trigger
language plpgsql set search_path=''
as $$
begin
  if new.id<>old.id or new.business_id<>old.business_id or new.created_at<>old.created_at then
    raise exception 'Photo identity fields are immutable';
  end if;
  if tg_table_name='photo_jobs' then
    if new.branch_id<>old.branch_id or new.created_by<>old.created_by then
      raise exception 'PhotoJob structural fields are immutable';
    end if;
  elsif tg_table_name='photo_job_items' then
    if new.photo_job_id<>old.photo_job_id then
      raise exception 'PhotoJobItem parent is immutable';
    end if;
  end if;
  return new;
end;
$$;

-- Intake state on photo_jobs is owned by the Edge Functions. Web and Desktop push whole
-- job rows (including a possibly stale file_intake_status / Drive folder ids), which would
-- silently reopen a job a customer already submitted and drop it from Producción.
-- Client roles can no longer change these three columns on UPDATE; INSERT (initial value)
-- and service_role (Edge Functions) are unaffected.
create function private.photo_job_server_owned_columns() returns trigger
language plpgsql set search_path=''
as $$
begin
  if current_user in ('authenticated','anon') then
    new.file_intake_status := old.file_intake_status;
    new.drive_folder_id := old.drive_folder_id;
    new.drive_edited_folder_id := old.drive_edited_folder_id;
  end if;
  return new;
end;
$$;
revoke all on function private.photo_job_server_owned_columns() from public,anon,authenticated;
create trigger photo_job_server_owned before update on public.photo_jobs
  for each row execute function private.photo_job_server_owned_columns();
