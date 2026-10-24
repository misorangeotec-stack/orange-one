-- ===========================================================================
-- HELP DESK FMS — ACKNOWLEDGE AND RESOLVE (HD-3).
--
-- HD-2 could raise a ticket and read it. This is the half that answers it.
--
--   fms_help_acknowledge   "I have it, I am on it"   -> moves to `resolve`
--   fms_help_resolve       "here is your answer"     -> moves to `confirm`
--
-- ⚠ RESOLVING ALSO ACKNOWLEDGES, IF NOBODY HAD. Half the tickets on this desk
--   will be answered in one go — a payslip request takes a minute — and forcing
--   two clicks for that would either be ignored or, worse, obeyed, producing a
--   ticket acknowledged and resolved in the same second. So `fms_help_resolve`
--   accepts a ticket sitting at EITHER step and back-fills acknowledged_at when
--   it is null.
--
--   That back-fill is what keeps the First Response Time honest: FRT is
--   `acknowledged_at − raised_at`, and answering IS responding. Leaving it null
--   would drop every one-shot resolution out of the FRT report — which is to
--   say, it would drop exactly the fastest ones and make the average look worse
--   than the truth. The PDF's First Contact Resolution KPI counts these same
--   tickets from the other side (`round_no = 0 and reopen_count = 0`).
--
-- ⚠ NEITHER RPC TOUCHES A DUE DATE, because none is stored. The resolve clock is
--   the ticket's CATEGORY TAT, derived at read time (lib/queues.ts). Five
--   categories are deliberately untimed and any stored due column would have to
--   invent a date for them.
--
-- ⚠ A HELD TICKET IS NOT ACTIONABLE, and `fms_help_can_act` already refuses a
--   closed or cancelled one. `on_hold` is checked HERE rather than there,
--   because can_act is also what decides whether a BUTTON renders, and a held
--   ticket should still show its actions greyed with a reason rather than
--   silently losing them. (Hold itself lands in a later phase; the guard is
--   written now so the RPC is never the thing that forgot.)
--
-- Purely ADDITIVE: two functions.
-- Rollback: 20261219120000_hd3_help_desk_acknowledge_resolve_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regclass('public.fms_help_tickets') is null then
    raise exception 'HD-3: apply the HD-2 migration first';
  end if;
  if to_regprocedure('public.fms_help_can_act(text,uuid,uuid)') is null then
    raise exception 'HD-3: fms_help_can_act is missing (HD-2)';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- ACKNOWLEDGE — "I have it."
--
-- The PDF makes this step 5 ("Process Owner reviews the request and verifies
-- supporting documents"), due within 4 working hours. Its DUE DATE here is the
-- same working day, because everything downstream of a due date in this hub is
-- date-granular; the hours live in the First Response report instead. See the
-- hours trap in frontend/src/apps/help-desk/lib/sla.ts.
-- ===========================================================================
create or replace function public.fms_help_acknowledge(
  p_ticket uuid,
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
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found then
    -- ⚠ THE SAME MESSAGE A CONFIDENTIAL TICKET GETS BELOW. Distinguishing "no
    --   such ticket" from "not yours" would confirm that a grievance with that
    --   id exists, which is precisely what the read gate is for.
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;

  if not public.fms_help_can_act('acknowledge', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;

  if v_t.status = 'on_hold' then
    raise exception 'Ticket % is on hold — take it off hold before working on it', v_t.ticket_no;
  end if;

  if v_t.acknowledged_at is not null then
    -- Not an error worth failing a click over: two owners opening the same queue
    -- at once is ordinary. Say so and stop.
    raise exception 'Ticket % was already acknowledged', v_t.ticket_no;
  end if;

  update public.fms_help_tickets
     set acknowledged_at = now(),
         acknowledged_by = v_uid,
         current_step    = 'resolve',
         status          = 'open'
   where id = p_ticket;

  -- The raiser is the one waiting. Co-owners are told too, so a second person
  -- does not pick up work somebody has already started.
  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_acknowledged',
    v_t.ticket_no || ' · ' || v_t.subject || ' — someone from HR has picked this up',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket) || array[v_t.raised_by]) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end $$;

comment on function public.fms_help_acknowledge(uuid, text) is
  'Step 5: the process owner confirms they have the ticket. Moves it to `resolve` and stamps acknowledged_at, which is what the First Response Time report measures against.';
grant execute on function public.fms_help_acknowledge(uuid, text) to authenticated;


-- ===========================================================================
-- RESOLVE — "here is your answer."
--
-- The PDF's step 7, "as per SLA" — and the SLA is the category's, not this
-- function's business. Sends the ticket to the EMPLOYEE, who confirms or
-- reopens (HD-5).
-- ===========================================================================
create or replace function public.fms_help_resolve(
  p_ticket      uuid,
  p_resolution  text,
  p_attachments jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.fms_help_tickets%rowtype;
  v_ack boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;

  if v_t.status = 'on_hold' then
    raise exception 'Ticket % is on hold — take it off hold before resolving it', v_t.ticket_no;
  end if;

  -- ⚠ EITHER STEP IS FINE. A ticket answered in one go never passes through
  --   `resolve` as a separate stop. See the header.
  if v_t.current_step not in ('acknowledge', 'resolve') then
    raise exception 'Ticket % is at "%" — it cannot be resolved from there',
      v_t.ticket_no, v_t.current_step;
  end if;

  -- ⚠ A RESOLUTION WITH NO WORDS IS NOT A RESOLUTION. It is the only record the
  --   employee gets of what was actually done, it is what they are asked to
  --   accept, and it is the evidence the appraisal sheets call for ("Helpdesk
  --   timestamps and escalation log"). Refused rather than defaulted.
  if nullif(btrim(coalesce(p_resolution, '')), '') is null then
    raise exception 'Say what you did — the employee is being asked to accept this answer';
  end if;

  -- Back-fill, so First Response Time counts the fastest tickets rather than
  -- dropping them. See the ⚠ in the header.
  v_ack := v_t.acknowledged_at is null;

  update public.fms_help_tickets
     set resolved_at      = now(),
         resolved_by      = v_uid,
         resolution       = btrim(p_resolution),
         acknowledged_at  = coalesce(v_t.acknowledged_at, now()),
         acknowledged_by  = coalesce(v_t.acknowledged_by, v_uid),
         status           = 'resolved',
         current_step     = 'confirm'
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_resolved',
    v_t.ticket_no || ' · ' || v_t.subject || ' — answered. Please confirm you are happy, or reopen it',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket) || array[v_t.raised_by]) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object(
      'resolution',      btrim(p_resolution),
      'attachments',     coalesce(p_attachments, '[]'::jsonb),
      -- Recorded so the First Contact Resolution figure can be explained, not
      -- just counted: this ticket was answered without ever being picked up first.
      'acknowledged_by_resolving', v_ack
    )
  );
end $$;

comment on function public.fms_help_resolve(uuid, text, jsonb) is
  'Step 7: the process owner answers the ticket and hands it to the employee to confirm. Accepts a ticket at `acknowledge` OR `resolve` and back-fills acknowledged_at, so a one-shot answer still counts in the First Response Time report rather than dropping out of it.';
grant execute on function public.fms_help_resolve(uuid, text, jsonb) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
begin
  if to_regprocedure('public.fms_help_acknowledge(uuid,text)') is null
     or to_regprocedure('public.fms_help_resolve(uuid,text,jsonb)') is null then
    raise exception 'HD-3: an RPC is missing';
  end if;

  -- The universal-module gate, once more (see HD-1's header).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-3: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
