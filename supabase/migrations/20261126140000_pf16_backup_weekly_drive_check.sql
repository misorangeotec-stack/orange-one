-- ===========================================================================
-- PF-16 — the weekly check that the files are still IN Google Drive.
--
-- THE GAP IT CLOSES (asked 18-09-2026: "what happens if the file is deleted?")
--   A file is copied once, and private.backup_files then says "done" for good.
--   If somebody signed in as backup@ deleted it from Drive, nothing would ever
--   notice: the log would still say "done" and no run would copy it again.
--
-- WHAT RUNS, AND WHEN
--   On a run with full_files = true (every Sunday; any `full` run; a week with
--   no such run is caught up the next night — see backup_run_start), run.py
--   lists every file under "Orange One Hub/Files", compares it with the log
--   (backup_files_logged), and hands back what is missing (backup_files_forget).
--   Those log rows are removed ONLY IF the object still exists in the app, so the
--   same run copies them again, to the same place. A file gone from Drive AND
--   from the app cannot be recovered by the backup: it is reported, not forgotten,
--   so the loss stays on the record.
--
-- Additive: two functions. Reversal: the _rollback file.
-- ===========================================================================

create or replace function public.backup_files_logged()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(f.drive_path order by f.drive_path collate "C"), '[]'::jsonb)
    from private.backup_files f
$$;

revoke all on function public.backup_files_logged() from public, anon, authenticated;


create or replace function public.backup_files_forget(p_run_id bigint, p_paths jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forgot  jsonb;
  v_lost    jsonb;
begin
  with missing as (
    select f.bucket, f.name, f.etag, f.drive_path,
           exists (select 1 from storage.objects o
                    where o.bucket_id = f.bucket and o.name = f.name
                      and coalesce(o.metadata ->> 'eTag', '') = f.etag) as still_in_app
      from private.backup_files f
     where f.drive_path in (select jsonb_array_elements_text(coalesce(p_paths, '[]'::jsonb)))
  ),
  gone as (
    delete from private.backup_files f
     using missing m
     where m.still_in_app
       and f.bucket = m.bucket and f.name = m.name and f.etag = m.etag
    returning f.drive_path
  )
  select coalesce((select jsonb_agg(drive_path) from gone), '[]'::jsonb),
         coalesce((select jsonb_agg(drive_path) from missing where not still_in_app), '[]'::jsonb)
    into v_forgot, v_lost;

  return jsonb_build_object('run_id', p_run_id, 'recopy', v_forgot, 'lost', v_lost);
end $$;

revoke all on function public.backup_files_forget(bigint, jsonb) from public, anon, authenticated;


do $check$
begin
  if to_regprocedure('public.backup_files_logged()') is null
     or to_regprocedure('public.backup_files_forget(bigint, jsonb)') is null then
    raise exception 'backup drive check: functions missing';
  end if;
  if has_function_privilege('authenticated', 'public.backup_files_forget(bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.backup_files_forget(bigint, jsonb)', 'execute') then
    raise exception 'backup drive check: a client role can execute backup_files_forget';
  end if;
end $check$;
