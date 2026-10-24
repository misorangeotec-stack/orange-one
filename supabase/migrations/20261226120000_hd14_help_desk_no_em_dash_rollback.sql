-- Rollback for HD-14: the definitions exactly as they were on the live
-- database on 28-09-2026, em dashes and all.

begin;

CREATE OR REPLACE FUNCTION public.fms_help_acknowledge(p_ticket uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_answer_info(p_ticket uuid, p_answer text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_auto_close()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_days    integer;
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_n       integer := 0;
  r         record;
begin
  select coalesce((value->>'auto_close_enabled')::boolean, false)
    into v_enabled from public.fms_help_config where key = 'policy';
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  -- ⚠ THE SAME CONFIG ROW THE SCREEN READS. The arithmetic is duplicated (see
  --   fms_help_add_working_days); the NUMBER must not be, or an admin changing
  --   the confirmation window in Settings would move the screen and not the job.
  select coalesce((value->'confirm'->>'days')::integer, 2)
    into v_days from public.fms_help_config where key = 'step_sla';
  v_days := coalesce(v_days, 2);

  for r in
    select t.id, t.ticket_no, t.subject, t.resolved_at
      from public.fms_help_tickets t
     where t.current_step = 'confirm'
       and t.status = 'resolved'
       and t.resolved_at is not null
  loop
    -- IST date of the resolution, plus the configured working days.
    if v_today > public.fms_help_add_working_days(
                   (r.resolved_at at time zone 'Asia/Kolkata')::date, v_days) then
      update public.fms_help_tickets
         set status        = 'closed',
             current_step  = null,
             closed_at     = now(),
             closed_reason = 'auto_closed'
       where id = r.id;

      -- Nobody is notified: this is the absence of an event, and mailing
      -- somebody to say they did not reply days ago helps no one.
      insert into public.fms_help_activity (entity_type, entity_id, type, actor_id, note, meta)
      values ('ticket', r.id, 'help_ticket_auto_closed', null,
              'Closed automatically — no reply within ' || v_days || ' working days of the answer',
              jsonb_build_object('confirm_days', v_days));
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_confirm(p_ticket uuid, p_rating integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.fms_help_tickets%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('confirm', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to confirm';
  end if;
  if v_t.current_step <> 'confirm' then
    raise exception 'Ticket % has not been answered yet', v_t.ticket_no;
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'A rating is 1 to 5';
  end if;

  update public.fms_help_tickets
     set confirmed_at  = now(),
         csat_rating   = p_rating,
         csat_note     = nullif(btrim(coalesce(p_note, '')), ''),
         status        = 'closed',
         current_step  = null,
         closed_at     = now(),
         closed_reason = 'confirmed'
   where id = p_ticket;

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_confirmed',
    v_t.ticket_no || ' · ' || v_t.subject || ' — confirmed and closed',
    (select coalesce(array_agg(distinct u), '{}'::uuid[])
       from unnest(public.fms_help_owner_ids(p_ticket)) as u
      where u is not null and public.fms_help_can_see(p_ticket, u)),
    jsonb_build_object('rating', p_rating, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_raise(p_category uuid, p_subject text, p_body text DEFAULT NULL::text, p_other_note text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb, p_mentions uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_cat     public.fms_help_categories%rowtype;
  v_owners  uuid[];
  v_no      text;
  v_id      uuid;
  v_recip   uuid[];
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_cat from public.fms_help_categories where id = p_category;
  if not found then
    raise exception 'That ticket category does not exist';
  end if;
  if not v_cat.active then
    raise exception 'The category "%" is no longer in use', v_cat.name;
  end if;

  -- Who may raise (see the ⚠ above).
  v_owners := public.fms_help_step_owner_ids('raise');
  if coalesce(array_length(v_owners, 1), 0) > 0
     and not (v_uid = any(v_owners))
     and not public.fms_help_is_coordinator(v_uid) then
    raise exception 'Raising a Help Desk ticket is restricted to the people named in Setup';
  end if;

  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'A ticket needs a subject';
  end if;

  -- The "Others" category, and anything else an owner marks the same way. A
  -- category called Others with no note tells the person who has to answer it
  -- precisely nothing.
  if v_cat.requires_note and nullif(btrim(coalesce(p_other_note, '')), '') is null then
    raise exception 'Please describe what this is about — "%" needs it spelled out', v_cat.name;
  end if;

  v_no := 'HD-' || public.fms_help_fy_code(current_date) || '-' ||
          lpad(public.fms_help_next_seq('ticket:' || public.fms_help_fy_code(current_date))::text, 4, '0');

  insert into public.fms_help_tickets (
    ticket_no, category_id, raised_by, subject, body, other_note,
    status, current_step, round_no
  )
  values (
    v_no, p_category, v_uid, btrim(p_subject), nullif(btrim(coalesce(p_body, '')), ''),
    nullif(btrim(coalesce(p_other_note, '')), ''),
    'open', 'acknowledge', 0
  )
  returning id into v_id;

  -- The owners, plus anybody the raiser deliberately named.
  --
  -- ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TICKET IS DROPPED, SILENTLY.
  --   Raising would let an author probe who can see what by watching which
  --   names error; notifying anyway would mail them a link to a page that hands
  --   them Access Denied. So the count that arrives can be lower than the count
  --   that was sent, and that is correct. (Same rule as fms_travel_post_comment.)
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_recip
    from unnest(public.fms_help_owner_ids(v_id) || coalesce(p_mentions, '{}'::uuid[])) as u
   where u is not null and public.fms_help_can_see(v_id, u);

  perform public.fms_help_announce(
    'ticket', v_id, 'help_ticket_raised',
    v_no || ' · ' || btrim(p_subject),
    v_recip,
    jsonb_build_object(
      'category',    v_cat.name,
      'code',        v_cat.code,
      'attachments', coalesce(p_attachments, '[]'::jsonb),
      'mentions',    to_jsonb(coalesce(p_mentions, '{}'::uuid[]))
    )
  );

  return v_id;
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_reassign(p_ticket uuid, p_to_user uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_recategorise(p_ticket uuid, p_category uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_record_handoff(p_ticket uuid, p_ref text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_reopen(p_ticket uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_t     public.fms_help_tickets%rowtype;
  v_cat   public.fms_help_categories%rowtype;
  v_n     integer;
  v_lvl   integer;
  v_ids   uuid[];
  v_label text;
  v_fb    uuid;
  v_recip uuid[];
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_t from public.fms_help_tickets where id = p_ticket for update;
  if not found or not public.fms_help_can_act('confirm', p_ticket, v_uid) then
    raise exception 'That ticket does not exist, or is not yours to reopen';
  end if;
  if v_t.current_step <> 'confirm' then
    raise exception 'Ticket % has not been answered, so there is nothing to reopen', v_t.ticket_no;
  end if;
  -- ⚠ A REASON IS MANDATORY. "Not satisfied" with no words tells the owner
  --   nothing, and a reopen is the one event that pulls other people in — it had
  --   better say why.
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say what is still wrong — the answer is going back to the same person';
  end if;

  select * into v_cat from public.fms_help_categories where id = v_t.category_id;
  v_n := v_t.reopen_count + 1;
  -- Reopen 1 -> level 1. Reopen 2 or more -> level 2. It never climbs past 2,
  -- because the sheet defines no level 3.
  v_lvl := least(v_n, 2);

  if v_lvl = 1 then
    v_ids := v_cat.escalation_l1_ids;
    v_label := coalesce(v_cat.escalation_l1_label, 'Escalation level 1');
  else
    v_ids := v_cat.escalation_l2_ids;
    v_label := coalesce(v_cat.escalation_l2_label, 'Escalation level 2');
  end if;

  -- ⚠ A LEVEL THAT NAMES NOBODY FALLS BACK, and if there is no fallback either,
  --   the escalation is RECORDED and notifies nobody — visibly, on the timeline.
  --   Today that is every Level 2 on every category. See the header.
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    select nullif(value->>'escalation_fallback_user_id', '')::uuid
      into v_fb from public.fms_help_config where key = 'policy';
    if v_fb is not null then
      v_ids := array[v_fb];
    else
      v_ids := '{}'::uuid[];
    end if;
  end if;

  update public.fms_help_tickets
     set reopen_count    = v_n,
         round_no        = v_t.round_no + 1,
         status          = 'open',
         current_step    = 'resolve',
         -- The next resolution replaces this one. The old text is not lost — it
         -- is on the timeline, where the whole argument can be read in order.
         resolved_at     = null,
         resolved_by     = null,
         resolution      = null,
         confirmed_at    = null,
         escalated_l1_at = case when v_lvl >= 1 then coalesce(v_t.escalated_l1_at, now()) else v_t.escalated_l1_at end,
         escalated_l2_at = case when v_lvl >= 2 then coalesce(v_t.escalated_l2_at, now()) else v_t.escalated_l2_at end
   where id = p_ticket;

  -- The owners, plus whoever this level reaches. Computed AFTER the update so
  -- fms_help_owner_ids already includes the newly escalated people.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_recip
    from unnest(public.fms_help_owner_ids(p_ticket) || v_ids) as u
   where u is not null and public.fms_help_can_see(p_ticket, u);

  perform public.fms_help_announce(
    'ticket', p_ticket, 'help_ticket_reopened',
    v_t.ticket_no || ' · ' || v_t.subject || ' — reopened (' || v_n || '): ' || btrim(p_reason),
    v_recip,
    jsonb_build_object(
      'reason',          btrim(p_reason),
      'reopen_count',    v_n,
      'level',           v_lvl,
      'level_label',     v_label,
      -- The honest record of whether anybody was actually reachable.
      'notified_anyone', coalesce(array_length(v_ids, 1), 0) > 0
    )
  );
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_request_info(p_ticket uuid, p_from_user uuid, p_question text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;


CREATE OR REPLACE FUNCTION public.fms_help_resolve(p_ticket uuid, p_resolution text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

commit;
