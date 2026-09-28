-- ===========================================================================
-- HELP DESK FMS — FOUNDATIONS (HD-1, part 1 of 2).
--
-- The FIFTEENTH FMS module. Like fms_ld_* / fms_travel_* / fms_complaint_* /
-- fms_ocpi_* / fms_exit_* / fms_hr_* and the rest, it mirrors the config
-- backbone into its OWN tables rather than reusing a shared one: modules must
-- stay independently droppable, and a shared step_owners table would collide on
-- step_key.
--
-- WHAT HELP DESK IS
--   ONE entity — a TICKET — from the question to the closure:
--
--     raise -> acknowledge -> [awaiting_info] -> resolve -> confirm -> closed
--                                   ^                |          |
--                                   +----------------+          |
--                                                               v
--                                              not satisfied -> reopen (escalates)
--
--   Any employee raises a ticket under a CATEGORY. The category decides three
--   things nobody has to type: who owns it, how long they have, and who it
--   escalates to. The owner acknowledges, may ask the employee (or anyone) for
--   more information, resolves with a note and an attachment, and the employee
--   confirms or reopens.
--
--   Source: files/FMS- Help Desk.pdf (the flow, the 11-step process table and
--   the 27 ticket categories), the client's walkthrough on 27-09-2026 and the
--   six decisions taken on 28-09-2026. Full plan + the decision record:
--   HELP-DESK.md at the repo root.
--
-- ⚠⚠ THIS MODULE IS UNIVERSAL, AND THAT CHANGES HOW THE GATE IS WRITTEN.
--   Decision D2: every signed-in person may raise and track a ticket, with no
--   app_access row — the same model as Learning & Development and the KRA / KPI
--   Scorecard.
--
--   public.module_level() knows NOTHING about apps/universal.ts. It is
--
--       is_admin -> 'edit', else app_access.access_level, else 'none'
--
--   so for a universal module module_can_edit(uid,'help-desk') is FALSE FOR
--   EVERY NON-ADMIN. The house gate shape used by Travel Desk, Complaint and
--   Purchase —
--
--       select public.module_can_edit(p_uid, '<app>') and exists (…owner test…)
--
--   would therefore lock all 70 people out of a module the launcher is showing
--   them, and NOTHING would look wrong: the screens render, the buttons are
--   there, and every RPC refuses. fms_ld_is_step_owner() carries no
--   module_can_edit arm for exactly this reason, and neither does anything
--   here. Do not "restore" it.
--
--   TWO CONSEQUENCES, stated so they are not rediscovered:
--     • View-only cannot be enforced for this module — there are no grant rows
--       to hold at 'view'. help-desk goes in NO_VIEW_ONLY_APP_IDS
--       (apps/registry.tsx), as Announcements does.
--     • NR-14's "do not notify view-only owners" filter CANNOT be applied to
--       fms_help_step_owner_ids(): filtering recipients through module_can_edit
--       would return the empty set and silently notify nobody.
--
-- ⚠ EVERY POLICY IS SCOPED `to authenticated`. `anon` holds full table grants
--   (the Supabase default); that scope is the only thing keeping anonymous
--   callers out.
--
-- ⚠ is_admin() IS WRAPPED IN A SCALAR SUBQUERY IN EVERY POLICY. Unwrapped,
--   Postgres evaluates it once per row; wrapped, it becomes a one-shot InitPlan.
--   Same rewrite as 20260730130000_speed_up_task_rls.sql (472ms -> 15ms).
--
-- ⚠ fms_help_can_act / fms_help_can_see ARE NOT HERE. Both must read the ticket
--   row (for its category, its assignee and its escalation stamps), so they ship
--   with fms_help_tickets in HD-2 — exactly as OCPI put can_act in its deals
--   migration rather than in foundations.
--
-- ⚠ THE STORAGE BUCKET IS CREATED WITH NO POLICIES, ON PURPOSE. Travel Desk
--   shipped four placeholder policies whose whole condition was
--   `bucket_id = '…'` — i.e. no question about who was asking — and had to fix
--   it later (20261005121600). With RLS on and no policy, the bucket fails
--   CLOSED: nobody can read or write until HD-2 adds the real rule built on
--   fms_help_can_see. A confidential grievance attachment must never be one
--   signed URL away from the whole company.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.designations.
-- Rollback: 20261217120000_hd1_help_desk_foundations_rollback.sql
-- ===========================================================================

-- ── 0. Checks first, OUTSIDE any lock ───────────────────────────────────────
-- A slow assertion placed after the DDL holds the lock it took while it runs.
do $pre$
begin
  if to_regclass('public.fms_help_step_owners') is not null then
    raise exception 'HD-1: fms_help_step_owners already exists — this migration has been applied';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'HD-1: public.set_updated_at() is missing';
  end if;
  if to_regprocedure('public.is_admin(uuid)') is null then
    raise exception 'HD-1: public.is_admin(uuid) is missing';
  end if;
  if to_regclass('public.designations') is null then
    raise exception 'HD-1: public.designations is missing';
  end if;
end $pre$;

begin;

-- ===========================================================================
-- fms_help_step_owners — owners assigned to each workflow step.
--
-- step_key is a code-defined constant — see
-- frontend/src/apps/help-desk/lib/steps.ts.
--
-- Authorization comes SOLELY from employee_ids. department_ids and
-- designation_id are UI filters for CHOOSING people, nothing more. (No FMS
-- authorization predicate in this portal reads designation_id — verified across
-- all fourteen existing modules. Do not start here.)
--
-- ⚠ FOUR OF THE FIVE STEPS ARE ROW-OWNED AND ARE NOT REALLY CONFIGURED HERE.
--   `acknowledge` and `resolve` route to the TICKET'S CATEGORY owner_ids;
--   `awaiting_info` routes to the person the owner tagged; `confirm` routes to
--   the raiser. Rows set here are ADDITIVE CO-OWNERS — the way HR gets "the same
--   permissions as the process owner" without being named on every category.
--   HD-2's fms_help_can_act expresses that, following hr-exit's fall-through:
--   its can_act deliberately does NOT early-return on the row-owner arm, and
--   hr-recruitment's equivalent (which does) is named there as the bug avoided.
--
-- There is NO CHECK barring the origin step (`raise`) from this table.
-- Semantics: no owners on `raise` => ANY signed-in user may raise a ticket,
-- which is what D2 asks for; owners set => only them, plus admins and
-- coordinators. Same convention as Order to Dispatch's `sales_order` and L&D's
-- `need_raised`.
-- ===========================================================================
create table if not exists public.fms_help_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_help_step_owners is
  'Owners per Help Desk workflow step (step_key). employee_ids are the notified/authorized owners; department_ids and designation_id are UI filters only. Four of the five steps are ROW-owned (off the ticket category, the tagged person, or the raiser) and rows here act as additive co-owners. With no owners on `raise`, every signed-in user may raise a ticket.';

drop trigger if exists trg_fms_help_step_owners_updated on public.fms_help_step_owners;
create trigger trg_fms_help_step_owners_updated
  before update on public.fms_help_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_help_step_owners enable row level security;

drop policy if exists fms_help_step_owners_select on public.fms_help_step_owners;
create policy fms_help_step_owners_select on public.fms_help_step_owners
  for select to authenticated using (true);

drop policy if exists fms_help_step_owners_write on public.fms_help_step_owners;
create policy fms_help_step_owners_write on public.fms_help_step_owners
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- fms_help_config — key/value singletons.
--
-- Keys installed here:
--   'policy'               — the numbers that are not per-category.
--   'process_coordinators' — { "user_ids": [ … ] }.
--   'reassign_pool'        — { "department_ids": [ … ], "user_ids": [ … ] }.
--                            department_ids is a Setup picker filter and grants
--                            nothing; only user_ids authorise.
--   'step_sla'             — installed EMPTY. The defaults live in code
--                            (lib/sla.ts) and an admin overrides them in
--                            Settings -> Due dates. An unset or unknown step
--                            falls back to its default, so behaviour never
--                            silently disappears.
--
-- ⚠ THE RESOLVE STEP'S SLA IS NOT IN 'step_sla' AND CANNOT BE. Every other
--   module's SLA is one number per step for the whole module; here the resolve
--   clock is the TICKET'S OWN CATEGORY TAT (fms_help_categories.tat_days). The
--   Due Dates screen therefore renders `resolve` as "set per category" and links
--   to the Masters screen rather than offering a number that would be ignored.
-- ===========================================================================
create table if not exists public.fms_help_config (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.fms_help_config is
  'Help Desk module settings as jsonb singletons: policy, process_coordinators, reassign_pool, step_sla. The resolve step''s SLA is NOT here — it is per category, on fms_help_categories.tat_days.';

drop trigger if exists trg_fms_help_config_updated on public.fms_help_config;
create trigger trg_fms_help_config_updated
  before update on public.fms_help_config
  for each row execute function public.set_updated_at();

alter table public.fms_help_config enable row level security;

drop policy if exists fms_help_config_select on public.fms_help_config;
create policy fms_help_config_select on public.fms_help_config
  for select to authenticated using (true);

drop policy if exists fms_help_config_write on public.fms_help_config;
create policy fms_help_config_write on public.fms_help_config
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

insert into public.fms_help_config (key, value) values
  ('policy', jsonb_build_object(
      -- The PDF's headline KPI: "First Response Time (FRT): <= 30 minutes".
      -- REPORTED, never a due date — see the note on hours in lib/sla.ts and in
      -- shared/lib/stepSla.ts. The acknowledge step's DUE DATE is same-working-day;
      -- this number is what the First Response report measures against.
      'frt_target_minutes',           30,
      -- D9. The employee has the confirm step's SLA to accept a resolution; after
      -- that the ticket closes itself with closed_reason = 'auto_closed', which the
      -- SLA report counts SEPARATELY from 'confirmed'. A resolution nobody accepted
      -- must never be reported as a satisfied employee.
      'auto_close_enabled',           true,
      -- D3 / the escalation ladder. Where a reopen goes when the category names a
      -- role but no person — "Management", "Admin Vendor", "ICC Committee". Null
      -- until an admin sets it in Setup; until then the escalation is RECORDED on
      -- the ticket and notifies nobody, which the screen says plainly rather than
      -- pretending an escalation path exists. (PF-14: four modules shipped with no
      -- owners and every approval in them went nowhere.)
      'escalation_fallback_user_id',  null,
      -- D8. A breached TAT colours the cell, sorts the queue and counts as a miss.
      -- It notifies nobody. Kept as a switch so the decision is visible and
      -- reversible in Setup rather than compiled in.
      'notify_on_tat_breach',         false
    )),
  ('process_coordinators', jsonb_build_object('user_ids', '[]'::jsonb)),
  ('reassign_pool',        jsonb_build_object('department_ids', '[]'::jsonb, 'user_ids', '[]'::jsonb)),
  ('step_sla',             '{}'::jsonb)
on conflict (key) do nothing;


-- ===========================================================================
-- NUMBERING — 'ticket:<fy>' -> HD-2627-0001.
--
-- FY-scoped because the MIS is reported per financial year. The counter key
-- CONTAINS the FY, so the series restarts at 0001 each April with no seeding
-- and no reset job.
-- ===========================================================================
create table if not exists public.fms_help_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_help_counters is
  'Per-scope document-number sequences (ticket:<fy>). Mutated only via fms_help_next_seq().';

alter table public.fms_help_counters enable row level security;

drop policy if exists fms_help_counters_select_admin on public.fms_help_counters;
create policy fms_help_counters_select_admin on public.fms_help_counters
  for select to authenticated using ((select public.is_admin(auth.uid())));

create or replace function public.fms_help_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_help_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_help_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_help_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope. A new scope string starts at 1, which is how FY restarts fall out with no seeding.';
grant execute on function public.fms_help_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 -> '2627'.
create or replace function public.fms_help_fy_code(p_d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_d) >= 4
      then to_char(p_d, 'YY') || to_char((p_d + interval '1 year'), 'YY')
    else to_char((p_d - interval '1 year'), 'YY') || to_char(p_d, 'YY')
  end;
$$;
grant execute on function public.fms_help_fy_code(date) to authenticated;


-- ===========================================================================
-- AUTHZ HELPERS
--
-- ⚠ NONE OF THESE CARRIES A module_can_edit GATE. Read the ⚠⚠ block at the head
--   of this file before adding one — it would lock out every non-admin.
-- ===========================================================================

-- Owner check for one workflow step (the Setup-configured, additive arm).
create or replace function public.fms_help_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and exists (
       select 1 from public.fms_help_step_owners o
       where o.step_key = p_step_key
         and p_uid = any(o.employee_ids)
     );
$$;

comment on function public.fms_help_is_step_owner(text, uuid) is
  'Is this user a Setup-configured owner of this Help Desk step? Deliberately NOT gated on module_can_edit: help-desk is universal, so that gate is false for every non-admin. The per-ticket owner arms live in fms_help_can_act (HD-2).';
grant execute on function public.fms_help_is_step_owner(text, uuid) to authenticated;

-- Admins and the named process coordinators oversee every step.
create or replace function public.fms_help_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_help_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_help_is_coordinator(uuid) to authenticated;

-- May this user be HANDED a Help Desk step? Reads ONLY reassign_pool -> user_ids;
-- department_ids in that same row is a Setup picker filter and grants nothing.
--
-- The list is the whole point of the feature: without it the only safe picker
-- would be "every profile", which is why the first version of Reassign was
-- removed from the Import module (20260806123000). Do not widen it.
create or replace function public.fms_help_is_reassign_target(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and exists (
       select 1 from public.fms_help_config c
       where c.key = 'reassign_pool'
         and p_uid::text in (
           select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
         )
     );
$$;
grant execute on function public.fms_help_is_reassign_target(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
--
-- ⚠ NOT filtered through module_can_edit, unlike fms_hr_step_owner_ids (NR-14).
--   That filter removes owners holding the module at view-only; on a UNIVERSAL
--   module it would return the empty set and silently notify nobody. The
--   underlying problem does not arise here, because there are no view grants to
--   hold.
create or replace function public.fms_help_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_help_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_help_step_owner_ids(text) to authenticated;


-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
--
-- ⚠ THE ACTIVITY TABLE ALSO CARRIES THE CONVERSATION. The client asked for a
--   thread with @mentions and attachments, "like the remarks in task
--   management". The house answer is an activity row of type 'comment' with the
--   mentions and files in `meta`, NOT a comments table of its own
--   (fms_hr_post_comment and fms_travel_post_comment both do this). The trail is
--   already "who did what, with a note", so a comment is one more kind of entry
--   — and the detail page renders process and conversation as ONE timeline,
--   which is the only way "resolved" and "the employee says the date is still
--   wrong" mean anything next to each other.
--
-- ⚠ READS ARE WIDE OPEN HERE AND ARE NARROWED IN HD-2. A confidential ticket's
--   activity must not be readable by the whole company, and the rule needs the
--   ticket row. HD-2 replaces the select policy with one built on
--   fms_help_can_see. Until then the only rows in this table are the ones HD-1's
--   own seeds write, which is none.
-- ===========================================================================
create table if not exists public.fms_help_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.fms_help_activity is
  'Help Desk audit trail AND conversation: one row per workflow event and one per comment (type = ''comment'', with mentions and attachments in meta). Rendered as a single timeline. The select policy is widened here and NARROWED in HD-2, once fms_help_can_see exists.';

create index if not exists fms_help_activity_entity_idx  on public.fms_help_activity (entity_type, entity_id);
create index if not exists fms_help_activity_created_idx on public.fms_help_activity (created_at);

alter table public.fms_help_activity enable row level security;

drop policy if exists fms_help_activity_select on public.fms_help_activity;
create policy fms_help_activity_select on public.fms_help_activity
  for select to authenticated using (true);

-- Written only through fms_help_announce() (security definer) and, for
-- corrections, by an admin.
drop policy if exists fms_help_activity_write_admin on public.fms_help_activity;
create policy fms_help_activity_write_admin on public.fms_help_activity
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


create table if not exists public.fms_help_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  text        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.fms_help_notifications is
  'One row per person told about one Help Desk event. A person reads and dismisses only their own.';

create index if not exists fms_help_notifications_user_idx    on public.fms_help_notifications (user_id, read_at);
create index if not exists fms_help_notifications_created_idx on public.fms_help_notifications (created_at);

alter table public.fms_help_notifications enable row level security;

drop policy if exists fms_help_notifications_select_own on public.fms_help_notifications;
create policy fms_help_notifications_select_own on public.fms_help_notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists fms_help_notifications_update_own on public.fms_help_notifications;
create policy fms_help_notifications_update_own on public.fms_help_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- One event: an activity row always, plus one notification per recipient.
--
-- ⚠ PASS AN EMPTY RECIPIENT LIST FOR A CORRECTION. It belongs on the audit trail
--   without paging anybody.
create or replace function public.fms_help_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
begin
  insert into public.fms_help_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      -- Never notify the person who just did the thing, and never twice.
      if u is null or u = any(seen) or u = v_actor then continue; end if;
      seen := seen || u;
      insert into public.fms_help_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;

comment on function public.fms_help_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Help Desk event: an activity row always, plus one notification per recipient. Skips the actor and de-duplicates. Pass an EMPTY recipient list for a correction.';
grant execute on function public.fms_help_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;


-- ===========================================================================
-- ATTACHMENTS — the bucket, and DELIBERATELY NO POLICIES YET.
--
-- Path layout (HD-2 depends on it):
--     <ticket-id>/<slot>/<epoch>-<filename>
--     slot in raise | resolution | comment
--
-- With RLS on storage.objects and no policy naming this bucket, every read and
-- write fails CLOSED. That is the correct state until HD-2 can express the real
-- rule on top of fms_help_can_see — a Help Desk attachment may be a payslip, a
-- medical bill or a POSH complaint, and a placeholder policy of
-- `bucket_id = 'fms-help-docs'` would put all of them one signed URL away from
-- the whole company. Travel Desk shipped exactly that and had to fix it later.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-help-docs', 'fms-help-docs', false)
on conflict (id) do nothing;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_n int;
begin
  if to_regclass('public.fms_help_step_owners') is null
     or to_regclass('public.fms_help_config') is null
     or to_regclass('public.fms_help_counters') is null
     or to_regclass('public.fms_help_activity') is null
     or to_regclass('public.fms_help_notifications') is null then
    raise exception 'HD-1: a foundation table is missing';
  end if;

  select count(*) into v_n from public.fms_help_config
   where key in ('policy', 'process_coordinators', 'reassign_pool', 'step_sla');
  if v_n <> 4 then
    raise exception 'HD-1: expected 4 config keys, found %', v_n;
  end if;

  -- The numbering works and restarts per FY.
  if public.fms_help_fy_code(date '2026-08-01') <> '2627' then
    raise exception 'HD-1: fy_code(2026-08-01) = %, expected 2627', public.fms_help_fy_code(date '2026-08-01');
  end if;
  if public.fms_help_fy_code(date '2026-02-01') <> '2526' then
    raise exception 'HD-1: fy_code(2026-02-01) = %, expected 2526', public.fms_help_fy_code(date '2026-02-01');
  end if;

  -- The bucket is PRIVATE and carries no policy yet (see the header).
  if not exists (select 1 from storage.buckets where id = 'fms-help-docs' and public = false) then
    raise exception 'HD-1: fms-help-docs is missing or is public';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and qual like '%fms-help-docs%';
  if v_n <> 0 then
    raise exception 'HD-1: fms-help-docs already has % storage policy/policies; the real rule lands in HD-2', v_n;
  end if;

  -- No policy anywhere may be scoped {public} — anon holds full table grants.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename like 'fms\_help\_%' and roles::text like '%public%';
  if v_n > 0 then
    raise exception 'HD-1: % Help Desk policy/policies scoped to {public}', v_n;
  end if;

  -- The universal-module gate: no helper may carry a module_can_edit arm, or
  -- every non-admin is locked out. Proved, not trusted.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-1: a fms_help_* function gates on module_can_edit — help-desk is universal, so that is false for every non-admin';
  end if;
end $mig$;

commit;
