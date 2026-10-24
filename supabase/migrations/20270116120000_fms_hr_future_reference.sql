-- HR Recruitment — the FUTURE REFERENCE bucket.
--
-- WHY
-- A CV that is not taken forward for THIS vacancy is often a good CV — wrong role,
-- wrong timing, wrong location. HR wants to park it, out of the way, and pick it up
-- again when a suitable vacancy opens.
--
-- HOW IT BEHAVES (the client's words, 09-10-2026: "remove from pipeline, don't make
-- copies")
--   • SAVE   — the candidate LEAVES the pipeline and goes into the Future Reference
--              bucket. The row is not copied; it is marked (`future_ref_at`), and
--              every pipeline surface — board, queues, counts, the HOD's "CVs awaiting
--              your shortlist" notice — skips marked rows.
--   • MOVE TO PIPELINE — the bucket hands the candidate back:
--              – to the SAME vacancy → they return to the stage they were parked at;
--              – to ANOTHER vacancy that is posted (`sourcing`) → the same row moves
--                there and starts again at Resumes Uploaded.
--
-- WHY A MARK AND NOT A NEW STAGE
-- The stage machine (fms_hr_move_candidate, fms_hr_stage_rank, the rank thresholds the
-- frontend must never renumber, the stage CHECK constraint) is untouched. A new stage
-- would have to be taught to every one of those and to every screen that switches on
-- stage; a mark that the reads filter out gets the same result with none of that risk,
-- and keeps the stage they were at so "back to the same vacancy" can restore it.
--
-- ⚠ A PII GRANT, SCOPED TO THE BUCKET.
-- Being on `future_ref_viewers` (Setup → Future Reference) opens, for SAVED candidates
-- only: the candidate row, its discussion trail, the vacancy it was saved from, and its
-- CV. Each is a NEW, separate policy (Postgres ORs permissive policies), so no existing
-- policy is recreated or widened.
--
-- The only existing object REPLACED is fms_hr_notify_hod_pending(), carried forward
-- from 20260903130000 with two changes: parked CVs are not counted
-- (`future_ref_at is null`), and a bucket viewer may trigger the recount.
--
-- Rollback: 20270116120000_fms_hr_future_reference_rollback.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. The mark. Null `future_ref_at` = in the pipeline as normal.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_candidates add column if not exists future_ref_at   timestamptz;
alter table public.fms_hr_candidates add column if not exists future_ref_by   uuid references auth.users on delete set null;
alter table public.fms_hr_candidates add column if not exists future_ref_note text;

comment on column public.fms_hr_candidates.future_ref_at is
  'When the candidate was moved to the Future Reference bucket. Non-null = OUT of the pipeline; '
  'every board, queue and count skips the row. Null = in the pipeline.';

create index if not exists fms_hr_candidates_future_ref_idx
  on public.fms_hr_candidates (future_ref_at) where future_ref_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Predicates. Same shape as fms_hr_is_pipeline_viewer(): sql, STABLE, SECURITY
--    DEFINER, search_path pinned — they are called per row by the policies below.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_is_future_ref_viewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_config c
    where c.key = 'future_ref_viewers'
      and p_uid::text in (
        select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
      )
  );
$$;

comment on function public.fms_hr_is_future_ref_viewer(uuid) is
  'True when the user is on the fms_hr_config `future_ref_viewers` list. Grants READ over '
  'candidates in the Future Reference bucket (and their trail, vacancy and CV) only, and '
  'lets them move a candidate back into a pipeline.';

create or replace function public.fms_hr_is_future_ref_candidate(p_candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_candidates c
     where c.id = p_candidate and c.future_ref_at is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Read grants — each a NEW policy; nothing existing is touched.
-- ---------------------------------------------------------------------------
drop policy if exists fms_hr_candidates_select_future_ref on public.fms_hr_candidates;
create policy fms_hr_candidates_select_future_ref on public.fms_hr_candidates
  for select to authenticated
  using (future_ref_at is not null and public.fms_hr_is_future_ref_viewer(auth.uid()));

drop policy if exists fms_hr_activity_select_future_ref on public.fms_hr_activity;
create policy fms_hr_activity_select_future_ref on public.fms_hr_activity
  for select to authenticated
  using (
    entity_type = 'candidate'
    and public.fms_hr_is_future_ref_viewer(auth.uid())
    and public.fms_hr_is_future_ref_candidate(entity_id)
  );

-- The vacancy a saved candidate came from, plus every POSTED vacancy — the viewer has
-- to be able to see where they can move someone to. Vacancy rows carry no candidate PII.
drop policy if exists fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions;
create policy fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions
  for select to authenticated
  using (
    public.fms_hr_is_future_ref_viewer(auth.uid())
    and (
      status = 'sourcing'
      or exists (
        select 1 from public.fms_hr_candidates c
         where c.requisition_id = fms_hr_requisitions.id and c.future_ref_at is not null
      )
    )
  );

-- The CV of a saved candidate, nothing else. SELECT only.
drop policy if exists "fms hr docs read future ref" on storage.objects;
create policy "fms hr docs read future ref"
  on storage.objects for select
  using (
    bucket_id = 'fms-hr-docs'
    and public.fms_hr_is_future_ref_viewer(auth.uid())
    and exists (
      select 1 from public.fms_hr_candidates c
       where c.resume_path = storage.objects.name and c.future_ref_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The HOD's "N CVs awaiting your shortlist" notice must not count a CV that has
--    left the pipeline. Body carried forward from 20260903130000 with two changes:
--    `and c.future_ref_at is null` in the count, and a bucket viewer passes the
--    caller gate (so moving a CV back refreshes the HOD's count).
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_notify_hod_pending(p_requisition uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_n      integer;
  v_mrf    text;
  v_text   text;
  v_mgrs   uuid[];
  m        uuid;
begin
  if p_requisition is null then return; end if;

  -- auth.uid() is null when this runs from a migration (§6) or a cron job; in that
  -- case there is no caller to authorize and nobody to skip as "the actor".
  -- Future Reference: a bucket viewer moving a CV back onto a vacancy cannot read that
  -- vacancy through fms_hr_can_read_requisition, and would otherwise leave the HOD's
  -- count stale. Safe to admit: the count is computed here, never taken from the caller.
  if v_uid is not null
     and not public.fms_hr_can_read_requisition(p_requisition, v_uid)
     and not public.fms_hr_is_future_ref_viewer(v_uid) then
    return;
  end if;

  select r.mrf_no, coalesce(r.hiring_manager_ids, '{}'::uuid[])
    into v_mrf, v_mgrs
    from public.fms_hr_requisitions r
   where r.id = p_requisition;
  if v_mrf is null then return; end if;

  -- Counted here rather than passed in, so the text can never drift from the board.
  -- A CV parked in Future Reference is OFF the board, so it is not counted.
  select count(*) into v_n
    from public.fms_hr_candidates c
   where c.requisition_id = p_requisition
     and c.stage = 'hr_shortlisted'
     and c.future_ref_at is null;

  v_text := format('%s CV%s awaiting your shortlist — %s',
                   v_n, case when v_n = 1 then '' else 's' end, v_mrf);

  foreach m in array v_mgrs loop
    if m is null or m = v_uid then continue; end if;

    if v_n = 0 then
      -- Nothing left to shortlist: retire our own stale digest rather than leaving
      -- it claiming CVs that are no longer there. Marked read, never deleted.
      update public.fms_hr_notifications
         set read_at = now()
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;
    else
      update public.fms_hr_notifications
         set text = v_text, created_at = now(), actor_id = v_uid
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;

      -- No unique constraint on this table, so update-then-insert is what keeps it
      -- to one row per (manager, requisition).
      if not found then
        insert into public.fms_hr_notifications
          (user_id, type, entity_type, entity_id, text, actor_id)
        values
          (m, 'hod_shortlist_pending', 'requisition', p_requisition, v_text, v_uid);
      end if;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. SAVE — out of the pipeline, into the bucket.
--
-- Who: whoever may already touch the candidate (fms_hr_may_touch_candidate — the
-- same gate as the note and the tags), or an admin.
-- Refused for an offer or a hire (an onboarding hangs off those), and while an
-- interview is booked but not yet held — that interview would be left orphaned in
-- the Interviews queue.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_save_future_reference(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_stage text;
  v_was   timestamptz;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  select c.requisition_id, c.stage, c.future_ref_at into v_req, v_stage, v_was
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if not (public.is_admin(v_uid) or public.fms_hr_may_touch_candidate(v_req, v_uid)) then
    raise exception 'Not authorized to move this candidate to Future Reference';
  end if;
  if v_was is not null then
    raise exception 'This candidate is already in Future Reference';
  end if;
  if v_stage in ('finalized', 'hired') then
    raise exception 'An offered or hired candidate cannot be moved to Future Reference';
  end if;
  if exists (
    select 1 from public.fms_hr_interviews i
     where i.candidate_id = p_id
       and i.held_at is null
       and i.status = 'scheduled'
       -- "Booked" exactly as lib/interviewers.ts isBooked(): somebody is on the panel.
       -- An auto-advanced round with nobody assigned yet does not block.
       and (cardinality(coalesce(i.interviewer_ids, '{}'::uuid[])) > 0
            or coalesce(trim(i.interviewer_name), '') <> '')
  ) then
    raise exception 'This candidate has an interview booked. Record or reassign it before moving them to Future Reference';
  end if;

  update public.fms_hr_candidates
     set future_ref_at = now(), future_ref_by = v_uid, future_ref_note = v_note
   where id = p_id;

  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
  values ('candidate', p_id, 'future_reference_saved', v_uid,
          'Moved to Future Reference' || coalesce(' — ' || v_note, ''),
          jsonb_build_object('requisition_id', v_req, 'stage', v_stage));

  -- The HOD's shortlist count may just have dropped by one.
  perform public.fms_hr_notify_hod_pending(v_req);
end $function$;

grant execute on function public.fms_hr_save_future_reference(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. MOVE TO PIPELINE — out of the bucket, onto a board.
--
-- Same vacancy  → back to the stage they were parked at (the stage column was never
--                 changed), provided the vacancy is not closed / cancelled / rejected.
-- Other vacancy → it must be posted (`sourcing`, the same rule fms_hr_add_candidates
--                 uses). The SAME ROW moves there and restarts at Resumes Uploaded: the
--                 stage stamps from the old vacancy are cleared, and `uploaded_at` is
--                 reset so the due-date clock counts from today. Refused if the
--                 candidate has any interview on record, because interviews hang off
--                 the candidate and would follow them onto the new board as if held there.
--
-- Who: an admin, a bucket viewer, or whoever may touch the candidate on the vacancy
-- they are going to.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_move_to_pipeline(p_id uuid, p_req uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid    uuid := auth.uid();
  v_from   uuid;
  v_was    timestamptz;
  v_status text;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
  v_mrf    text;
begin
  select c.requisition_id, c.future_ref_at into v_from, v_was
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_from is null then raise exception 'Candidate not found'; end if;
  if v_was is null then raise exception 'This candidate is not in Future Reference'; end if;
  if p_req is null then raise exception 'Pick the vacancy to move them to'; end if;

  select r.status, r.mrf_no into v_status, v_mrf from public.fms_hr_requisitions r where r.id = p_req;
  if v_status is null then raise exception 'Requisition not found'; end if;

  if not (
       public.is_admin(v_uid)
    or public.fms_hr_is_future_ref_viewer(v_uid)
    or public.fms_hr_may_touch_candidate(p_req, v_uid)
  ) then
    raise exception 'Not authorized to move this candidate into that pipeline';
  end if;

  if p_req = v_from then
    if v_status in ('closed', 'cancelled', 'rejected') then
      raise exception 'Their vacancy (%) is %. Pick a vacancy that is still open', v_mrf, v_status;
    end if;
    update public.fms_hr_candidates
       set future_ref_at = null, future_ref_by = null, future_ref_note = null
     where id = p_id;
  else
    if v_status <> 'sourcing' then
      raise exception 'Candidates can only be moved to a posted vacancy (% is %)', v_mrf, v_status;
    end if;
    if exists (select 1 from public.fms_hr_interviews i where i.candidate_id = p_id) then
      raise exception 'This candidate has interview history on their old vacancy, so they can only go back to that vacancy';
    end if;
    update public.fms_hr_candidates
       set requisition_id             = p_req,
           stage                      = 'resume_uploaded',
           uploaded_at                = now(),
           hr_shortlisted_at          = null,
           hr_shortlisted_by          = null,
           hod_decided_at             = null,
           hod_decided_by             = null,
           telephonic_at              = null,
           interview1_at              = null,
           interview2_at              = null,
           interview3_at              = null,
           final_decision_at          = null,
           finalized_at               = null,
           finalized_by               = null,
           offered_ctc                = null,
           disqualified_at            = null,
           disqualification_reason_id = null,
           disqualification_note      = null,
           decision_remarks           = null,
           future_ref_at              = null,
           future_ref_by              = null,
           future_ref_note            = null
     where id = p_id;
  end if;

  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
  values ('candidate', p_id, 'future_reference_moved', v_uid,
          'Moved from Future Reference to the pipeline — ' || v_mrf || coalesce(' — ' || v_note, ''),
          jsonb_build_object('from_requisition_id', v_from, 'to_requisition_id', p_req));

  perform public.fms_hr_notify_hod_pending(p_req);
end $function$;

grant execute on function public.fms_hr_move_to_pipeline(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Setup list, empty on arrival. ON CONFLICT DO NOTHING so a re-run never
--    clobbers a list an admin has since edited.
-- ---------------------------------------------------------------------------
insert into public.fms_hr_config (key, value)
values ('future_ref_viewers', jsonb_build_object('user_ids', '[]'::jsonb))
on conflict (key) do nothing;

commit;
