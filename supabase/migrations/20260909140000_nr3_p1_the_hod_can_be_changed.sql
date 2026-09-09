-- NR-3 Part A - the hiring manager becomes settable, and every change is traced.
--
-- WHY
-- fms_hr_requisitions.hiring_manager_ids already means "acts as the HOD on this
-- vacancy". It is read by 11 functions, by fms_hr_can_read_requisition (which gates
-- SELECT on eight candidate-side relations), by fms_hr_is_natural_step_owner (which
-- routes the seven HOD steps), by the queues, the board gate and the notification
-- fan-out. Nothing in the database writes it except fms_hr_submit_mrf's INSERT.
--
-- So on 09-09-2026: 17 of 19 live positions name whoever raised the MRF, 15 of them
-- Saloni Rathod alone, across 106 in-play candidates - and no screen, no RPC and no
-- policy could change any of it. The table's only non-SELECT policy is
-- fms_hr_requisitions_write_admin, so even an admin needed hand-written SQL.
--
-- This migration adds FOUR NEW FUNCTIONS AND CHANGES NOTHING THAT EXISTS. Checked
-- against pg_proc before writing: none of the four names is taken. No existing
-- function, policy, table, column or row is modified. No data is written at apply
-- time. Nothing here takes a lock on a live table.
--
-- WHY ALL FOUR SHIP TOGETHER
-- The preview and the write share one authorisation predicate on purpose. Shipping
-- either alone gives you a screen that disagrees with its own Save button.
--
-- ---------------------------------------------------------------------------
-- THE ASSERTION AT THE BOTTOM, AND WHY IT IS WHERE IT IS
-- fms_hr_would_read_requisition is a hand transcription of
-- fms_hr_can_read_requisition. A transcription that drifts is worse than no preview
-- at all: it tells somebody their access is safe while the write takes it away. So
-- the migration proves the two agree on every live (requisition x person) pair and
-- REFUSES TO COMMIT if they do not.
--
-- Measured 09-09-2026: 24 x 68 = 1,632 pairs, 2.55 seconds. It sits BELOW the
-- create-function statements rather than above them, which is the opposite of the
-- usual rule - and that is correct here, because CREATE FUNCTION takes no lock on
-- fms_hr_requisitions or profiles. There is no ACCESS EXCLUSIVE for a slow check to
-- sit inside. It blocks nobody.
--
-- It scales with requisitions x people. If it ever approaches the statement timeout,
-- SAMPLE IT - do not delete it. The day somebody edits fms_hr_can_read_requisition
-- without editing the simulator, this is what fails loudly instead of lying quietly.
-- ---------------------------------------------------------------------------

begin;

-- ===========================================================================
-- 1 of 4 - WHO MAY RE-MAP A VACANCY
--
-- One copy of the rule, called by the write AND by the preview, so a screen can
-- never offer a control the RPC then refuses. The client mirrors it in store.tsx to
-- decide whether to render the button; this stays the authority.
--
-- The client decided on 07-09-2026 that the mapped HOD may re-map their own vacancy:
-- "once the HOD is mapped, the HOD also becomes the process owner, so the HOD
-- themselves too can edit or update anything." The convenience and the risk are the
-- same mechanism - a head can also hand their vacancy to the wrong person - which is
-- exactly why the write below logs every change with who, when and from whom.
--
-- !! coalesce(..., '{}') IS LOAD-BEARING. p_uid = any(NULL) is NULL, `false or NULL`
--    is NULL, and every caller tests `if not (...)`. `not NULL` is NULL, so a null
--    array would make the guard never fire and the RPC would silently authorise.
--    NR-4's header makes the identical point about fms_hr_is_natural_step_owner.
--
-- Deliberately does NOT test status: the caller decides which states it refuses, so
-- the preview and the write can differ about `cancelled` without duplicating this.
-- ===========================================================================
create or replace function public.fms_hr_may_set_hiring_managers(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and (public.is_admin(p_uid)
          or public.fms_hr_is_coordinator(p_uid)
          or exists (
            select 1 from public.fms_hr_requisitions r
             where r.id = p_req
               and (r.requester_id = p_uid
                    or p_uid = any(coalesce(r.hiring_manager_ids, '{}'::uuid[])))
          ));
$fn$;

revoke execute on function public.fms_hr_may_set_hiring_managers(uuid, uuid) from public;
revoke execute on function public.fms_hr_may_set_hiring_managers(uuid, uuid) from anon;
grant  execute on function public.fms_hr_may_set_hiring_managers(uuid, uuid) to authenticated, service_role;

comment on function public.fms_hr_may_set_hiring_managers(uuid, uuid) is
  'NR-3. Who may re-map a vacancy: an admin, a process coordinator, the requester, or one of its CURRENT hiring managers (client decision 07-09-2026). Does not test status; the caller decides that.';

-- ===========================================================================
-- 2 of 4 - WOULD THIS PERSON STILL READ THIS REQUISITION, AFTER THE WRITE?
--
-- A LITERAL TRANSCRIPTION of fms_hr_can_read_requisition with three substitutions:
--   * hiring_manager_ids -> p_managers
--   * reporting_to_ids   -> p_reporting
--   * the step-assignee arm ignores anyone in p_drop_assignees
--
-- !! THE THIRD SUBSTITUTION IS NOT OPTIONAL, and it is the subtle one. The write
--    DELETES fms_hr_step_assignees rows for outgoing managers in the same
--    transaction. Someone whose only surviving read arm is the row about to be
--    deleted would otherwise be reported as keeping access, and would lose it.
--
-- Why not rewrite fms_hr_can_read_requisition to delegate here and keep one copy?
-- Considered and rejected. TEN RLS policies call it by name. Passing arrays as
-- arguments forces the requisition row lookup to happen EAGERLY - SQL evaluates
-- arguments before the call - so it would run before the is_admin / coordinator
-- short-circuit, adding an index lookup to every candidate row an admin reads. And
-- the rollback would then be an outage rather than four drop statements.
--
-- The assertion at the bottom of this file is what keeps the copy honest.
-- ===========================================================================
create or replace function public.fms_hr_would_read_requisition(
  p_req            uuid,
  p_uid            uuid,
  p_managers       uuid[],
  p_reporting      uuid[],
  p_drop_assignees uuid[] default '{}'::uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin(p_uid)
      or public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_recruitment_staff(p_uid)
      or public.fms_hr_is_pipeline_viewer(p_uid)
      or exists (
        select 1 from public.fms_hr_requisitions r
        where r.id = p_req
          and (r.requester_id = p_uid
               or p_uid = any(coalesce(p_managers,  '{}'::uuid[]))
               or p_uid = any(coalesce(p_reporting, '{}'::uuid[])))
      )
      or (not (p_uid = any(coalesce(p_drop_assignees, '{}'::uuid[])))
          and exists (
            select 1 from public.fms_hr_step_assignees a
             where a.requisition_id = p_req and a.assigned_to = p_uid
          ))
      or exists (
        select 1
          from public.fms_hr_interviews i
          join public.fms_hr_candidates c on c.id = i.candidate_id
         where c.requisition_id = p_req and p_uid = any(i.interviewer_ids)
      );
$fn$;

revoke execute on function public.fms_hr_would_read_requisition(uuid, uuid, uuid[], uuid[], uuid[]) from public;
revoke execute on function public.fms_hr_would_read_requisition(uuid, uuid, uuid[], uuid[], uuid[]) from anon;
grant  execute on function public.fms_hr_would_read_requisition(uuid, uuid, uuid[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.fms_hr_would_read_requisition(uuid, uuid, uuid[], uuid[], uuid[]) is
  'NR-3. fms_hr_can_read_requisition simulated against proposed arrays, so the Change HOD dialog can say who loses access BEFORE the write. p_drop_assignees = the step-assignee rows that same write will delete. Kept in step with the live gate by an assertion in migration 20260909140000.';

-- ===========================================================================
-- 3 of 4 - THE WRITE
--
-- p_reporting_to: null = leave alone, '{}' = clear, anything else = set.
--
-- !! IT IS IN THE SIGNATURE ON DAY ONE BECAUSE IT CANNOT BE ADDED LATER.
--    CREATE OR REPLACE cannot add a parameter - it creates an OVERLOAD, and PostgREST
--    then fails to resolve a call that omits it with PGRST203. The same trap is
--    written up in 20261113120000_nr5_attachments_can_be_cleared.sql. The
--    alternative was a second, differently-named writer of the same column, which is
--    precisely how two writers drift.
--    Passing null is byte-for-byte the three-argument behaviour: not read, not
--    written, not mentioned in the activity text.
--
-- Unlike hiring_manager_ids, an EMPTY reporting_to_ids is legitimate - 20 of 24 rows
-- are empty today - so it gets the staff check but no cardinality refusal.
-- ===========================================================================
create or replace function public.fms_hr_set_hiring_managers(
  p_req          uuid,
  p_ids          uuid[],
  p_note         text   default null,
  p_reporting_to uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_status      text;
  v_no          text;
  v_requester   uuid;
  v_old         uuid[];
  v_new         uuid[];
  v_rep_old     uuid[];
  v_rep_new     uuid[];
  v_added       uuid[];
  v_out         uuid[];
  v_bad         text;
  v_note        text := coalesce(btrim(p_note), '');
  v_cleared     jsonb := '[]'::jsonb;
  v_names_old   text;
  v_names_new   text;
  v_text        text;
  v_rep_touched boolean := p_reporting_to is not null;
  v_rep_changed boolean := false;
begin
  -- 1 - House guard. A null uid is a migration or a cron job: there is then no caller
  --     to authorise, and the checks below still apply.
  if v_uid is not null and not public.is_staff(v_uid) then
    raise exception 'Not authorized';
  end if;

  -- 2 - Lock BEFORE anything is decided. fms_hr_reassign_step locks this same row
  --     before it writes fms_hr_step_assignees, so a concurrent handover cannot slip
  --     a row for an outgoing manager past the delete in step 10.
  select r.status, r.mrf_no, r.requester_id,
         coalesce(r.hiring_manager_ids, '{}'::uuid[]),
         coalesce(r.reporting_to_ids,   '{}'::uuid[])
    into v_status, v_no, v_requester, v_old, v_rep_old
    from public.fms_hr_requisitions r
   where r.id = p_req
     for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- 3 - Authorisation BEFORE the status check, deliberately. A caller who may not
  --     touch this requisition must not learn its state from the error message.
  if not public.fms_hr_may_set_hiring_managers(p_req, v_uid) then
    raise exception 'Only an admin, a process coordinator, the person who raised this requisition, or one of its current hiring managers can change who owns it';
  end if;

  -- 4 - 'closed' is ALLOWED, and that is the point. Four of the seven HOD steps -
  --     probation m1/m2/m3, the probation decision and the extension - run AFTER a
  --     vacancy closes, so a closed requisition must stay re-mappable. Only
  --     'cancelled' is refused. Mirrors where fms_hr_reassign_step draws the line.
  if v_status = 'cancelled' then
    raise exception 'This requisition is cancelled - its hiring managers can no longer be changed';
  end if;

  -- 5 - Normalise: drop nulls, dedupe, keep the order the picker showed.
  select coalesce(array_agg(d.x order by d.ord), '{}'::uuid[])
    into v_new
    from (select distinct on (t.x) t.x, t.ord
            from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as t(x, ord)
           where t.x is not null
           order by t.x, t.ord) d;

  -- 6 - The empty-array refusal. fms_hr_is_natural_step_owner resolves the seven HOD
  --     steps to this array; empty it and the first arm is false for everyone, so
  --     HOD shortlist, Round 2 and all four probation reviews fall to whoever holds a
  --     global step-owner row - which, before NR-4, was nobody. A position with no
  --     named head is not a state anyone chose, so it is refused outright even now
  --     that the fall-through exists.
  if cardinality(v_new) = 0 then
    raise exception 'Pick at least one person. Clearing the hiring managers would leave HOD shortlist, Round 2 and all four probation reviews on this vacancy owned by nobody but admins and coordinators.';
  end if;

  -- 7 - Every id must be CURRENT, INTERNAL staff. is_staff() is false both for an
  --     external profile and for a uuid with no profiles row at all, so one predicate
  --     closes the dangling-id hole (the column is uuid[] with no FK) and the
  --     external-user hole together. This matters more than it looks:
  --     hiring_manager_ids is an arm of fms_hr_can_read_requisition, so an external
  --     id here hands a customer every candidate name, phone, expected salary and CV
  --     on this vacancy.
  select coalesce(string_agg(coalesce(nullif(btrim(pr.name), ''), x::text), ', '), '')
    into v_bad
    from unnest(v_new) x
    left join public.profiles pr on pr.id = x
   where not public.is_staff(x);
  if v_bad <> '' then
    raise exception 'Not a current staff member: %', v_bad;
  end if;

  -- NOT refused: somebody with no hr-recruitment grant. The mapping is still
  -- correct - WORKLIST is explicit about this - and the picker warns instead.

  if v_rep_touched then
    select coalesce(array_agg(d.x order by d.ord), '{}'::uuid[])
      into v_rep_new
      from (select distinct on (t.x) t.x, t.ord
              from unnest(p_reporting_to) with ordinality as t(x, ord)
             where t.x is not null
             order by t.x, t.ord) d;

    select coalesce(string_agg(coalesce(nullif(btrim(pr.name), ''), x::text), ', '), '')
      into v_bad
      from unnest(v_rep_new) x
      left join public.profiles pr on pr.id = x
     where not public.is_staff(x);
    if v_bad <> '' then
      raise exception 'Not a current staff member: %', v_bad;
    end if;

    v_rep_changed := not (v_rep_new <@ v_rep_old and v_rep_old <@ v_rep_new);
  else
    v_rep_new := v_rep_old;
  end if;

  -- 8 - No-op: return silently, but only AFTER taking the lock, so a no-op still
  --     serialises against a concurrent real change.
  --     SET comparison, not `=`: array['a','b'] = array['b','a'] is FALSE, so a
  --     reorder would otherwise look like a change and write a meaningless audit row.
  --     An activity row saying "changed from A to A" pollutes a trail two screens
  --     render, and announce would ping the requester about a change that did not
  --     happen - on every double-submit and every retry.
  if (v_new <@ v_old and v_old <@ v_new) and not v_rep_changed then
    return;
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_added
    from unnest(v_new) x where not (x = any(v_old));
  select coalesce(array_agg(x), '{}'::uuid[]) into v_out
    from unnest(v_old) x where not (x = any(v_new));

  -- 9 - The write. updated_at is stamped by the table's own trigger. edited_at and
  --     edited_by are deliberately NOT touched: they mean "the MRF content was edited
  --     and resubmitted", which this is not.
  update public.fms_hr_requisitions
     set hiring_manager_ids = v_new,
         reporting_to_ids   = case when v_rep_touched then v_rep_new else reporting_to_ids end
   where id = p_req;

  if cardinality(v_out) > 0 then
    -- 10 - SELECTIVE handover clearing, and `assigned_to = any(v_out)` is the whole
    --      rule (client decision 07-09-2026). A step handed to a THIRD PARTY -
    --      "Ramesh takes Round 2" - is an instruction about who does the WORK, not
    --      about who owns the position, and it stays true whoever the HOD is.
    --      Clearing every assignee would destroy a real delegation nobody asked to
    --      cancel. Only a row still pointing at a departing head is contradicted by
    --      the re-map.
    --
    --      !! THE `where` IS NOT OPTIONAL. PostgREST's session preloads safeupdate,
    --         so an unqualified DELETE is refused outright there - and a
    --         rollback-wrapped test run as postgres has the setting OFF and would
    --         never show it. Do not "simplify" this.
    with gone as (
      delete from public.fms_hr_step_assignees a
       where a.requisition_id = p_req
         and a.assigned_to = any(v_out)
      returning a.step_key, a.assigned_to, a.assigned_by, a.note
    )
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'step_key',    g.step_key,
               'assigned_to', g.assigned_to,
               'assigned_by', g.assigned_by,
               'note',        g.note) order by g.step_key),
             '[]'::jsonb)
      into v_cleared
      from gone g;

    -- 11 - Retire the outgoing head's stale shortlist digest.
    --      fms_hr_notify_hod_pending keeps one unread "N CVs awaiting your shortlist"
    --      row per (manager, requisition) - 12 exist live, 4 unread. It only ever
    --      touches rows for people CURRENTLY in hiring_manager_ids, so once they are
    --      out of the array it can never clean up after them. Without this the
    --      outgoing head keeps a live bell for a vacancy they can no longer open.
    --      Marked read, never deleted - the same treatment notify_hod_pending gives
    --      its own stale rows.
    update public.fms_hr_notifications n
       set read_at = now()
     where n.user_id = any(v_out)
       and n.type = 'hod_shortlist_pending'
       and n.entity_type = 'requisition'
       and n.entity_id = p_req
       and n.read_at is null;
  end if;

  select coalesce(string_agg(coalesce(nullif(btrim(pr.name), ''), '(unknown)'), ', '
                             order by coalesce(nullif(btrim(pr.name), ''), '(unknown)')),
                  '(nobody)')
    into v_names_old
    from unnest(v_old) x left join public.profiles pr on pr.id = x;

  select coalesce(string_agg(coalesce(nullif(btrim(pr.name), ''), '(unknown)'), ', '
                             order by coalesce(nullif(btrim(pr.name), ''), '(unknown)')),
                  '(nobody)')
    into v_names_new
    from unnest(v_new) x left join public.profiles pr on pr.id = x;

  v_text := v_no || ' - hiring manager changed from ' || v_names_old || ' to ' || v_names_new
            || case when v_note <> '' then ' - ' || v_note else '' end;

  -- 12 - ONE activity row, and a bell for everyone added and everyone removed.
  --      announce skips the actor, nulls and duplicates by itself. The requester is
  --      included because it is their requisition; coordinators are not, because they
  --      read the trail and a per-vacancy bell across 19 positions is noise.
  --
  --      Bell only. email_module_enabled('hr-recruitment') is false, and
  --      'requisition' is not one of the two entity types announce ever emails, so
  --      this cannot send mail even if that switch is flipped. Do not promise HR one.
  --
  --      meta->'cleared_step_assignees' is the ONLY record those handover rows ever
  --      existed. The rollback file restores them from it.
  perform public.fms_hr_announce(
    'requisition', p_req, 'hiring_managers_changed', v_text,
    (v_added || v_out) || array[v_requester],
    jsonb_build_object(
      'before',                 to_jsonb(v_old),
      'after',                  to_jsonb(v_new),
      'added',                  to_jsonb(v_added),
      'removed',                to_jsonb(v_out),
      'cleared_step_assignees', v_cleared,
      'reporting_before',       case when v_rep_touched then to_jsonb(v_rep_old) end,
      'reporting_after',        case when v_rep_touched then to_jsonb(v_rep_new) end,
      'note',                   nullif(v_note, '')
    ));

  -- 13 - Give the incoming head their shortlist digest now, rather than leaving them
  --      to discover the CVs at the next board move.
  --
  --      !! notify_hod_pending early-returns when auth.uid() is not null and cannot
  --         read the requisition. If the actor was a hiring manager who removed
  --         THEMSELVES and holds no other read arm, that is now false and the digest
  --         is skipped. Accepted rather than inlined: the count is computed inside
  --         that function on purpose "so the text can never drift from the board",
  --         and a second copy of the loop is exactly how it would. It self-heals on
  --         the next board action, which calls the same function.
  perform public.fms_hr_notify_hod_pending(p_req);
end $fn$;

revoke execute on function public.fms_hr_set_hiring_managers(uuid, uuid[], text, uuid[]) from public;
revoke execute on function public.fms_hr_set_hiring_managers(uuid, uuid[], text, uuid[]) from anon;
grant  execute on function public.fms_hr_set_hiring_managers(uuid, uuid[], text, uuid[]) to authenticated, service_role;

comment on function public.fms_hr_set_hiring_managers(uuid, uuid[], text, uuid[]) is
  'NR-3. Re-map who acts as the HOD on a vacancy. Refuses an empty array (it would orphan the seven HOD steps) and any non-staff id. Clears ONLY the step handovers pointing at an outgoing manager. p_reporting_to: null = leave alone, {} = clear, else set.';

-- ===========================================================================
-- 4 of 4 - THE PREVIEW
--
-- What the Change HOD dialog shows BEFORE it writes. None of this is guessable from
-- the two arrays, and three of the columns exist because the module's access rules
-- do not line up the way the screen would imply:
--
--   * retains_read - losing hiring_manager_ids does NOT necessarily revoke a read.
--     They may still be a coordinator, recruitment staff, a pipeline viewer, on
--     reporting_to_ids, a step assignee or an interview panellist. Measured on
--     MRF-2627-0019: removing Riya Kumari takes away nothing at all.
--   * retains_requisition_row - fms_hr_requisitions_select calls
--     fms_hr_can_view_requisition, which is can_read OR module_is_viewer. A module
--     viewer keeps the vacancy card and loses only the candidates, so the dialog must
--     not say "loses access" when the card stays.
--   * sees_cvs - the private fms-hr-docs bucket has its OWN policy, gated on
--     coordinator / any_step_owner / pipeline_viewer, and it consults the read gate
--     NOT AT ALL. So a mapped head who owns no step-owner row gets the candidate's
--     name, phone and expected salary and a BLANK ResumeViewer, with no error.
--     Measured: all 14 HODs pass via the `mrf` row; 8 of 11 sub-HODs do not.
--   * has_module / can_edit_module - 13 of 14 HODs hold hr-recruitment at Edit.
--     One does not, and he is named on interview_3. The write does NOT refuse them,
--     because the mapping is still correct; this is what lets the picker say so.
--
-- SECURITY DEFINER because profiles RLS is the root cause of NR-3 in the first place
-- (Saloni sees 5 of 68). A preview that could not name the person being added would
-- be the same bug wearing a different hat.
--
-- !! EVERY COLUMN IT MIGHT EVER NEED IS HERE IN VERSION ONE. A `returns table`
--    cannot be widened by CREATE OR REPLACE either - that needs DROP+CREATE, which
--    revokes the grants.
--
-- It raises the SAME refusal as the write, in the same words. A preview that returned
-- an empty set where the write would refuse reads as "nothing changes", and the user
-- presses Save.
-- ===========================================================================
create or replace function public.fms_hr_preview_hiring_managers(
  p_req          uuid,
  p_ids          uuid[],
  p_reporting_to uuid[] default null
)
returns table(
  id                      uuid,
  name                    text,
  designation             text,
  department_id           uuid,
  department              text,
  direction               text,
  field                   text,
  is_valid                boolean,
  retains_read            boolean,
  retains_requisition_row boolean,
  has_module              boolean,
  can_edit_module         boolean,
  sees_cvs                boolean,
  owns_hod_steps          boolean,
  loses_step_assignees    text[],
  pending_hod_shortlist   integer
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_old         uuid[];
  v_new         uuid[];
  v_rep_old     uuid[];
  v_rep_new     uuid[];
  v_out         uuid[];
  v_pending     integer;
  v_rep_touched boolean := p_reporting_to is not null;
begin
  if v_uid is not null and not public.is_staff(v_uid) then
    raise exception 'Not authorized';
  end if;

  select coalesce(r.hiring_manager_ids, '{}'::uuid[]),
         coalesce(r.reporting_to_ids,   '{}'::uuid[])
    into v_old, v_rep_old
    from public.fms_hr_requisitions r where r.id = p_req;
  if v_old is null then raise exception 'Requisition not found'; end if;

  if not public.fms_hr_may_set_hiring_managers(p_req, v_uid) then
    raise exception 'Only an admin, a process coordinator, the person who raised this requisition, or one of its current hiring managers can change who owns it';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_new
    from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null;

  if v_rep_touched then
    select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_rep_new
      from unnest(p_reporting_to) x where x is not null;
  else
    v_rep_new := v_rep_old;
  end if;

  select coalesce(array_agg(x), '{}'::uuid[]) into v_out
    from unnest(v_old) x where not (x = any(v_new));

  -- The CV count the incoming head inherits, so the dialog can say what they are
  -- picking up. Same stage fms_hr_notify_hod_pending counts.
  select count(*)::integer into v_pending
    from public.fms_hr_candidates c
   where c.requisition_id = p_req and c.stage = 'hr_shortlisted';

  return query
  with pool as (
    select u from unnest(v_old) u
    union select u from unnest(v_new) u
    union select u from unnest(case when v_rep_touched then v_rep_old else '{}'::uuid[] end) u
    union select u from unnest(case when v_rep_touched then v_rep_new else '{}'::uuid[] end) u
  ),
  flagged as (
    select p.u,
           (p.u = any(v_new))     as nm,
           (p.u = any(v_old))     as om,
           v_rep_touched and (p.u = any(v_rep_new)) as nr,
           v_rep_touched and (p.u = any(v_rep_old)) as orr
      from pool p
  )
  select
    f.u,
    coalesce(nullif(btrim(pr.name), ''), '(not a user)'),
    pr.designation,
    pr.department_id,
    d.name,
    case when (f.nm or f.nr) and not (f.om or f.orr) then 'added'
         when (f.om or f.orr) and not (f.nm or f.nr) then 'removed'
         else 'kept' end,
    case when (f.nm or f.om) and (f.nr or f.orr) then 'both'
         when (f.nm or f.om)                     then 'hiring_manager'
         else 'reporting_to' end,
    public.is_staff(f.u),
    public.fms_hr_would_read_requisition(p_req, f.u, v_new, v_rep_new, v_out),
    public.fms_hr_would_read_requisition(p_req, f.u, v_new, v_rep_new, v_out)
      or public.module_is_viewer(f.u, 'hr-recruitment'),
    public.module_level(f.u, 'hr-recruitment') is distinct from 'none',
    public.module_can_edit(f.u, 'hr-recruitment'),
    (public.fms_hr_is_coordinator(f.u)
     or public.fms_hr_is_any_step_owner(f.u)
     or public.fms_hr_is_pipeline_viewer(f.u)),
    -- Could they actually PRESS the seven HOD steps after this write? Note the
    -- module_can_edit arm: a mapped head on View-only is read-only everywhere.
    (public.module_can_edit(f.u, 'hr-recruitment')
     and (public.is_admin(f.u)
          or public.fms_hr_is_coordinator(f.u)
          or f.nm
          or public.fms_hr_is_step_owner('hod_shortlist', f.u))),
    coalesce((select array_agg(a.step_key order by a.step_key)
                from public.fms_hr_step_assignees a
               where a.requisition_id = p_req
                 and a.assigned_to = f.u
                 and f.u = any(v_out)), '{}'::text[]),
    case when f.nm then v_pending else 0 end
  from flagged f
  left join public.profiles    pr on pr.id = f.u
  left join public.departments d  on d.id  = pr.department_id
  order by
    case when (f.nm or f.nr) and not (f.om or f.orr) then 1
         when (f.om or f.orr) and not (f.nm or f.nr) then 2
         else 3 end,
    coalesce(nullif(btrim(pr.name), ''), '(not a user)');
end $fn$;

revoke execute on function public.fms_hr_preview_hiring_managers(uuid, uuid[], uuid[]) from public;
revoke execute on function public.fms_hr_preview_hiring_managers(uuid, uuid[], uuid[]) from anon;
grant  execute on function public.fms_hr_preview_hiring_managers(uuid, uuid[], uuid[]) to authenticated, service_role;

comment on function public.fms_hr_preview_hiring_managers(uuid, uuid[], uuid[]) is
  'NR-3. Who gains and who loses if fms_hr_set_hiring_managers were called with these arrays. Raises the same authorisation refusal as the write.';

-- ===========================================================================
-- THE ASSERTION. See the header for why it is below the DDL and not above it.
-- ===========================================================================
do $equiv$
declare n integer; total integer;
begin
  select count(*) into n
    from public.fms_hr_requisitions r
    cross join public.profiles p
   where public.fms_hr_can_read_requisition(r.id, p.id)
     is distinct from
         public.fms_hr_would_read_requisition(
           r.id, p.id, r.hiring_manager_ids, r.reporting_to_ids, '{}'::uuid[]);

  select count(*) into total
    from public.fms_hr_requisitions r cross join public.profiles p;

  if n <> 0 then
    raise exception
      'NR-3: the read-gate simulator disagrees with the live gate on % of % pairs. fms_hr_would_read_requisition must be re-synced with fms_hr_can_read_requisition before this can ship.',
      n, total;
  end if;

  raise notice 'NR-3: simulator == live read gate on all % pairs.', total;
end $equiv$;

commit;
