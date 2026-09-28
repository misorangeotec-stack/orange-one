-- ===========================================================================
-- HELP DESK FMS — THE HAND-OFF TO THE OTHER FIVE MODULES (HD-8, decision D1).
--
-- Eleven of the thirty categories are work another module already owns:
--
--   travel-desk           Travel Booking · Hotel/Flight/Cab · Travel Approval
--                         Coordination · Travel Reimbursement
--   hr-recruitment        Recruitment Status · Interview Scheduling ·
--                         Candidate Coordination · Onboarding Coordination
--   office-supplies       Office Assets / Stationery
--   learning-development  Training & Development
--   hr-exit               Full & Final Settlement
--
-- Help Desk is the ONE FRONT DOOR — an employee should not have to know which of
-- six modules their question belongs to, which is the whole problem this module
-- exists to remove. But the WORK still happens where it belongs, or the same
-- booking is counted twice in two people's KPIs.
--
-- So: the owner raises it in the real module, then records the reference here.
--
--   fms_help_record_handoff   "this became TRV-2627-0007"
--   fms_help_clear_handoff    it was the wrong one
--
-- ⚠⚠ THE REFERENCE IS VERIFIED, NOT TRUSTED. A typed reference that matches
--    nothing is worse than no reference: the ticket then points confidently at a
--    trip that does not exist, and the person who closes it never checks. So
--    record_handoff LOOKS THE REFERENCE UP in the target module's own table and
--    refuses what it cannot find, capturing the real uuid at the same time.
--
-- ⚠ IT RETURNS NOTHING BUT AN ID, and it is callable only by somebody who can
--   already act on the ticket. It reads another module's table as a definer, so
--   it is a read the caller may not otherwise have — kept to "does this
--   reference exist", never to what is in the row.
--
-- ⚠ THERE IS NO AUTOMATIC ROUND TRIP, AND THAT IS A DELIBERATE LIMIT.
--   Deep-linking out to (say) Travel Desk's new-trip form and having it stamp the
--   ticket on save would mean teaching FIVE other modules about Help Desk —
--   their forms, their submit paths and their return handling. `returnTo` in
--   shared/lib is an in-memory "back to the list I left" map, not a cross-module
--   callback, so it cannot carry this. The honest shape today is: a link out,
--   and a verified reference recorded on the way back. If HR find that tedious,
--   the round trip is a real piece of work in those five modules, not a tweak
--   here.
--
-- ⚠ THE TICKET DOES NOT WAIT FOR THE TRIP TO FINISH. It closes when the employee
--   confirms, as any other ticket does. A help ticket that stayed open until a
--   six-week recruitment closed would outlive its usefulness and wreck the
--   ageing report; the ASK is what Help Desk tracks, and the WORK is tracked
--   where it lives.
--
-- Purely ADDITIVE: three functions.
-- Rollback: 20261223120000_hd8_help_desk_handoff_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_can_act(text,uuid,uuid)') is null then
    raise exception 'HD-8: apply the HD-2 migration first';
  end if;
  -- Every table the lookup below reaches into must exist, or a hand-off would
  -- fail at the moment somebody used it rather than here.
  if to_regclass('public.fms_travel_trips')      is null
     or to_regclass('public.fms_hr_requisitions')  is null
     or to_regclass('public.fms_supplies_requests') is null
     or to_regclass('public.fms_ld_requests')     is null
     or to_regclass('public.fms_exit_cases')      is null then
    raise exception 'HD-8: a hand-off target table is missing';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- Resolve a reference in the target module. NULL = no such thing.
--
-- ⚠ THE REF COLUMN IS DIFFERENT IN EVERY MODULE, and there is no shared
--   convention to lean on: trip_no, mrf_no, req_no, code, exit_no. Hard-coded
--   here, one branch each, because the alternative — dynamic SQL over a mapping
--   table — would turn a typo in a config row into an injection surface for no
--   benefit. Five modules is a list, not a pattern.
--
-- ⚠ IT IS CASE- AND SPACE-INSENSITIVE. People paste references out of mail with
--   a trailing space and type them in lower case; refusing those would send the
--   owner hunting for a difference they cannot see.
-- ===========================================================================
create or replace function public.fms_help_resolve_handoff_ref(p_app_id text, p_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref text := upper(btrim(coalesce(p_ref, '')));
  v_id  uuid;
begin
  if v_ref = '' then return null; end if;

  case p_app_id
    when 'travel-desk' then
      select t.id into v_id from public.fms_travel_trips t where upper(btrim(t.trip_no)) = v_ref;
    when 'hr-recruitment' then
      select r.id into v_id from public.fms_hr_requisitions r where upper(btrim(r.mrf_no)) = v_ref;
    when 'office-supplies' then
      select r.id into v_id from public.fms_supplies_requests r where upper(btrim(r.req_no)) = v_ref;
    when 'learning-development' then
      select r.id into v_id from public.fms_ld_requests r where upper(btrim(r.code)) = v_ref;
    when 'hr-exit' then
      select c.id into v_id from public.fms_exit_cases c where upper(btrim(c.exit_no)) = v_ref;
    else
      return null;
  end case;

  return v_id;
end $$;

comment on function public.fms_help_resolve_handoff_ref(text, text) is
  'Does this reference exist in that module? Returns its id or NULL, and nothing else — it reads another module''s table as a definer, so it is deliberately limited to existence. The ref column differs per module (trip_no / mrf_no / req_no / code / exit_no).';
grant execute on function public.fms_help_resolve_handoff_ref(text, text) to authenticated;


-- ===========================================================================
-- RECORD — "this ticket became TRV-2627-0007".
-- ===========================================================================
create or replace function public.fms_help_record_handoff(
  p_ticket uuid,
  p_ref    text,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.fms_help_tickets%rowtype;
  v_cat public.fms_help_categories%rowtype;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  -- The desk's own step: recording where the work went is the desk's job.
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;

  select * into v_cat from public.fms_help_categories where id = v_t.category_id;
  if v_cat.handoff_app_id is null then
    raise exception
      '"%" is answered here, not in another module. If it belongs somewhere else, re-file it first',
      v_cat.name;
  end if;

  -- ⚠ VERIFIED, NOT TRUSTED. See the ⚠⚠ in the header.
  v_id := public.fms_help_resolve_handoff_ref(v_cat.handoff_app_id, p_ref);
  if v_id is null then
    raise exception
      'There is no "%" in that module. Check the reference — a wrong one points the employee at something that does not exist',
      btrim(coalesce(p_ref, ''));
  end if;

  update public.fms_help_tickets
     set handoff_app_id    = v_cat.handoff_app_id,
         handoff_entity_id = v_id,
         handoff_ref       = upper(btrim(p_ref))
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_handed_off',
    v_t.ticket_no || ' · ' || v_t.subject || ' — started as ' || upper(btrim(p_ref)),
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket) || array[v_t.raised_by]) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object(
      'app_id',    v_cat.handoff_app_id,
      'entity_id', v_id,
      'ref',       upper(btrim(p_ref)),
      'note',      nullif(btrim(coalesce(p_note, '')), '')
    )
  );
end $$;

comment on function public.fms_help_record_handoff(uuid, text, text) is
  'D1: record that this ticket''s work was started in another module. The reference is LOOKED UP in that module and refused if it does not exist — a wrong reference points the employee at nothing and nobody ever checks it.';
grant execute on function public.fms_help_record_handoff(uuid, text, text) to authenticated;


-- ===========================================================================
-- CLEAR — it was the wrong one.
--
-- ⚠ THIS EXISTS BECAUSE record_handoff HAS NO OTHER WAY BACK. A stamp with no
--   way to remove it is the FIX-4 trap: a control whose absence is invisible
--   until somebody needs it. It leaves the timeline entry standing — the mistake
--   is part of the history — and only clears the pointer.
-- ===========================================================================
create or replace function public.fms_help_clear_handoff(p_ticket uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.fms_help_tickets%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;
  if v_t.handoff_ref is null then
    raise exception 'Ticket % has no reference recorded', v_t.ticket_no;
  end if;

  update public.fms_help_tickets
     set handoff_app_id = null, handoff_entity_id = null, handoff_ref = null
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_handoff_cleared',
    'Removed the reference ' || v_t.handoff_ref,
    '{}'::uuid[],
    jsonb_build_object('was_ref', v_t.handoff_ref, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end $$;

comment on function public.fms_help_clear_handoff(uuid, text) is
  'Remove a reference recorded in error. The timeline entry stays — the mistake is part of the history — and only the pointer is cleared.';
grant execute on function public.fms_help_clear_handoff(uuid, text) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_n int;
begin
  if to_regprocedure('public.fms_help_record_handoff(uuid,text,text)') is null
     or to_regprocedure('public.fms_help_clear_handoff(uuid,text)') is null
     or to_regprocedure('public.fms_help_resolve_handoff_ref(text,text)') is null then
    raise exception 'HD-8: an RPC is missing';
  end if;

  -- Every module a CATEGORY can hand off to must have a branch in the resolver,
  -- or that category's hand-off would fail the first time anybody used it.
  select count(distinct c.handoff_app_id) into v_n
    from public.fms_help_categories c
   where c.handoff_app_id is not null
     and c.handoff_app_id not in
         ('travel-desk', 'hr-recruitment', 'office-supplies', 'learning-development', 'hr-exit');
  if v_n > 0 then
    raise exception 'HD-8: % category hand-off target(s) have no branch in fms_help_resolve_handoff_ref', v_n;
  end if;

  -- Nonsense in, NULL out — never an exception, or a typo would 500.
  if public.fms_help_resolve_handoff_ref('travel-desk', 'NOT-A-REAL-REF') is not null then
    raise exception 'HD-8: the resolver matched a reference that does not exist';
  end if;
  if public.fms_help_resolve_handoff_ref('not-a-module', 'X') is not null then
    raise exception 'HD-8: the resolver accepted an unknown module';
  end if;
  if public.fms_help_resolve_handoff_ref('travel-desk', '   ') is not null then
    raise exception 'HD-8: the resolver matched a blank reference';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-8: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
