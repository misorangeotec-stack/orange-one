-- ===========================================================================
-- HELP DESK FMS — THE MONTHLY MIS (HD-10).
--
-- PDF step 11: "Monthly SLA, ageing and trend analysis · HR Manager · Monthly ·
-- HR Helpdesk MIS". And its stated KPIs: First Response Time <= 30 minutes, SLA
-- compliance >= 95%, First Contact Resolution >= 80%, Average Resolution Time,
-- Reopened tickets %, CSAT after closure, pending ticket ageing, category-wise
-- trend.
--
--   fms_help_mis(from, to)                  the six open reports
--   fms_help_confidential_register(from,to) the seventh, behind its own gate
--
-- ⚠⚠ THESE ARE THE ONLY READS THAT SEE EVERY HELP TICKET RATHER THAN JUST THE
--    READER'S, AND THAT IS WHY THEY ARE FUNCTIONS RATHER THAN QUERIES.
--
--    (Every report here is about HELP TICKETS ONLY. Nothing in this file looks
--    at any other module.)
--
--    Everywhere else, `fms_help_can_see` withholds tickets — which is right, and
--    which makes an honest desk-wide total impossible to compute in the
--    browser. The Control Center says so and shows "what you can see". A MIS
--    cannot: a compliance figure that silently omits what the reader is not
--    allowed to see is worse than no figure, because it looks authoritative.
--
--    So these run as definers, and each checks the caller ITSELF. A policy is
--    evaluated as the caller and would not survive the definer boundary.
--
-- ⚠⚠ THE SIX OPEN REPORTS EXCLUDE CONFIDENTIAL CATEGORIES ENTIRELY — they do not
--    merely hide the subject lines, they leave the tickets out of every count.
--
--    A "23 tickets this month" that includes two grievances tells a reader how
--    many grievances exist, which is the first thing decision D4 withholds; and a
--    POSH complaint's resolution time is not a service-desk metric. The HR Head's
--    own KRA 12 asks for those on a SEPARATE authorised register, which is
--    exactly what the second function is.
--
--    Every block therefore carries `excluded_confidential` so the screen can say
--    "3 confidential tickets are not counted here" rather than quietly reporting
--    a smaller world.
--
-- ⚠ AN UNTIMED CATEGORY IS NOT A MISS. Five categories are governed by policy
--   rather than working days ("As per POSH Policy", "As per Exit Policy", …).
--   They are counted in `untimed` and left OUT of the compliance denominator.
--   Folding them in either way — as met or as missed — invents a promise nobody
--   made. This is the single most likely way for this report to start lying.
--
-- ⚠ 'auto_closed' IS NOT 'confirmed'. D9 closes a ticket the employee ignored;
--   counting that as satisfaction is how a desk reports 100% CSAT out of
--   silence. They are separate figures in `closure`, and the CSAT average is
--   computed only over tickets that actually carry a rating.
--
-- Purely ADDITIVE: four functions.
-- Rollback: 20261224120000_hd10_help_desk_mis_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_add_working_days(date,integer)') is null then
    raise exception 'HD-10: apply the HD-5 migration first';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- WHO MAY READ WHAT
-- ===========================================================================

-- The six open reports: anybody who runs the desk.
create or replace function public.fms_help_may_read_mis(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (
       public.fms_help_is_coordinator(p_uid)          -- includes admins
       or exists (select 1 from public.fms_help_categories c
                   where p_uid = any(c.owner_ids)
                      or p_uid = any(c.escalation_l1_ids)
                      or p_uid = any(c.escalation_l2_ids))
       or exists (select 1 from public.fms_help_step_owners o where p_uid = any(o.employee_ids))
     );
$$;

comment on function public.fms_help_may_read_mis(uuid) is
  'May this user read the Help Desk MIS? Anybody who runs the desk: a category owner, somebody named on an escalation level, a Setup step owner, a coordinator or an admin. The MIS counts every help ticket, not just the reader''s, so it needs its own gate — RLS cannot express that.';
grant execute on function public.fms_help_may_read_mis(uuid) to authenticated;

-- ⚠ THE REGISTER IS NARROWER, AND DELIBERATELY SO. It lists grievance, POSH and
--   disciplinary matters, so it is limited to the people who OWN those three
--   categories — the HR Head and the ICC — plus admins. A Setup step owner or a
--   coordinator does NOT qualify: the same reasoning as fms_help_can_see, and as
--   fms_hr_may_see_grievances before it.
create or replace function public.fms_help_may_read_confidential(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (
       public.is_admin(p_uid)
       or exists (select 1 from public.fms_help_categories c
                   where c.confidential and p_uid = any(c.owner_ids))
     );
$$;

comment on function public.fms_help_may_read_confidential(uuid) is
  'May this user read the confidential register (Riya''s KRA 12)? Only an owner of a confidential category — the HR Head, the ICC — plus admins. NOT coordinators and NOT step owners: a POSH complaint may be about one of them.';
grant execute on function public.fms_help_may_read_confidential(uuid) to authenticated;


-- ===========================================================================
-- Was this ticket resolved inside its category's TAT?
--
-- Returns TRUE / FALSE / NULL, and the NULL is load-bearing: it means "there was
-- no deadline to meet", and every caller must keep it out of the denominator.
-- ===========================================================================
create or replace function public.fms_help_met_tat(
  p_raised_at timestamptz,
  p_resolved_at timestamptz,
  p_tat_days integer
)
returns boolean
language sql
immutable
as $$
  select case
    when p_tat_days is null or p_resolved_at is null then null
    else (p_resolved_at at time zone 'Asia/Kolkata')::date
         <= public.fms_help_add_working_days((p_raised_at at time zone 'Asia/Kolkata')::date, p_tat_days)
  end;
$$;

comment on function public.fms_help_met_tat(timestamptz, timestamptz, integer) is
  'Did this ticket meet its category TAT? NULL when the category is untimed — callers must leave those out of the compliance denominator rather than counting them either way. IST dates, because the desk works in IST and the database is UTC.';
grant execute on function public.fms_help_met_tat(timestamptz, timestamptz, integer) to authenticated;


-- ===========================================================================
-- THE MIS
-- ===========================================================================
create or replace function public.fms_help_mis(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_out   jsonb;
  v_frt_target int;
begin
  if not public.fms_help_may_read_mis(v_uid) then
    raise exception 'The Help Desk MIS is for the people who run the desk';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Give a from and a to date, in that order';
  end if;

  select coalesce((value->>'frt_target_minutes')::int, 30)
    into v_frt_target from public.fms_help_config where key = 'policy';

  -- ⚠ A CTE, NOT A TEMP TABLE. The first draft built `_mis` with CREATE TEMP
  --   TABLE and the function is `stable`, which Postgres refuses outright:
  --   "CREATE TABLE is not allowed in a non-volatile function". Making it
  --   volatile to keep the temp table would have been the wrong fix — a report
  --   should not be allowed to write — so the whole thing is one statement and
  --   every block below reads the same CTE.
  with mis as (
    select t.id, c.id as category_id, c.code, c.name, c.owner_ids, c.tat_days,
           t.raised_at, t.acknowledged_at, t.resolved_at, t.status, t.closed_reason,
           t.reopen_count, t.round_no, t.csat_rating,
           public.fms_help_met_tat(t.raised_at, t.resolved_at, c.tat_days) as met
      from public.fms_help_tickets t
      join public.fms_help_categories c on c.id = t.category_id
     where not c.confidential
       and (t.raised_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  -- How many were left out, so the screen can say so rather than quietly
  -- reporting a smaller world. A COUNT ONLY — never the subjects.
  conf as (
    select count(*) as n
      from public.fms_help_tickets t
      join public.fms_help_categories c on c.id = t.category_id
     where c.confidential
       and (t.raised_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  -- Still open TODAY, whenever it was raised. "How old is the backlog" is a
  -- question about now; filtering it by raise date would hide the oldest
  -- tickets, which are the only ones this report exists to find.
  open_now as (
    select (v_today - (t.raised_at at time zone 'Asia/Kolkata')::date) as d
      from public.fms_help_tickets t
      join public.fms_help_categories c on c.id = t.category_id
     where not c.confidential and t.status not in ('closed', 'cancelled')
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'as_of', v_today,
    'frt_target_minutes', v_frt_target,
    'excluded_confidential', (select n from conf),
    'raised', (select count(*) from mis),

    -- ── 1. SLA compliance, per category ────────────────────────────────────
    -- ⚠ `within` is over `timed` (tickets that HAD a deadline), never over
    --   `resolved`. `untimed` is reported beside it, not folded in.
    'sla_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', code, 'category', name,
               'raised',   n_raised,
               'resolved', n_resolved,
               'timed',    n_timed,
               'within',   n_within,
               'untimed',  n_untimed
             ) order by name)
        from (
          select code, name,
                 count(*) as n_raised,
                 count(*) filter (where resolved_at is not null) as n_resolved,
                 count(*) filter (where met is not null) as n_timed,
                 count(*) filter (where met) as n_within,
                 count(*) filter (where tat_days is null) as n_untimed
            from mis group by code, name
        ) s
    ), '[]'::jsonb),

    -- ── 2. SLA compliance, per owner ───────────────────────────────────────
    -- ⚠ Unnested over the category's owners: "General HR Query" has four, and a
    --   ticket raised under it counts for EACH of them. That is right for a
    --   workload read and wrong for a total — the screen must not sum this.
    'sla_by_owner', coalesce((
      select jsonb_agg(jsonb_build_object(
               'owner_id', o,
               'raised',   n_raised,
               'resolved', n_resolved,
               'timed',    n_timed,
               'within',   n_within,
               'untimed',  n_untimed
             ) order by o)
        from (
          select o,
                 count(*) as n_raised,
                 count(*) filter (where m.resolved_at is not null) as n_resolved,
                 count(*) filter (where m.met is not null) as n_timed,
                 count(*) filter (where m.met) as n_within,
                 count(*) filter (where m.tat_days is null) as n_untimed
            from mis m, unnest(m.owner_ids) o group by o
        ) s
    ), '[]'::jsonb),

    -- ── 3. Ageing of what is still OPEN ────────────────────────────────────
    'ageing', coalesce((
      select jsonb_agg(jsonb_build_object('band', band, 'tickets', n) order by sort)
        from (
          select band, min(sort) as sort, count(*) as n
            from (
              select case
                       when d <= 1 then '0-1 days'
                       when d <= 3 then '2-3 days'
                       when d <= 7 then '4-7 days'
                       when d <= 15 then '8-15 days'
                       else '15+ days'
                     end as band,
                     case
                       when d <= 1 then 1 when d <= 3 then 2 when d <= 7 then 3
                       when d <= 15 then 4 else 5
                     end as sort
                from open_now
            ) a group by band
        ) s
    ), '[]'::jsonb),

    -- ── 4. Category trend, by month ────────────────────────────────────────
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
               'month', m, 'code', code, 'category', name, 'tickets', n
             ) order by m, name)
        from (
          select to_char((raised_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM') as m,
                 code, name, count(*) as n
            from mis
           group by 1, code, name
        ) s
    ), '[]'::jsonb),

    -- ── 5. First response ──────────────────────────────────────────────────
    -- ⚠ MINUTES, not a due date. The engine is date-granular everywhere else
    --   (see lib/sla.ts); this is the one figure measured in minutes, and it is
    --   MEASURED rather than deadlined.
    'first_response', (
      select jsonb_build_object(
               'answered', count(*) filter (where acknowledged_at is not null),
               'never_answered', count(*) filter (where acknowledged_at is null),
               'median_minutes', percentile_cont(0.5) within group (
                 order by extract(epoch from (acknowledged_at - raised_at)) / 60
               ) filter (where acknowledged_at is not null),
               'within_target', count(*) filter (
                 where acknowledged_at is not null
                   and extract(epoch from (acknowledged_at - raised_at)) / 60 <= v_frt_target
               )
             )
        from mis
    ),

    -- ── 6. Resolution time, reopens, first-contact resolution ──────────────
    'resolution', (
      select jsonb_build_object(
               'resolved', count(*) filter (where resolved_at is not null),
               'avg_hours', avg(extract(epoch from (resolved_at - raised_at)) / 3600)
                            filter (where resolved_at is not null),
               'reopened', count(*) filter (where reopen_count > 0),
               'reopened_twice_plus', count(*) filter (where reopen_count > 1),
               -- The PDF's FCR: answered without ever going back and forth.
               'first_contact', count(*) filter (
                 where resolved_at is not null and reopen_count = 0 and round_no = 0
               )
             )
        from mis
    ),

    -- ── 7. How they closed, and what people thought ────────────────────────
    -- ⚠ 'confirmed' and 'auto_closed' ARE SEPARATE. See the header.
    'closure', (
      select jsonb_build_object(
               'closed',      count(*) filter (where status = 'closed'),
               'confirmed',   count(*) filter (where closed_reason = 'confirmed'),
               'auto_closed', count(*) filter (where closed_reason = 'auto_closed'),
               'cancelled',   count(*) filter (where status = 'cancelled'),
               'still_open',  count(*) filter (where status not in ('closed', 'cancelled')),
               'rated',       count(*) filter (where csat_rating is not null),
               -- Over the tickets that CARRY a rating. An auto-closed ticket has
               -- none, by design, and must not be averaged in as a zero.
               'csat_avg',    avg(csat_rating) filter (where csat_rating is not null)
             )
        from mis
    )
  ) into v_out;

  return v_out;
end $$;

comment on function public.fms_help_mis(date, date) is
  'PDF step 11: the monthly HR Helpdesk MIS. Org-wide, so it runs as a definer and checks the caller itself. EXCLUDES confidential categories from every count (see fms_help_confidential_register) and reports how many it left out. Untimed categories are counted in `untimed` and kept OUT of the compliance denominator.';
grant execute on function public.fms_help_mis(date, date) to authenticated;


-- ===========================================================================
-- THE CONFIDENTIAL REGISTER — Riya's KRA 12.
--
-- "Log 100% Level-3 grievances, disciplinary, POSH or legally sensitive matters
-- on the authorised confidential register. Acknowledge/escalate critical cases
-- within 1 working day."
--
-- ⚠ IT RETURNS DATES AND STATUS, NOT THE COMPLAINT. No subject, no body, no
--   resolution — those live on the ticket, behind fms_help_can_see, and a
--   register that reprinted them would be a second, easier copy of the thing the
--   gate exists to protect. What a register is FOR is proving the case was
--   logged and answered in time.
-- ===========================================================================
create or replace function public.fms_help_confidential_register(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.fms_help_may_read_confidential(v_uid) then
    raise exception 'The confidential register is for the HR Head and the ICC';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Give a from and a to date, in that order';
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'ticket_no',   t.ticket_no,
               'category',    c.name,
               'code',        c.code,
               'raised_at',   t.raised_at,
               'raised_by',   t.raised_by,
               -- The KRA's own measure: acknowledged within 1 working day.
               'acknowledged_at', t.acknowledged_at,
               'acked_next_day', case
                 when t.acknowledged_at is null then null
                 else (t.acknowledged_at at time zone 'Asia/Kolkata')::date
                      <= public.fms_help_add_working_days(
                           (t.raised_at at time zone 'Asia/Kolkata')::date, 1)
               end,
               'resolved_at', t.resolved_at,
               'closed_at',   t.closed_at,
               'status',      t.status,
               'reopen_count', t.reopen_count,
               'escalated_l1_at', t.escalated_l1_at,
               'escalated_l2_at', t.escalated_l2_at
             ) order by t.raised_at
           )
      from public.fms_help_tickets t
      join public.fms_help_categories c on c.id = t.category_id
     where c.confidential
       and (t.raised_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), '[]'::jsonb);
end $$;

comment on function public.fms_help_confidential_register(date, date) is
  'Riya''s KRA 12: the authorised confidential register. Dates, status and whether each was acknowledged within one working day — NEVER the subject, body or resolution, which stay behind fms_help_can_see. A register proves the case was logged and answered in time; it is not a second copy of the complaint.';
grant execute on function public.fms_help_confidential_register(date, date) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_d date;
begin
  if to_regprocedure('public.fms_help_mis(date,date)') is null
     or to_regprocedure('public.fms_help_confidential_register(date,date)') is null then
    raise exception 'HD-10: an RPC is missing';
  end if;

  -- An untimed category must answer NULL, not false. This is the single most
  -- likely way for the compliance figure to start lying.
  if public.fms_help_met_tat(now() - interval '30 days', now(), null) is not null then
    raise exception 'HD-10: an untimed category was scored rather than excluded';
  end if;
  -- A 1-day TAT raised on a Saturday is met on the Monday, not missed.
  if public.fms_help_met_tat(
       timestamptz '2026-09-26 10:00+05:30', timestamptz '2026-09-28 10:00+05:30', 1) is not true then
    raise exception 'HD-10: Sat + 1 working day did not reach the Monday';
  end if;
  if public.fms_help_met_tat(
       timestamptz '2026-09-26 10:00+05:30', timestamptz '2026-09-29 10:00+05:30', 1) is not false then
    raise exception 'HD-10: a ticket resolved two working days late was scored as met';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-10: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
