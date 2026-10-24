-- ===========================================================================
-- HELP DESK FMS — THE THREAD, AND THE QUESTION-AND-ANSWER LOOP (HD-4).
--
-- The client asked for "a chat module, or remarks like task management, where
-- anyone can tag a particular person so that person is notified". This is it,
-- plus the half that makes it a workflow rather than a chat room: when the desk
-- asks somebody for information, the ticket MOVES TO THEM and stops being the
-- desk's problem until they answer.
--
--   fms_help_post_comment   a remark, with mentions and attachments
--   fms_help_request_info   "I need something from you" -> the ticket moves
--   fms_help_answer_info    "here it is"                -> the ticket comes back
--
-- ⚠ A COMMENT IS AN ACTIVITY ROW, NOT A ROW IN A COMMENTS TABLE. The house
--   pattern (fms_hr_post_comment, fms_travel_post_comment), and the reason is
--   that a ticket's conversation and its history are ONE THING — read in order,
--   or the reader has to interleave two lists to work out what happened.
--
-- ⚠ ONLY A MENTION NOTIFIES. Commenting does not page everybody on the ticket: a
--   coordinator noting "payroll say it went out Tuesday" should not mail four
--   people. Naming somebody is the deliberate act, so the recipient list IS the
--   mentions. The one exception is `request_info`, where moving the ticket to a
--   person IS the notification.
--
-- ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TICKET IS DROPPED, SILENTLY.
--   Raising would let an author probe who can see what by watching which names
--   error; notifying anyway would mail them a link to a page that hands them
--   "that ticket does not exist". So the count that arrives can be lower than
--   what was sent, and that is correct.
--
-- ⚠⚠ ASKING A THIRD PARTY ON A CONFIDENTIAL TICKET GIVES THEM ACCESS TO IT, AND
--    THAT IS RECORDED IN THE OPEN.
--
--    `fms_help_can_see` already admits `info_from_user_id` — it has to, or the
--    person being asked could not read the question. On an ordinary ticket that
--    is unremarkable. On a GRIEVANCE, a POSH complaint or a disciplinary matter
--    it means one click widens the audience of the most sensitive record in the
--    hub, and the obvious guard — refusing it outright — would block the HR Head
--    from investigating, which is the whole job.
--
--    So it is ALLOWED, and it is made LOUD: asking anyone other than the raiser
--    on a confidential ticket writes an extra, undeletable timeline entry naming
--    the person who was let in, and the screen says so before the click. Blocking
--    the work would get the rule worked around off-system, where nothing is
--    recorded at all. See HELP-DESK.md section 12 — whether HR wants this
--    narrowed to a named investigation panel is a question for them, not a
--    default to guess at.
--
-- Purely ADDITIVE: three functions.
-- Rollback: 20261220120000_hd4_help_desk_thread_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_can_see(uuid,uuid)') is null
     or to_regprocedure('public.fms_help_can_act(text,uuid,uuid)') is null then
    raise exception 'HD-4: apply the HD-2 migration first';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- POST A COMMENT.
--
-- ⚠ GATED ON can_SEE, NOT can_ACT. The employee who raised the ticket must be
--   able to add "it still has not arrived" while the ticket sits with HR, and
--   they own no step at that moment. Anyone who can read the conversation may
--   add to it; what they cannot do is MOVE it.
-- ===========================================================================
create or replace function public.fms_help_post_comment(
  p_ticket      uuid,
  p_text        text,
  p_mentions    uuid[] default '{}',
  p_attachments jsonb  default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.fms_help_tickets%rowtype;
  v_recip uuid[];
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket;
  if not found or not public.fms_help_can_see(p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to read';
  end if;

  if nullif(btrim(coalesce(p_text, '')), '') is null
     and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'Write something, or attach something';
  end if;

  -- A closed ticket keeps its thread READABLE but not writable: a conversation
  -- that continues after closure is one nobody is watching, and it is how a
  -- reopened question gets missed. Reopening is the way back in (HD-5).
  if v_t.status in ('closed', 'cancelled') then
    raise exception 'Ticket % is %. Reopen it if there is more to say', v_t.ticket_no, v_t.status;
  end if;

  -- Only mentions are notified, and only those who can actually see it.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_recip
    from unnest(coalesce(p_mentions, '{}'::uuid[])) as u
   where u is not null and public.fms_help_can_see(p_ticket, u);

  perform public.fms_help_announce(
    'ticket', p_ticket, 'comment',
    nullif(btrim(coalesce(p_text, '')), ''),
    v_recip,
    jsonb_build_object(
      'attachments', coalesce(p_attachments, '[]'::jsonb),
      'mentions',    to_jsonb(coalesce(p_mentions, '{}'::uuid[]))
    )
  );
end $$;

comment on function public.fms_help_post_comment(uuid, text, uuid[], jsonb) is
  'One remark on a ticket, with mentions and attachments, written to fms_help_activity as type=''comment''. Gated on can_SEE not can_ACT, so the raiser can chase their own ticket. Only mentions notify, and a mention of somebody who cannot see the ticket is dropped silently.';
grant execute on function public.fms_help_post_comment(uuid, text, uuid[], jsonb) to authenticated;


-- ===========================================================================
-- ASK SOMEBODY FOR MORE — the ticket moves to them.
--
-- PDF step 6, "within 1 working day". The client's words: "the process owner can
-- add some remarks tagging that particular employee, or maybe if there is
-- involvement of any HOD or anyone … now the ball is in the employee's court
-- again. Accordingly you can update the status as well."
--
-- ⚠ THE STATUS CHANGE IS THE POINT, not the remark. Without it the ticket keeps
--   counting against the DESK's turnaround while the desk is the one party that
--   cannot move it. That is how an SLA report ends up measuring how slowly
--   employees answer their own questions.
-- ===========================================================================
create or replace function public.fms_help_request_info(
  p_ticket      uuid,
  p_from_user   uuid,
  p_question    text,
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
  v_cat public.fms_help_categories%rowtype;
  v_new boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('resolve', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to work on';
  end if;
  select * into v_cat from public.fms_help_categories where id = v_t.category_id;

  if v_t.status = 'on_hold' then
    raise exception 'Ticket % is on hold', v_t.ticket_no;
  end if;
  if v_t.current_step not in ('acknowledge', 'resolve') then
    raise exception 'Ticket % is at "%" — ask for more while it is still with you',
      v_t.ticket_no, v_t.current_step;
  end if;
  if p_from_user is null then
    raise exception 'Name the person you need something from';
  end if;
  if p_from_user = v_uid then
    raise exception 'You cannot ask yourself — that would park the ticket on your own desk';
  end if;
  if nullif(btrim(coalesce(p_question, '')), '') is null then
    raise exception 'Say what you need. "More information" is not a question anybody can answer';
  end if;

  -- ⚠ Does this hand somebody NEW the keys to a confidential ticket? Computed
  --   BEFORE the update, because the update is what grants the access.
  v_new := v_cat.confidential
           and p_from_user <> v_t.raised_by
           and not public.fms_help_can_see(p_ticket, p_from_user);

  update public.fms_help_tickets
     set info_from_user_id = p_from_user,
         info_requested_at = now(),
         info_answered_at  = null,
         status            = 'awaiting_info',
         current_step      = 'awaiting_info',
         round_no          = v_t.round_no + 1,
         -- Asking for something IS a response, so the FRT clock stops here too.
         acknowledged_at   = coalesce(v_t.acknowledged_at, now()),
         acknowledged_by   = coalesce(v_t.acknowledged_by, v_uid)
   where id = p_ticket;

  -- The extra, undeletable line in the open. See the ⚠⚠ in the header.
  if v_new then
    perform public.fms_help_announce(
      'ticket', p_ticket, 'help_ticket_access_granted',
      'Given access to this confidential ticket in order to answer a question',
      '{}'::uuid[],
      jsonb_build_object('user_id', p_from_user)
    );
  end if;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_info_requested',
    v_t.ticket_no || ' · ' || v_t.subject || ' — HR needs something from you before this can move on',
    array[p_from_user],
    jsonb_build_object(
      'question',    btrim(p_question),
      'attachments', coalesce(p_attachments, '[]'::jsonb),
      'confidential_access_granted', v_new
    )
  );
end $$;

comment on function public.fms_help_request_info(uuid, uuid, text, jsonb) is
  'The desk asks a named person for something; the ticket MOVES to them (status and current_step both awaiting_info) so it stops counting against the desk''s turnaround. On a confidential ticket, asking anyone but the raiser grants them access and writes an extra timeline entry naming them.';
grant execute on function public.fms_help_request_info(uuid, uuid, text, jsonb) to authenticated;


-- ===========================================================================
-- ANSWER — the ticket comes back to the desk.
-- ===========================================================================
create or replace function public.fms_help_answer_info(
  p_ticket      uuid,
  p_answer      text,
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
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('awaiting_info', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or nobody has asked you anything on it';
  end if;

  if v_t.current_step <> 'awaiting_info' then
    raise exception 'Ticket % is not waiting on anybody', v_t.ticket_no;
  end if;
  if nullif(btrim(coalesce(p_answer, '')), '') is null
     and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'Write your answer, or attach what was asked for';
  end if;

  update public.fms_help_tickets
     set info_answered_at = now(),
         status           = 'open',
         current_step     = 'resolve'
         -- ⚠ info_from_user_id IS DELIBERATELY LEFT SET. It is the audit trail of
         --   who was asked, it is what keeps a confidential ticket readable to
         --   the person who helped, and `current_step` is what decides whose
         --   queue the ticket is in — not this column. Clearing it would erase
         --   the record and revoke the access mid-conversation.
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_info_answered',
    v_t.ticket_no || ' · ' || v_t.subject || ' — answered, it is back with you',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket)) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object(
      'answer',      nullif(btrim(coalesce(p_answer, '')), ''),
      'attachments', coalesce(p_attachments, '[]'::jsonb)
    )
  );
end $$;

comment on function public.fms_help_answer_info(uuid, text, jsonb) is
  'The person the desk asked answers; the ticket returns to `resolve`. info_from_user_id is left set on purpose — it is the record of who was asked and what keeps their access to a confidential ticket from being revoked mid-conversation.';
grant execute on function public.fms_help_answer_info(uuid, text, jsonb) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
begin
  if to_regprocedure('public.fms_help_post_comment(uuid,text,uuid[],jsonb)') is null
     or to_regprocedure('public.fms_help_request_info(uuid,uuid,text,jsonb)') is null
     or to_regprocedure('public.fms_help_answer_info(uuid,text,jsonb)') is null then
    raise exception 'HD-4: an RPC is missing';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-4: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
