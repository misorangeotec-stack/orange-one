-- ===========================================================================
-- HELP DESK FMS — THE TICKET, ITS TWO GATES, AND RAISING ONE (HD-2).
--
-- HD-1 built the router (fms_help_categories). This is the thing being routed.
--
--   raise -> acknowledge -> [awaiting_info] -> resolve -> confirm -> closed
--                                 ^                |          |
--                                 +----------------+          +-> reopen (escalates)
--
-- WHAT LANDS HERE
--   1. fms_help_tickets
--   2. fms_help_can_see  — the READ gate, and the whole of decision D4
--   3. fms_help_can_act  — the WRITE gate, called by every step RPC
--   4. fms_help_owner_ids — who owns this ticket right now, for the fan-out
--   5. fms_help_raise    — the one RPC this phase needs
--   6. the storage rule the bucket has been waiting for since HD-1
--   7. the activity read policy, NARROWED from HD-1's placeholder
--
-- Plan and decision record: HELP-DESK.md (D1-D10).
--
-- ⚠⚠ STILL NO module_can_edit ANYWHERE. help-desk is universal; that gate is
--   false for every non-admin. See the ⚠⚠ block in the HD-1 foundations
--   migration. The assertion at the foot of this file proves it again.
--
-- ⚠ FOUR STEPS, FOUR DIFFERENT OWNERS, AND ONLY ONE OF THEM IS IN SETUP.
--     acknowledge / resolve  the ticket's CATEGORY owners — or, once somebody
--                            has reassigned it, the named assignee INSTEAD
--     awaiting_info          the person the owner tagged
--     confirm                whoever raised it
--   Rows in fms_help_step_owners are ADDITIVE co-owners on top of those, which
--   is how HR gets "the same rights as the process owner" without being named on
--   30 category rows. The owner arms below deliberately do NOT early-return past
--   the confidential test — hr-recruitment's equivalent does, and hr-exit's
--   comment names that as the bug avoided.
--
-- ⚠ THE DUE DATE IS NOT STORED, AND MUST NOT BE. It is derived in TypeScript
--   from the category's TAT (lib/sla.ts), because five categories are
--   deliberately untimed and the engine already means `dueIso = null` as "can
--   never be late". A stored due column would have to invent a date for those
--   five, and the Master Report would then report "nothing is late" when the
--   truth is "not measurable from SQL".
--
-- Purely ADDITIVE.
-- Rollback: 20261218120000_hd2_help_desk_tickets_rollback.sql
-- ===========================================================================

-- ── 0. Checks first, OUTSIDE any lock ───────────────────────────────────────
do $pre$
begin
  if to_regclass('public.fms_help_categories') is null then
    raise exception 'HD-2: apply the HD-1 migrations first';
  end if;
  if to_regclass('public.fms_help_tickets') is not null then
    raise exception 'HD-2: fms_help_tickets already exists — this migration has been applied';
  end if;
  if not exists (select 1 from storage.buckets where id = 'fms-help-docs') then
    raise exception 'HD-2: the fms-help-docs bucket is missing (HD-1)';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- fms_help_tickets
-- ===========================================================================
create table if not exists public.fms_help_tickets (
  id            uuid primary key default gen_random_uuid(),
  -- HD-2627-0001. FY-scoped; the counter key contains the FY, so the series
  -- restarts each April with no reset job.
  ticket_no     text not null unique,

  -- on delete restrict: a category with tickets against it must be deactivated,
  -- not deleted, or the MIS loses the rows it groups by.
  category_id   uuid not null references public.fms_help_categories(id) on delete restrict,
  raised_by     uuid references auth.users on delete set null,
  raised_at     timestamptz not null default now(),

  subject       text not null check (length(btrim(subject)) > 0),
  body          text,
  -- The "Others" category forces this; fms_help_raise refuses without it.
  other_note    text,

  -- ⚠ STATUSES ARE NOT STEP KEYS. The rule every module here follows: a status
  --   sitting in the work queue flows into the KPI tiles and the cross-FMS
  --   scoreboard as "work owed by Nobody".
  status        text not null default 'open'
                check (status in ('open', 'awaiting_info', 'resolved', 'closed', 'cancelled', 'on_hold')),
  -- null once the ticket has stopped moving.
  current_step  text check (current_step in ('acknowledge', 'awaiting_info', 'resolve', 'confirm')),
  -- Bumped by every loop — a question asked, a reopen. The ranking scorer keys
  -- stepId on it so round 2's resolve is a different scored step from round 1's,
  -- exactly as Order to Dispatch does.
  round_no      integer not null default 0 check (round_no >= 0),

  -- A reassignment REPLACES the category's owners for this ticket. Null = the
  -- category still decides. (Same shape as fms_ld_step_assignees.)
  assignee_id   uuid references auth.users on delete set null,

  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users on delete set null,

  -- The loop: the owner asked somebody for information and is waiting on them.
  info_from_user_id uuid references auth.users on delete set null,
  info_requested_at timestamptz,
  info_answered_at  timestamptz,

  resolved_at   timestamptz,
  resolved_by   uuid references auth.users on delete set null,
  resolution    text,

  confirmed_at  timestamptz,
  -- The PDF names CSAT as a KPI but gives it no step. It is one field at
  -- confirmation, not a step of its own.
  csat_rating   integer check (csat_rating is null or csat_rating between 1 and 5),
  csat_note     text,

  -- D3: the escalation ladder is driven by REOPENS, never by a TAT breach.
  reopen_count    integer not null default 0 check (reopen_count >= 0),
  escalated_l1_at timestamptz,
  escalated_l2_at timestamptz,

  closed_at     timestamptz,
  -- D9. 'auto_closed' is the employee never answering. The SLA report counts it
  -- SEPARATELY from 'confirmed', so a resolution nobody accepted is never
  -- reported as a satisfied employee.
  closed_reason text check (closed_reason in ('confirmed', 'auto_closed', 'cancelled')),

  hold_from_status text,
  held_at       timestamptz,
  held_by       uuid references auth.users on delete set null,
  hold_reason   text,

  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users on delete set null,
  cancel_reason text,

  -- D1: the module that actually owns this work, stamped when the owner raises
  -- it there. handoff_ref is the other module's human reference (TRV-2627-0007),
  -- copied so the ticket reads correctly even to somebody with no grant there.
  handoff_app_id    text,
  handoff_entity_id uuid,
  handoff_ref       text,

  -- D5: Dharmistha's KRA 9 is measured on the hand-off to the outside IT
  -- partner ("escalated within 24 hours"), which is a different event from our
  -- own escalation ladder.
  external_escalated_at timestamptz,
  external_ref          text,

  -- Where it came from, when somebody fixed the employee's choice of category.
  recategorised_from uuid references public.fms_help_categories(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A ticket that has stopped moving has no step, and one that is moving has one.
  constraint fms_help_tickets_step_matches_status check (
    (status in ('closed', 'cancelled') and current_step is null)
    or (status not in ('closed', 'cancelled') and current_step is not null)
  ),
  constraint fms_help_tickets_closed_has_reason check (
    (status = 'closed') = (closed_reason is not null and closed_reason <> 'cancelled')
    or status = 'cancelled'
  ),
  -- Waiting on somebody means knowing who.
  constraint fms_help_tickets_awaiting_names_someone check (
    current_step <> 'awaiting_info' or info_from_user_id is not null
  ),
  -- CSAT is something the employee says at confirmation, never earlier.
  constraint fms_help_tickets_csat_needs_confirmation check (
    csat_rating is null or confirmed_at is not null
  )
);

comment on table public.fms_help_tickets is
  'One HR Help Desk ticket, from the question to the closure. The CATEGORY (fms_help_categories) decides its owner, its TAT and its escalation ladder; four of its five steps are row-owned rather than owned by fms_help_step_owners. Due dates are NOT stored — they are derived from the category TAT in lib/sla.ts, because five categories are deliberately untimed.';
comment on column public.fms_help_tickets.assignee_id is
  'A reassignment REPLACES the category owners for this ticket. Null means the category still decides.';
comment on column public.fms_help_tickets.closed_reason is
  'D9: ''confirmed'' = the employee accepted the resolution. ''auto_closed'' = they never answered and the clock ran out. The SLA report must keep these apart.';
comment on column public.fms_help_tickets.round_no is
  'Incremented by every loop (a question asked, a reopen). The ranking scorer keys stepId on it so the same step in two rounds is two scored steps.';

create index if not exists fms_help_tickets_raised_by_idx  on public.fms_help_tickets (raised_by, raised_at desc);
create index if not exists fms_help_tickets_category_idx   on public.fms_help_tickets (category_id, raised_at desc);
create index if not exists fms_help_tickets_assignee_idx   on public.fms_help_tickets (assignee_id) where assignee_id is not null;
create index if not exists fms_help_tickets_awaiting_idx   on public.fms_help_tickets (info_from_user_id) where current_step = 'awaiting_info';
-- The queues: everything still moving, newest question first.
create index if not exists fms_help_tickets_open_step_idx  on public.fms_help_tickets (current_step, raised_at)
  where status not in ('closed', 'cancelled');

drop trigger if exists trg_fms_help_tickets_updated on public.fms_help_tickets;
create trigger trg_fms_help_tickets_updated
  before update on public.fms_help_tickets
  for each row execute function public.set_updated_at();


-- ===========================================================================
-- 2. THE READ GATE — and the whole of decision D4.
--
-- An ordinary ticket is readable by the people who run the desk. A CONFIDENTIAL
-- one (Employee Grievance, POSH, Disciplinary Matters) is readable ONLY by the
-- raiser, the category's own owners, a named assignee, anyone currently waiting
-- to answer it, anyone the ladder has actually escalated to, and admins.
--
-- ⚠ THE COORDINATOR, THE SETUP STEP OWNERS AND THE REASSIGN POOL ARE BELOW THE
--   LINE, DELIBERATELY. They are the general HR pool. A POSH complaint may be
--   ABOUT one of them, and "can reassign tickets" must never imply "can read the
--   complaint against me". Same reasoning, and the same narrow shape, as
--   fms_hr_may_see_grievances (NR-10).
--
-- ⚠ ESCALATION WIDENS THE AUDIENCE ONLY ONCE IT HAS FIRED. Being named as
--   Escalation Level 2 on a category does not let you read its tickets; being
--   escalated to does. That is why both arms test the *_at stamp as well.
-- ===========================================================================
create or replace function public.fms_help_can_see(p_ticket uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and exists (
       select 1
         from public.fms_help_tickets t
         join public.fms_help_categories c on c.id = t.category_id
        where t.id = p_ticket
          and (
            -- ── everyone below is allowed on a CONFIDENTIAL ticket too ──────
            public.is_admin(p_uid)
            or t.raised_by         = p_uid
            or t.assignee_id       = p_uid
            or t.info_from_user_id = p_uid
            or p_uid = any(c.owner_ids)
            or (t.escalated_l1_at is not null and p_uid = any(c.escalation_l1_ids))
            or (t.escalated_l2_at is not null and p_uid = any(c.escalation_l2_ids))
            -- ── the general HR pool: ORDINARY TICKETS ONLY ─────────────────
            or (not c.confidential and (
                 public.fms_help_is_coordinator(p_uid)
                 or public.fms_help_is_step_owner('acknowledge', p_uid)
                 or public.fms_help_is_step_owner('resolve', p_uid)
                 or public.fms_help_is_reassign_target(p_uid)
               ))
          )
     );
$$;

comment on function public.fms_help_can_see(uuid, uuid) is
  'May this user READ this ticket? Decision D4: a confidential ticket (grievance / POSH / disciplinary) is limited to the raiser, the category owners, a named assignee, whoever is being asked for information, anyone the ladder has ACTUALLY escalated to, and admins — never the coordinator, the Setup step owners or the reassign pool, because the complaint may be about them. Mirrored in store.tsx.';
grant execute on function public.fms_help_can_see(uuid, uuid) to authenticated;


-- ===========================================================================
-- 3. THE WRITE GATE — called by every step RPC.
-- ===========================================================================
create or replace function public.fms_help_can_act(p_step_key text, p_ticket uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     -- You cannot act on what you cannot read. This single line is what keeps
     -- the confidential rule from having to be restated (and drift) below.
     and public.fms_help_can_see(p_ticket, p_uid)
     and exists (
       select 1
         from public.fms_help_tickets t
         join public.fms_help_categories c on c.id = t.category_id
        where t.id = p_ticket
          and t.status not in ('closed', 'cancelled')
          and (
            public.is_admin(p_uid)
            or public.fms_help_is_coordinator(p_uid)
            -- Setup owners are ADDITIVE co-owners of the step they are named on.
            or public.fms_help_is_step_owner(p_step_key, p_uid)
            -- ── the row-owned arms ─────────────────────────────────────────
            -- The desk's two steps. A reassignment REPLACES the category owners;
            -- an escalation ADDS to them, because somebody escalated to has to be
            -- able to act or the notification is theatre.
            or (p_step_key in ('acknowledge', 'resolve') and (
                  (t.assignee_id is not null and t.assignee_id = p_uid)
                  or (t.assignee_id is null and p_uid = any(c.owner_ids))
                  or (t.escalated_l1_at is not null and p_uid = any(c.escalation_l1_ids))
                  or (t.escalated_l2_at is not null and p_uid = any(c.escalation_l2_ids))
               ))
            -- Whoever was asked answers. Not the raiser unless they were the one
            -- asked: the owner may tag an HOD instead.
            or (p_step_key = 'awaiting_info' and t.info_from_user_id = p_uid)
            -- Only the person whose question it was may say it is answered.
            -- ⚠ NOT the coordinator and NOT an owner: "resolved" is the desk's
            --   word and "satisfied" is the employee's, and letting the desk
            --   supply both is how a CSAT score stops meaning anything. Admins
            --   retain it above for support, and D9's auto-close is the other
            --   way out.
            or (p_step_key = 'confirm' and t.raised_by = p_uid)
          )
     );
$$;

comment on function public.fms_help_can_act(text, uuid, uuid) is
  'May this user act on this step of this ticket? Read gate first (so D4 is expressed once), then admin / coordinator / additive Setup owner / the row-owned arm for that step. `confirm` is the RAISER''s alone — the desk says "resolved", the employee says "satisfied". Mirrored in store.tsx canActOn and in mywork/items/help-desk.ts.';
grant execute on function public.fms_help_can_act(text, uuid, uuid) to authenticated;


-- ===========================================================================
-- 4. WHO OWNS THIS TICKET RIGHT NOW — the notification fan-out.
--
-- ⚠ NOT an authorization function. It answers "who should be told", which is
--   why it is separate from can_act and why it is safe for it to be broader.
-- ===========================================================================
create or replace function public.fms_help_owner_ids(p_ticket uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
              when t.assignee_id is not null then array[t.assignee_id]
              else c.owner_ids
            end
          || case when t.escalated_l1_at is not null then c.escalation_l1_ids else '{}'::uuid[] end
          || case when t.escalated_l2_at is not null then c.escalation_l2_ids else '{}'::uuid[] end
       from public.fms_help_tickets t
       join public.fms_help_categories c on c.id = t.category_id
      where t.id = p_ticket),
    '{}'::uuid[]
  );
$$;

comment on function public.fms_help_owner_ids(uuid) is
  'Who currently owns this ticket, for notifications: the named assignee if there is one, otherwise the category owners, plus every escalation level that has actually fired. Not an authorization function — see fms_help_can_act.';
grant execute on function public.fms_help_owner_ids(uuid) to authenticated;


-- ===========================================================================
-- 5. RLS
-- ===========================================================================
alter table public.fms_help_tickets enable row level security;

drop policy if exists fms_help_tickets_select on public.fms_help_tickets;
create policy fms_help_tickets_select on public.fms_help_tickets
  for select to authenticated
  using ((select public.fms_help_can_see(fms_help_tickets.id, auth.uid())));

-- Every write goes through a security-definer RPC. Admins retain a direct hand
-- for support; nobody else has one, so there is exactly one door and the
-- workflow rules cannot be walked around with a PATCH.
drop policy if exists fms_help_tickets_write_admin on public.fms_help_tickets;
create policy fms_help_tickets_write_admin on public.fms_help_tickets
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- 6. THE ACTIVITY READ POLICY, NARROWED.
--
-- HD-1 installed `using (true)` with a note saying this would land here. A
-- confidential ticket's timeline carries the complaint itself, so leaving it
-- open would make the narrow rule above pointless — the ticket would be hidden
-- and its story readable.
-- ===========================================================================
drop policy if exists fms_help_activity_select on public.fms_help_activity;
create policy fms_help_activity_select on public.fms_help_activity
  for select to authenticated
  using (
    entity_type <> 'ticket'
    or (select public.fms_help_can_see(fms_help_activity.entity_id, auth.uid()))
  );

comment on table public.fms_help_activity is
  'Help Desk audit trail AND conversation: one row per workflow event and one per comment (type = ''comment'', mentions and attachments in meta), rendered as a single timeline. Rows about a ticket are readable only by those who can read the ticket (HD-2).';


-- ===========================================================================
-- 7. RAISING ONE.
--
-- ⚠ WHO MAY RAISE. No owners on the `raise` step => anybody signed in, which is
--   what D2 (universal) asks for. Owners named => only them, plus admins and
--   coordinators. Same convention as Order to Dispatch's `sales_order` and
--   L&D's `need_raised`.
--
-- ⚠ ATTACHMENTS ARE UPLOADED FIRST AND PASSED AS PATHS. The storage policy
--   below is what actually authorises the file; this RPC only records it.
-- ===========================================================================
create or replace function public.fms_help_raise(
  p_category    uuid,
  p_subject     text,
  p_body        text default null,
  p_other_note  text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_mentions    uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

comment on function public.fms_help_raise(uuid, text, text, text, jsonb, uuid[]) is
  'Raise one Help Desk ticket. Numbers it HD-<fy>-NNNN, files it at the acknowledge step, and notifies the category owners plus any mention the raiser made that the recipient is actually allowed to see.';
grant execute on function public.fms_help_raise(uuid, text, text, text, jsonb, uuid[]) to authenticated;


-- ===========================================================================
-- 8. STORAGE — the rule the bucket has been waiting for since HD-1.
--
-- Path layout:  <ticket-id>/<slot>/<epoch>-<filename>,  slot in raise | resolution | comment
--
-- The first path segment IS the ticket id, so a file can always name its own
-- ticket and the rule is fms_help_can_see — not restated, REUSED. One rule, two
-- surfaces; they cannot drift apart.
--
-- ⚠ WRITING IS THE SAME RIGHT AS ACTING, NOT THE SAME RIGHT AS READING.
--   Everybody who can see a ticket could otherwise delete the payslip that
--   proves what it was about. A malformed path resolves to NULL and is refused
--   outright rather than raising.
-- ===========================================================================
create or replace function public.fms_help_doc_ticket(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;
grant execute on function public.fms_help_doc_ticket(text) to authenticated;

create or replace function public.fms_help_doc_slot(p_name text)
returns text
language sql
immutable
as $$
  select case when split_part(p_name, '/', 2) in ('raise', 'resolution', 'comment')
              then split_part(p_name, '/', 2) end;
$$;
grant execute on function public.fms_help_doc_slot(text) to authenticated;

create or replace function public.fms_help_can_add_doc(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.fms_help_doc_slot(p_name) is not null
     and public.fms_help_doc_ticket(p_name) is not null
     and (
       public.is_admin(p_uid)
       or exists (
            select 1 from public.fms_help_tickets t
             where t.id = public.fms_help_doc_ticket(p_name)
               and public.fms_help_can_see(t.id, p_uid)
               and (
                 -- The employee's own evidence, at raise time and in the thread.
                 (public.fms_help_doc_slot(p_name) in ('raise', 'comment') and t.raised_by = p_uid)
                 -- The desk's: the resolution's attachment, and its side of the thread.
                 or (public.fms_help_doc_slot(p_name) in ('resolution', 'comment')
                     and public.fms_help_can_act('resolve', t.id, p_uid))
                 -- Whoever was asked for information may attach their answer.
                 or (public.fms_help_doc_slot(p_name) = 'comment' and t.info_from_user_id = p_uid)
               )
          )
     );
$$;

comment on function public.fms_help_can_add_doc(text, uuid) is
  'Storage write rule for fms-help-docs, keyed on the SLOT: the employee files the ticket''s own evidence, the desk files the resolution, and either side files into the thread. A path naming no known slot, or no valid ticket id, is refused outright.';

drop policy if exists "fms help docs read"   on storage.objects;
drop policy if exists "fms help docs insert" on storage.objects;
drop policy if exists "fms help docs update" on storage.objects;
drop policy if exists "fms help docs delete" on storage.objects;

create policy "fms help docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-help-docs'
    and public.fms_help_can_see(public.fms_help_doc_ticket(name), (select auth.uid()))
  );

create policy "fms help docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-help-docs'
    and public.fms_help_can_add_doc(name, (select auth.uid()))
  );

-- As wide as insert: uploads use a stable path per slot, so a corrected file
-- OVERWRITES. A narrower rule would refuse the correction to the person whose
-- job it is, and would do it as "not found" — which reads like data loss.
create policy "fms help docs update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fms-help-docs' and public.fms_help_can_add_doc(name, (select auth.uid())))
  with check (bucket_id = 'fms-help-docs' and public.fms_help_can_add_doc(name, (select auth.uid())));

create policy "fms help docs delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fms-help-docs' and public.fms_help_can_add_doc(name, (select auth.uid())));


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_n int;
begin
  if to_regclass('public.fms_help_tickets') is null then
    raise exception 'HD-2: fms_help_tickets is missing';
  end if;

  -- The universal-module gate, again.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-2: a fms_help_* function gates on module_can_edit — help-desk is universal, so that is false for every non-admin';
  end if;

  -- Four storage policies, none scoped {public}.
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'fms help docs%';
  if v_n <> 4 then
    raise exception 'HD-2: expected 4 help storage policies, found %', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'fms help docs%' and roles::text like '%public%';
  if v_n > 0 then
    raise exception 'HD-2: % help storage policy/policies scoped to {public}', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename like 'fms\_help\_%' and roles::text like '%public%';
  if v_n > 0 then
    raise exception 'HD-2: % Help Desk policy/policies scoped to {public}', v_n;
  end if;

  -- A malformed path resolves to NULL rather than raising — the whole reason the
  -- uuid regex is there.
  if public.fms_help_doc_ticket('not-a-uuid/raise/x.pdf') is not null then
    raise exception 'HD-2: doc_ticket accepted a malformed path';
  end if;
  if public.fms_help_doc_slot('00000000-0000-0000-0000-000000000000/../etc/passwd') is not null then
    raise exception 'HD-2: doc_slot accepted an unknown slot';
  end if;
  if public.fms_help_can_add_doc('00000000-0000-0000-0000-000000000000/nonsense/x.pdf',
                                 (select id from auth.users limit 1)) then
    raise exception 'HD-2: can_add_doc accepted an unknown slot';
  end if;

  -- The activity policy no longer says `true`.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_help_activity'
       and policyname = 'fms_help_activity_select' and qual = 'true'
  ) then
    raise exception 'HD-2: the activity read policy is still HD-1''s placeholder';
  end if;
end $mig$;

commit;
