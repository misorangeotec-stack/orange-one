-- HR Recruitment — the FUTURE REFERENCE bucket.
--
-- WHY
-- A CV that is not shortlisted for THIS vacancy is often a good CV — wrong role, wrong
-- timing, wrong location. Until now the only thing HR could do with it was leave it in
-- "Resumes Uploaded" or Disqualify it, and either way it was gone the moment the
-- vacancy closed: the candidate read is windowed, and nobody browses old boards.
--
-- So a candidate can now be SAVED FOR FUTURE REFERENCE from the candidate page. Every
-- saved candidate, from every vacancy, lands in one bucket (/hr-recruitment/future-
-- reference), and that bucket is visible to the HR people an admin names in
-- Setup → Future Reference.
--
-- A FLAG, NOT A STAGE — DELIBERATELY.
-- The stage machine (fms_hr_move_candidate, fms_hr_stage_rank, the rank thresholds in
-- lib/board.ts that must never be renumbered) is untouched. Saving for future reference
-- does not move the card: HR can still Disqualify for this vacancy, or keep the person
-- in play. The flag answers "worth calling for a later vacancy?", which is a different
-- question from "where are they on this one?".
--
-- ⚠ A PII GRANT, SCOPED TO THE BUCKET.
-- Being on `future_ref_viewers` opens, for SAVED candidates only:
--     fms_hr_candidates           ← name, phone, email, expected salary
--     fms_hr_activity             ← that candidate's discussion trail
--     fms_hr_requisitions         ← the vacancy they were saved from (job title)
--     fms-hr-docs                 ← that candidate's CV file
-- Nothing else. A viewer does not see the rest of the board, other candidates, scores,
-- interviews, onboardings or probations. Each grant is a NEW, separate policy (Postgres
-- ORs permissive policies), so no existing policy or predicate is recreated or widened.
--
-- ADDITIVE ONLY. Three nullable columns, one config row, three functions, four new
-- policies. Rollback: 20270114120000_fms_hr_future_reference_rollback.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. The flag. Null `future_ref_at` = not in the bucket.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_candidates add column if not exists future_ref_at   timestamptz;
alter table public.fms_hr_candidates add column if not exists future_ref_by   uuid references auth.users on delete set null;
alter table public.fms_hr_candidates add column if not exists future_ref_note text;

comment on column public.fms_hr_candidates.future_ref_at is
  'When the candidate was saved for future reference. Null = not in the Future Reference bucket.';

-- The bucket reads every saved candidate whatever its age, so index the predicate.
create index if not exists fms_hr_candidates_future_ref_idx
  on public.fms_hr_candidates (future_ref_at) where future_ref_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Who may see the bucket.
--
-- Same SHAPE as fms_hr_is_pipeline_viewer(): sql, STABLE, SECURITY DEFINER,
-- search_path pinned. Called per row by the policies below, so it must stay STABLE.
-- No is_admin arm — admins already pass every consumer by another arm.
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
  'candidates saved for future reference (and their trail, vacancy and CV) only.';

-- Is this candidate in the bucket? SECURITY DEFINER so the activity / requisition /
-- storage policies below can ask without tripping the candidate table's own RLS.
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
-- 3. The read grants — each a NEW policy, so nothing existing is touched.
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

-- The vacancy a saved candidate came from — so the bucket can say "saved from Sales
-- Manager" instead of a blank. Vacancy rows carry no candidate PII.
drop policy if exists fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions;
create policy fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions
  for select to authenticated
  using (
    public.fms_hr_is_future_ref_viewer(auth.uid())
    and exists (
      select 1 from public.fms_hr_candidates c
       where c.requisition_id = fms_hr_requisitions.id and c.future_ref_at is not null
    )
  );

-- The CV of a saved candidate, and nothing else in the bucket. SELECT only — insert /
-- update / delete keep their own policies, so a viewer can read a CV, never replace it.
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
-- 4. Save / remove.
--
-- SAVE: whoever may already touch the candidate (fms_hr_may_touch_candidate — the
-- same gate as the note and the tags), or an admin.
-- REMOVE: the same people, PLUS a bucket viewer — they work the bucket, so they must
-- be able to clear a candidate who has since been placed or is no longer of interest.
-- Both write one activity row, so the candidate's trail says who did it and why.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_future_reference(p_id uuid, p_on boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid  uuid := auth.uid();
  v_req  uuid;
  v_was  timestamptz;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select c.requisition_id, c.future_ref_at into v_req, v_was
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if not (
       public.is_admin(v_uid)
    or public.fms_hr_may_touch_candidate(v_req, v_uid)
    or (not p_on and public.fms_hr_is_future_ref_viewer(v_uid))
  ) then
    raise exception 'Not authorized to change future reference for this candidate';
  end if;

  if p_on then
    update public.fms_hr_candidates
       set future_ref_at   = coalesce(future_ref_at, now()),
           future_ref_by   = coalesce(future_ref_by, v_uid),
           future_ref_note = coalesce(v_note, future_ref_note)
     where id = p_id;
    insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
    values ('candidate', p_id, 'future_reference_saved', v_uid,
            'Saved for future reference' || coalesce(' — ' || v_note, ''),
            jsonb_build_object('requisition_id', v_req));
  else
    if v_was is null then return; end if;
    update public.fms_hr_candidates
       set future_ref_at = null, future_ref_by = null, future_ref_note = null
     where id = p_id;
    insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
    values ('candidate', p_id, 'future_reference_removed', v_uid,
            'Removed from future reference' || coalesce(' — ' || v_note, ''),
            jsonb_build_object('requisition_id', v_req));
  end if;
end $function$;

grant execute on function public.fms_hr_set_future_reference(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Setup list, empty on arrival. ON CONFLICT DO NOTHING so a re-run never
--    clobbers a list an admin has since edited.
-- ---------------------------------------------------------------------------
insert into public.fms_hr_config (key, value)
values ('future_ref_viewers', jsonb_build_object('user_ids', '[]'::jsonb))
on conflict (key) do nothing;

commit;
