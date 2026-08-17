-- ===========================================================================
-- Outstanding Dashboard — mail a generated report, with the files attached.
--
-- WHAT THIS ADDS (all additive; nothing existing is altered or dropped)
--   1. storage bucket `report-exports` — where the browser puts the generated
--      PDF/XLSX so the sender can attach them.
--   2. public.queue_report_email(...) — the ONLY way a client can put a row in
--      email_outbox. That table has RLS enabled with no policies, so every
--      enqueue in this repo goes through a SECURITY DEFINER function; this is
--      the first one a browser calls directly, hence the checks below.
--   3. an email_module_settings row for 'outstanding-dashboard', seeded OFF.
--
-- ⚠ WITHOUT (3) THE FEATURE IS A SILENT NO-OP. Every enqueue in the codebase is
--   gated on public.email_module_enabled(<module>), which returns FALSE when the
--   module has no row at all. There was no row for this app, so mail would have
--   been dropped with no error anywhere. It seeds OFF to match every other
--   module: an admin turns it on in Outstanding Dashboard -> Settings ->
--   Notifications.
--
-- ⚠ SEEDED OFF IS ALSO THE HARD STOP THE OWNER ASKED FOR (14-Aug-2026).
--   Nothing may reach a salesperson until they say so. With no row, or a row set
--   false, queue_report_email RAISES and no outbox row is ever written, so the
--   feature is inert by construction rather than by anyone remembering not to
--   click Send. Turning it on is the owner's action, not a deployment step.
--
-- ⚠ THIS BUCKET IS DELIBERATELY STRICTER THAN THE FMS DOCUMENT BUCKETS.
--   `fms-purchase-docs` and friends grant SELECT to any authenticated user
--   (20260701120000). That is defensible for a PO attachment; it is not
--   defensible here. These files contain the whole receivables book cut by
--   salesperson, and the Outstanding Dashboard's entire per-salesperson scoping
--   model (lib/scope.tsx) exists to stop one rep seeing another's customers. A
--   blanket-read bucket would hand any signed-in user an admin's full export by
--   guessing a path. So: INSERT only, confined to the caller's own uid prefix,
--   and NO client SELECT at all. The Edge Function reads with the service role,
--   which bypasses RLS.
--
-- Reversal:
--   drop function if exists public.queue_report_email(text, text, text, text, text, jsonb);
--   delete from public.email_module_settings where module_id = 'outstanding-dashboard';
--   drop policy if exists "report exports insert own" on storage.objects;
--   drop policy if exists "report exports delete own" on storage.objects;
--   delete from storage.buckets where id = 'report-exports';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-exports', 'report-exports', false)
on conflict (id) do nothing;

drop policy if exists "report exports insert own" on storage.objects;
drop policy if exists "report exports delete own" on storage.objects;

-- Write only under your own uid: `report-exports/<auth.uid()>/<uuid>/<file>`.
create policy "report exports insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lets a client clean up its own upload if the enqueue fails. Still no SELECT.
create policy "report exports delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'report-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 2. The enqueue
-- ---------------------------------------------------------------------------
-- p_attachments: [{"path": "<uid>/<uuid>/file.pdf", "filename": "...", "mime": "..."}]
create or replace function public.queue_report_email(
  p_to_email    text,
  p_to_name     text,
  p_subject     text,
  p_headline    text,
  p_body        text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_full  boolean;
  v_att   jsonb;
  v_path  text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- The same gate the UI applies (useHubMenuAccess().hasFullAccess('reports')),
  -- enforced here so it is an access control rather than a hidden button.
  select public.is_admin(v_uid)
         or coalesce('reports' = any(p.receivables_admin_menus), false)
    into v_full
    from public.profiles p
   where p.id = v_uid;

  if not coalesce(v_full, false) then
    raise exception 'you do not have full access to Reports';
  end if;

  -- The business switch. Raise rather than return quietly: the caller shows the
  -- admin why nothing was sent, instead of reporting a success that never happened.
  if not public.email_module_enabled('outstanding-dashboard') then
    raise exception 'email is switched off for the Outstanding Dashboard';
  end if;

  if nullif(btrim(coalesce(p_to_email, '')), '') is null then
    raise exception 'a recipient address is required';
  end if;

  -- Every attachment must be the caller's own upload in this bucket, and must
  -- actually exist. Without the prefix check a caller could name any path in the
  -- bucket and have the service-role sender fetch it for them — the storage
  -- policy stops them WRITING elsewhere, not naming elsewhere.
  for v_att in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    v_path := v_att ->> 'path';
    if v_path is null or split_part(v_path, '/', 1) <> v_uid::text then
      raise exception 'attachment path % is not yours', coalesce(v_path, '(null)');
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'report-exports' and o.name = v_path
    ) then
      raise exception 'attachment % was not uploaded', v_path;
    end if;
  end loop;

  insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, payload)
  values (
    'receivables_collections_report',
    null,                        -- an external or ad-hoc recipient; to_email is what the sender reads
    btrim(p_to_email),
    nullif(btrim(coalesce(p_to_name, '')), ''),
    v_uid,
    jsonb_build_object(
      'subject',     p_subject,
      'headline',    p_headline,
      'body',        p_body,
      'bucket',      'report-exports',
      'attachments', coalesce(p_attachments, '[]'::jsonb)
    )
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.queue_report_email(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.queue_report_email(text, text, text, text, text, jsonb) to authenticated;

comment on function public.queue_report_email(text, text, text, text, text, jsonb) is
  'Queues one Outstanding Dashboard report email with attachments already uploaded to report-exports/<uid>/. Requires Reports full access and the outstanding-dashboard email switch.';

-- ---------------------------------------------------------------------------
-- 3. The module switch, seeded OFF
-- ---------------------------------------------------------------------------
insert into public.email_module_settings (module_id, enabled)
values ('outstanding-dashboard', false)
on conflict (module_id) do nothing;

-- ============================================================== asserts ====
do $check$
begin
  if not exists (select 1 from storage.buckets where id = 'report-exports') then
    raise exception 'report exports: the bucket was not created';
  end if;
  if exists (select 1 from storage.buckets where id = 'report-exports' and public) then
    raise exception 'report exports: the bucket is PUBLIC, which would expose every export';
  end if;
  if to_regprocedure('public.queue_report_email(text, text, text, text, text, jsonb)') is null then
    raise exception 'report exports: queue_report_email was not created';
  end if;
  -- The hard stop. If this ever asserts false on a fresh apply, somebody has
  -- changed the seed and mail can leave the building unattended.
  if coalesce((select enabled from public.email_module_settings
                where module_id = 'outstanding-dashboard'), true) then
    raise exception 'report exports: the outstanding-dashboard email switch is ON; it must seed OFF';
  end if;
end $check$;
