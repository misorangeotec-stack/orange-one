-- ===========================================================================
-- HELP DESK FMS — CONFIRM, REOPEN, THE ESCALATION LADDER, AND AUTO-CLOSE (HD-5).
--
-- The last stretch of the flow, and the phase that closes the loop:
--
--   fms_help_confirm       the employee accepts -> closed ('confirmed')
--   fms_help_reopen        the employee refuses -> back to `resolve`, ESCALATES
--   fms_help_auto_close    D9: nobody answered  -> closed ('auto_closed')
--
-- ⚠⚠ ESCALATION FIRES ON A REOPEN, NOT ON A BREACHED TAT (decision D3, the
--    client's own correction on 28-09-2026).
--
--      reopen #1        -> Escalation Level 1 is told, and JOINS the ticket
--      reopen #2 and on -> Escalation Level 2 is told as well
--
--    This is why the module needs no nightly escalation job at all. A late
--    ticket colours red and counts as a miss in the SLA and ageing reports
--    (D8); it pages nobody.
--
-- ⚠ THE PEOPLE ESCALATED TO BECOME CO-OWNERS OF `resolve` FOR THAT TICKET —
--   fms_help_can_act already has that arm. Notifying somebody who then gets
--   "that ticket does not exist" would be theatre.
--
-- ⚠ AND WHEN A LEVEL NAMES NOBODY, THE TICKET SAYS SO RATHER THAN ESCALATING TO
--   NOTHING. On 28-09-2026 every Level 2 on all 30 categories is a LABEL with no
--   portal account behind it — "Management", "Finance Head", "Admin Vendor",
--   "ICC Committee" — because not one of them is a user in this hub. The ladder
--   therefore falls back to config.policy.escalation_fallback_user_id, and if
--   THAT is unset it records the escalation and notifies nobody, visibly. PF-14
--   is the standing lesson: four modules shipped with no owners configured and
--   every approval in them went nowhere, quietly.
--
-- ⚠ CSAT IS CAPTURED AT CONFIRMATION AND NOWHERE ELSE. The PDF names "Employee
--   Satisfaction (CSAT) after ticket closure" as a KPI but gives it no step; one
--   field on the confirm action is the whole of it. An auto-closed ticket
--   therefore has NO rating, deliberately — inventing one would be inventing an
--   opinion the employee never gave.
--
-- Purely ADDITIVE: four functions. The SCHEDULE for auto-close is a SEPARATE
-- migration, applied only on the user's say-so (…_hd5_auto_close_nightly.sql).
-- Rollback: 20261221120000_hd5_help_desk_confirm_reopen_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_can_act(text,uuid,uuid)') is null then
    raise exception 'HD-5: apply the HD-2 migration first';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- Working-day maths, in SQL.
--
-- ⚠⚠ THIS IS A SECOND COPY OF A RULE THAT ALREADY EXISTS IN TYPESCRIPT
--    (frontend/src/shared/lib/workingDays.ts), AND THAT IS A REAL RISK, TAKEN
--    DELIBERATELY AND KEPT AS SMALL AS POSSIBLE.
--
--    The house rule is that no step's due date is computed in SQL, because SQL
--    copies of those rules drifted from the screen three times (see the header
--    of apps/fms-control-center/ranking/types.ts). Auto-close cannot honour that
--    rule: it runs on a schedule with no browser, and the one thing it needs is
--    a date.
--
--    So the copy is confined to ONE rule — "Mon-Sat, skip Sunday" — which is the
--    simplest and most stable thing in that file and has not changed since the
--    first FMS. Everything else auto-close needs (which step, how many days) it
--    reads from the SAME config row the screen reads, so the two cannot disagree
--    about the NUMBER even though they each do the arithmetic.
--
-- ⚠ IST, NOT UTC. This database and every pg_cron job on it run in UTC; India is
--   UTC+5:30 with no DST. A ticket resolved at 23:00 IST is 17:30 UTC the same
--   day, but one resolved at 04:00 IST is 22:30 UTC the day BEFORE — so doing
--   this in UTC would close tickets a day early for anything resolved before
--   05:30. The conversion is explicit here and tested below.
-- ===========================================================================
create or replace function public.fms_help_add_working_days(p_from date, p_n integer)
returns date
language plpgsql
immutable
as $$
declare
  d date := p_from;
  i integer := 0;
begin
  -- Mirrors addWorkingDays(): n = 0 means the anchor day itself, rolled forward
  -- off a Sunday.
  while i < greatest(0, coalesce(p_n, 0)) loop
    d := d + 1;
    if extract(dow from d) = 0 then d := d + 1; end if;
    i := i + 1;
  end loop;
  if extract(dow from d) = 0 then d := d + 1; end if;
  return d;
end $$;

comment on function public.fms_help_add_working_days(date, integer) is
  'Mon-Sat working-day arithmetic, skipping Sundays. A deliberate SQL copy of shared/lib/workingDays.ts addWorkingDays(), needed only by auto-close, which runs with no browser. Kept to that one rule; see the migration header.';
grant execute on function public.fms_help_add_working_days(date, integer) to authenticated;


-- ===========================================================================
-- CONFIRM — the employee accepts the answer, and the ticket closes.
--
-- ⚠ THE RAISER'S ALONE. fms_help_can_act limits `confirm` to them (admins keep
--   it for support). The desk says "resolved"; the employee says "satisfied",
--   and one person supplying both is how a CSAT score stops meaning anything.
-- ===========================================================================
create or replace function public.fms_help_confirm(
  p_ticket uuid,
  p_rating integer default null,
  p_note   text    default null
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
end $$;

comment on function public.fms_help_confirm(uuid, integer, text) is
  'The employee accepts the resolution: the ticket closes as ''confirmed'' and their 1-5 satisfaction rating is captured here and nowhere else.';
grant execute on function public.fms_help_confirm(uuid, integer, text) to authenticated;


-- ===========================================================================
-- REOPEN — the employee is not satisfied, and the ladder moves (D3).
-- ===========================================================================
create or replace function public.fms_help_reopen(
  p_ticket uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

comment on function public.fms_help_reopen(uuid, text) is
  'D3: the employee refuses the answer. The ticket goes back to `resolve` and the ESCALATION LADDER moves — reopen 1 tells Escalation Level 1, reopen 2 and beyond tell Level 2 — with those people becoming co-owners. A level naming nobody falls back to config.policy.escalation_fallback_user_id, and with no fallback the escalation is recorded and notifies nobody, visibly.';
grant execute on function public.fms_help_reopen(uuid, text) to authenticated;


-- ===========================================================================
-- AUTO-CLOSE (D9) — the employee never answered.
--
-- ⚠ IT RECORDS HOW IT CLOSED. `closed_reason = 'auto_closed'`, never
--   'confirmed', and it captures NO rating. The SLA report must keep the two
--   apart: a resolution nobody accepted is not a satisfied employee, and rolling
--   them together is how a desk reports 100% satisfaction from silence.
--
-- ⚠ SERVICE ROLE / SCHEDULER ONLY. It takes no caller and acts on every eligible
--   ticket, so it is not granted to `authenticated`.
-- ===========================================================================
create or replace function public.fms_help_auto_close()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

comment on function public.fms_help_auto_close() is
  'D9: closes tickets the employee never confirmed, as closed_reason = ''auto_closed'' with NO satisfaction rating. Reads the confirmation window from the same fms_help_config.step_sla row the screen reads. Scheduler only — not granted to authenticated.';
revoke execute on function public.fms_help_auto_close() from public;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_d date;
begin
  if to_regprocedure('public.fms_help_confirm(uuid,integer,text)') is null
     or to_regprocedure('public.fms_help_reopen(uuid,text)') is null
     or to_regprocedure('public.fms_help_auto_close()') is null then
    raise exception 'HD-5: an RPC is missing';
  end if;

  -- The working-day copy agrees with the TypeScript it mirrors.
  -- 2026-09-26 is a Saturday: +1 working day must skip Sunday to the Monday.
  v_d := public.fms_help_add_working_days(date '2026-09-26', 1);
  if v_d <> date '2026-09-28' then
    raise exception 'HD-5: Sat +1 working day = %, expected 2026-09-28 (Monday)', v_d;
  end if;
  -- n = 0 rolls a Sunday forward, exactly as addWorkingDays does.
  v_d := public.fms_help_add_working_days(date '2026-09-27', 0);
  if v_d <> date '2026-09-28' then
    raise exception 'HD-5: Sun +0 working days = %, expected the Monday', v_d;
  end if;
  -- A plain mid-week hop stays put.
  v_d := public.fms_help_add_working_days(date '2026-09-29', 2);
  if v_d <> date '2026-10-01' then
    raise exception 'HD-5: Tue +2 working days = %, expected 2026-10-01', v_d;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-5: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
