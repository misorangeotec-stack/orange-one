-- ===========================================================================
-- HELP DESK FMS — REASSIGN, AND FIX A WRONG CATEGORY (HD-6).
--
-- The client's words: "maybe the employee might have selected some wrong help
-- ticket category and he has some different query. There should also be an
-- option for reassigning so that anyone from the HR department can assign or
-- reassign this help ticket to some other person."
--
-- Two different repairs, and they are NOT the same button:
--
--   fms_help_reassign       WRONG PERSON, right category. The ticket keeps its
--                           TAT and its escalation ladder; only who holds it
--                           changes.
--   fms_help_recategorise   WRONG CATEGORY. The owner, the TAT, the escalation
--                           ladder and the confidentiality ALL change, because
--                           all four hang off the category row.
--
-- ⚠ RECATEGORISING MOVES THE DEADLINE, AND THAT IS THE WHOLE POINT OF SAYING SO.
--   An "Attendance Correction" (1 working day) re-filed as a "Payroll Query"
--   (2 working days) gets a day back; a PMS query (3 days) re-filed as attendance
--   loses two, and may be overdue the instant it is moved. Nothing is stored —
--   the due date is derived from the category TAT at read time — so the change is
--   instant and total. The screen must show the reader the new date BEFORE the
--   click. The old category is kept in `recategorised_from` so the SLA report can
--   still say what it was filed as.
--
-- ⚠⚠ A CONFIDENTIAL CATEGORY CANNOT BE CHANGED, IN EITHER DIRECTION, AND BOTH
--    REFUSALS MATTER FOR DIFFERENT REASONS.
--
--    INTO confidential:  people have already read it. Moving it behind the gate
--                        does not unread it, and the screen would then claim a
--                        confidentiality the ticket never had.
--    OUT of confidential: far worse. A grievance re-filed as "General HR Query"
--                        would hand its entire history — the complaint, the
--                        thread, the attachments — to the whole HR pool in one
--                        click, with no warning to the person who raised it.
--
--    The way to move one is to close it and raise a new ticket, which is what the
--    error says. That is deliberate friction on the one operation in this module
--    that could quietly expose a POSH complaint.
--
-- ⚠ WHO MAY BE HANDED A TICKET is the configured reassign pool OR anybody who
--   already owns a ticket category. The pool alone would make this feature inert
--   on day one — `reassign_pool` installs empty — and the only other safe
--   default would be "every profile", which is exactly why the Import module's
--   first Reassign was removed (20260806123000): an approval could be handed to
--   somebody with no authority at all.
--
-- Purely ADDITIVE: three functions.
-- Rollback: 20261222120000_hd6_help_desk_reassign_recategorise_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_can_act(text,uuid,uuid)') is null then
    raise exception 'HD-6: apply the HD-2 migration first';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- Who may RECEIVE a ticket. See the ⚠ in the header.
-- ===========================================================================
create or replace function public.fms_help_can_receive(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (
       public.fms_help_is_reassign_target(p_uid)
       -- The desk itself: anybody already trusted to own a category. This is
       -- what makes the feature work before Setup has been touched.
       or exists (select 1 from public.fms_help_categories c where p_uid = any(c.owner_ids))
     );
$$;

comment on function public.fms_help_can_receive(uuid) is
  'May this user be handed a Help Desk ticket? The configured reassign pool, OR anybody who already owns a ticket category. Deliberately NOT "any profile" — the Import module''s first Reassign was removed for exactly that.';
grant execute on function public.fms_help_can_receive(uuid) to authenticated;


-- ===========================================================================
-- REASSIGN — wrong person, right category.
-- ===========================================================================
create or replace function public.fms_help_reassign(
  p_ticket  uuid,
  p_to_user uuid,
  p_reason  text default null
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
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  -- Gated on `resolve`, the desk's own step: handing a ticket on is the desk's
  -- business, never the raiser's.
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to hand on';
  end if;
  select * into v_cat from public.fms_help_categories where id = v_t.category_id;

  if p_to_user is null then
    raise exception 'Name the person you are handing it to';
  end if;
  if not public.fms_help_can_receive(p_to_user) then
    raise exception 'That person is not set up to receive Help Desk tickets. Add them in Settings, or pick somebody who owns a category';
  end if;
  if p_to_user = coalesce(v_t.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'Ticket % is already with them', v_t.ticket_no;
  end if;

  -- ⚠ ON A CONFIDENTIAL TICKET THIS GRANTS ACCESS, exactly as asking somebody
  --   for information does (HD-4), and it is recorded the same way.
  if v_cat.confidential and not public.fms_help_can_see(p_ticket, p_to_user) then
    perform public.fms_help_announce(
      'ticket', p_ticket, 'help_ticket_access_granted',
      'Given access to this confidential ticket by being handed it',
      '{}'::uuid[],
      jsonb_build_object('user_id', p_to_user)
    );
  end if;

  update public.fms_help_tickets
     set assignee_id = p_to_user
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_reassigned',
    v_t.ticket_no || ' · ' || v_t.subject || ' — this is now yours',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket) || array[p_to_user, v_t.assignee_id]) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object(
      'to_user_id',   p_to_user,
      'from_user_id', v_t.assignee_id,
      'reason',       nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end $$;

comment on function public.fms_help_reassign(uuid, uuid, text) is
  'Hand a ticket to a different person. The TAT and the escalation ladder are unchanged — only who holds it. On a confidential ticket this grants the recipient access and records an entry naming them.';
grant execute on function public.fms_help_reassign(uuid, uuid, text) to authenticated;


-- ===========================================================================
-- RECATEGORISE — the employee filed it under the wrong thing.
-- ===========================================================================
create or replace function public.fms_help_recategorise(
  p_ticket   uuid,
  p_category uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.fms_help_tickets%rowtype;
  v_from public.fms_help_categories%rowtype;
  v_to   public.fms_help_categories%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to re-file';
  end if;

  select * into v_from from public.fms_help_categories where id = v_t.category_id;
  select * into v_to   from public.fms_help_categories where id = p_category;
  if not found or v_to.id is null then
    raise exception 'That category does not exist';
  end if;
  if v_to.id = v_from.id then
    raise exception 'Ticket % is already filed as "%"', v_t.ticket_no, v_from.name;
  end if;
  if not v_to.active then
    raise exception 'The category "%" is no longer in use', v_to.name;
  end if;

  -- ⚠⚠ Both directions refused, for different reasons. See the header.
  if v_to.confidential then
    raise exception
      'You cannot move a ticket INTO "%" — everyone who has already read it would stay able to. Close this one and ask them to raise it again under that category',
      v_to.name;
  end if;
  if v_from.confidential then
    raise exception
      'Ticket % is confidential. Re-filing it would hand its whole history to the wider HR team in one click. Close it instead',
      v_t.ticket_no;
  end if;

  update public.fms_help_tickets
     set category_id        = p_category,
         recategorised_from = coalesce(v_t.recategorised_from, v_t.category_id),
         -- The new category's owners take it over. A named assignee from the old
         -- category would otherwise keep a ticket that is no longer their work.
         assignee_id        = null
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_recategorised',
    v_t.ticket_no || ' · ' || v_t.subject || ' — re-filed as "' || v_to.name || '" and now yours',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket) || array[v_t.raised_by]) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object(
      'from_category', v_from.name,
      'to_category',   v_to.name,
      -- Recorded because the DEADLINE moves with the category, and a reader of
      -- the timeline should be able to see why a ticket's due date jumped.
      'from_tat_days', v_from.tat_days,
      'to_tat_days',   v_to.tat_days,
      'reason',        nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end $$;

comment on function public.fms_help_recategorise(uuid, uuid, text) is
  'Re-file a ticket under the right category. The owner, the TAT and the escalation ladder all change with it, and any named assignee is cleared. REFUSES both directions on a confidential category — see the migration header.';
grant execute on function public.fms_help_recategorise(uuid, uuid, text) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
begin
  if to_regprocedure('public.fms_help_reassign(uuid,uuid,text)') is null
     or to_regprocedure('public.fms_help_recategorise(uuid,uuid,text)') is null
     or to_regprocedure('public.fms_help_can_receive(uuid)') is null then
    raise exception 'HD-6: an RPC is missing';
  end if;

  -- The feature must not be inert on day one: reassign_pool installs empty, so
  -- the category owners are what make it usable.
  if not exists (
    select 1 from public.fms_help_categories c, unnest(c.owner_ids) o
     where public.fms_help_can_receive(o)
  ) then
    raise exception 'HD-6: no category owner can receive a ticket — reassign would be inert';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-6: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
