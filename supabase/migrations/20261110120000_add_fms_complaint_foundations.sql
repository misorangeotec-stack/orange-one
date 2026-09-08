-- ===========================================================================
-- COMPLAINT (RM/FG) FMS — FOUNDATIONS (Phase 1).
--
-- The THIRTEENTH FMS module. Like fms_travel_* / fms_ocpi_* / fms_exit_* /
-- fms_hr_* / fms_asset_* / fms_dispatch_* / fms_production_* / fms_sampling_* /
-- fms_import_* / fms_supplies_* / fms_purchase_*, it mirrors the config backbone
-- into its OWN tables rather than reusing a shared one: modules must stay
-- independently droppable, and a shared step_owners table would collide on
-- step_key.
--
-- WHAT THE COMPLAINT MODULE IS
--   ONE entity — a COMPLAINT — from the LOT that failed to the resolution the
--   party accepted:
--
--     raise -> acknowledge -> investigation -> capa -> resolution
--       -> confirmation -> close
--
--   It runs FROM EITHER SIDE. A FINISHED GOOD complaint arrives from a customer
--   against a sales invoice; a RAW MATERIAL one goes out to a vendor against a
--   purchase invoice. Same seven steps, same people, same queues.
--
--   ⚠ RM/FG IS ONE SHARED BLOCK OF COLUMNS, NOT TWO. One party_id, one
--     invoice_no, one lot_no; `complaint_type` decides the LABELS and which side
--     of mst_parties the picker offers. The business describes it exactly that
--     way — the source sheet's words for the raw-material arm are "Purchase
--     invoice. And all the heading of sales and customer, change", which is a
--     heading change, not a different fact. mst_parties is already one table
--     holding both concepts, because in Tally both are a ledger.
--
-- WHAT THIS MIGRATION CREATES
--   fms_complaint_step_owners     — one row per workflow step_key -> owners
--   fms_complaint_config          — key/value singletons (jsonb)
--   fms_complaint_counters + next_seq — document numbering
--   fms_complaint_fy_code         — April-start financial-year code
--   fms_complaint_activity        — append-only audit trail
--   fms_complaint_notifications   — per-user bell feed
--   fms_complaint_announce        — the single event fan-out
--   storage bucket fms-complaint-docs + 4 baseline policies
--
-- The complaint itself, its documents and every step RPC are later migrations.
--
-- ⚠ NUMBERING IS FY-SCOPED: CMP-2627-0001, minted on INSERT. There is no draft
--   status in this module — one intake form, submitted straight in — so no
--   abandoned draft can burn a number. Hyphens, four digits, counter scope
--   'complaint:<fy>' — the house convention every other module follows (PR-,
--   PO-, MRF-, EXIT-, SMP-, PRD-, SO-, ASM-, TRV-).
--
-- ⚠ EVERY WRITE PREDICATE IS GATED ON module_can_edit() FROM DAY ONE.
--   20260923120000 had to retrofit that gate onto 35 functions across ten
--   modules by copying each body to <name>__ungated. fms_complaint_is_step_owner
--   therefore carries the gate in its own body. Note what is NOT gated:
--   fms_complaint_step_owner_ids, which answers "who should be told", not "who
--   may act" — gating it would silently empty the recipient list for a step
--   whose owners hold a view-only grant.
--
-- ⚠ RLS policies wrap every helper call in a scalar sub-select —
--   `using ((select public.is_admin(auth.uid())))`. Called inline, Postgres
--   evaluates the function ONCE PER ROW; wrapped, it becomes a one-shot
--   InitPlan (472ms -> 15ms in 20260730130000; 1,620ms -> ~5ms in
--   20260924120000).
--
-- ⚠ EVERY POLICY IS SCOPED `to authenticated`. `anon` holds full table grants
--   (the Supabase default); that scope is the only thing keeping anonymous
--   callers out.
--
-- ⚠ fms_complaint_can_act IS NOT HERE. It must read the complaint row to find
--   that complaint's own per-step assignees (the investigator named at
--   acknowledge, the CAPA owner named at investigation, and so on), so it ships
--   with fms_complaint_requests in phase 5 — exactly as OCPI and Travel put
--   can_act in their entity migrations, not in foundations.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.module_can_edit(uuid,text) / public.designations.
--
-- Reversal (reverse order):
--   drop policy if exists "fms complaint docs read"   on storage.objects;
--   drop policy if exists "fms complaint docs insert" on storage.objects;
--   drop policy if exists "fms complaint docs update" on storage.objects;
--   drop policy if exists "fms complaint docs delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-complaint-docs';
--   drop function if exists public.fms_complaint_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_complaint_step_owner_ids(text);
--   drop function if exists public.fms_complaint_is_coordinator(uuid);
--   drop function if exists public.fms_complaint_is_step_owner(text,uuid);
--   drop function if exists public.fms_complaint_next_seq(text);
--   drop function if exists public.fms_complaint_fy_code(date);
--   drop table if exists public.fms_complaint_notifications, public.fms_complaint_activity,
--                        public.fms_complaint_counters, public.fms_complaint_config,
--                        public.fms_complaint_step_owners;
-- ===========================================================================

begin;

-- ===========================================================================
-- fms_complaint_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see
-- frontend/src/apps/complaint/lib/steps.ts.
--
-- Authorization comes SOLELY from employee_ids. department_ids and
-- designation_id are UI filters for CHOOSING people, nothing more. (No FMS
-- authorization predicate in the portal reads designation_id — verified across
-- all twelve existing modules. Do not start here.)
--
-- ⚠ THE ORIGIN STEP `raise` IS DELIBERATELY ALLOWED IN THIS TABLE, and there is
--   no CHECK barring it. It is how an admin restricts WHO MAY RAISE a complaint
--   — a real requirement here, because a complaint names a customer and a
--   supplier and not everyone should be able to open one. Semantics:
--     no owners on `raise` => any user with an edit grant may raise;
--     owners set          => only them, plus admins and coordinators.
--   An empty list must mean "anyone", never "nobody", or a freshly installed
--   module would be unusable until somebody remembered to configure it.
--
--   (Sampling and Sanctions bar their origin step with a CHECK. This module
--   does not, and the difference is intentional rather than an oversight.)
-- ===========================================================================
create table if not exists public.fms_complaint_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_complaint_step_owners is
  'Owners per Complaint workflow step (step_key). employee_ids are the notified/authorized owners; department_ids and designation_id are UI filters only. The origin step `raise` is allowed here and restricts who may open a complaint; no row means anyone with an edit grant may.';

drop trigger if exists trg_fms_complaint_step_owners_updated on public.fms_complaint_step_owners;
create trigger trg_fms_complaint_step_owners_updated
  before update on public.fms_complaint_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_step_owners enable row level security;

drop policy if exists fms_complaint_step_owners_select on public.fms_complaint_step_owners;
create policy fms_complaint_step_owners_select on public.fms_complaint_step_owners
  for select to authenticated using (true);

drop policy if exists fms_complaint_step_owners_write on public.fms_complaint_step_owners;
create policy fms_complaint_step_owners_write on public.fms_complaint_step_owners
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- fms_complaint_config — key/value singletons.
--
-- Keys added by later phases / the UI: 'step_sla', 'process_coordinators'.
-- Neither is seeded: the frontend merges a stored map over its code defaults
-- (frontend/src/apps/complaint/lib/sla.ts), so an absent row means "use the
-- defaults" and an unknown step falls back rather than disappearing.
-- ===========================================================================
create table if not exists public.fms_complaint_config (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.fms_complaint_config is
  'Complaint module settings as jsonb singletons: step_sla, process_coordinators.';

drop trigger if exists trg_fms_complaint_config_updated on public.fms_complaint_config;
create trigger trg_fms_complaint_config_updated
  before update on public.fms_complaint_config
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_config enable row level security;

drop policy if exists fms_complaint_config_select on public.fms_complaint_config;
create policy fms_complaint_config_select on public.fms_complaint_config
  for select to authenticated using (true);

drop policy if exists fms_complaint_config_write on public.fms_complaint_config;
create policy fms_complaint_config_write on public.fms_complaint_config
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- NUMBERING — 'complaint:<fy>' -> CMP-2627-0001.
--
-- FY-scoped because a complaint register is read and reported per financial
-- year. The counter key CONTAINS the FY, so the series restarts at 0001 each
-- April with no seeding and no reset job.
-- ===========================================================================
create table if not exists public.fms_complaint_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_complaint_counters is
  'Per-scope document-number sequences (complaint:<fy>). Mutated only via fms_complaint_next_seq().';

alter table public.fms_complaint_counters enable row level security;

drop policy if exists fms_complaint_counters_select_admin on public.fms_complaint_counters;
create policy fms_complaint_counters_select_admin on public.fms_complaint_counters
  for select to authenticated using ((select public.is_admin(auth.uid())));

create or replace function public.fms_complaint_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_complaint_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_complaint_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_complaint_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope. A new scope string starts at 1, which is how FY restarts fall out with no seeding.';
grant execute on function public.fms_complaint_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 -> '2627'.
create or replace function public.fms_complaint_fy_code(p_d date)
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
grant execute on function public.fms_complaint_fy_code(date) to authenticated;


-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
--
-- ⚠ THE module_can_edit GATE IS PART OF THE BODY, not a later wrapper — see the
--   header. This is what keeps a view-only grant from acting while still
--   letting it read every screen.
create or replace function public.fms_complaint_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'complaint')
     and exists (
       select 1 from public.fms_complaint_step_owners o
       where o.step_key = p_step_key
         and p_uid = any(o.employee_ids)
     );
$$;

comment on function public.fms_complaint_is_step_owner(text, uuid) is
  'Does this user own this Complaint step AND hold an edit-level grant on the module? Gated on module_can_edit in its own body, so no __ungated split is ever needed here.';
grant execute on function public.fms_complaint_is_step_owner(text, uuid) to authenticated;

-- May this user RAISE a complaint?
--
-- ⚠ AN EMPTY OWNER LIST MEANS ANYONE, NOT NOBODY. See the step_owners comment:
--   a module whose raise step nobody has configured must still be usable on the
--   day it is switched on.
create or replace function public.fms_complaint_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'complaint')
     and (
       public.is_admin(p_uid)
       or not exists (
         select 1 from public.fms_complaint_step_owners o
         where o.step_key = 'raise' and cardinality(o.employee_ids) > 0
       )
       or exists (
         select 1 from public.fms_complaint_step_owners o
         where o.step_key = 'raise' and p_uid = any(o.employee_ids)
       )
     );
$$;

comment on function public.fms_complaint_can_raise(uuid) is
  'May this user open a complaint? Requires an edit grant, and — if and only if the `raise` step has owners configured — membership of that list. No owners configured means anyone with the grant.';
grant execute on function public.fms_complaint_can_raise(uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_complaint_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_complaint_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_complaint_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
--
-- ⚠ NOT GATED on module_can_edit, deliberately. This answers "who should be
--   told", not "who may act". Gating it would silently empty the recipient list
--   for a step whose owners happen to hold a view grant.
create or replace function public.fms_complaint_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_complaint_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_complaint_step_owner_ids(text) to authenticated;


-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_complaint_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.fms_complaint_activity is
  'Append-only audit trail for Complaints. Written ONLY inside security-definer RPCs, via fms_complaint_announce() — never inserted from the browser.';

create index if not exists fms_complaint_activity_entity_idx  on public.fms_complaint_activity (entity_type, entity_id);
create index if not exists fms_complaint_activity_created_idx on public.fms_complaint_activity (created_at);

alter table public.fms_complaint_activity enable row level security;

drop policy if exists fms_complaint_activity_select on public.fms_complaint_activity;
create policy fms_complaint_activity_select on public.fms_complaint_activity
  for select to authenticated using (true);

drop policy if exists fms_complaint_activity_write_admin on public.fms_complaint_activity;
create policy fms_complaint_activity_write_admin on public.fms_complaint_activity
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

create table if not exists public.fms_complaint_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  type        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  text        text not null,
  actor_id    uuid references auth.users on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.fms_complaint_notifications is
  'Per-user bell feed for Complaints. Best-effort: never the source of truth for state.';

create index if not exists fms_complaint_notifications_user_idx    on public.fms_complaint_notifications (user_id, read_at);
create index if not exists fms_complaint_notifications_created_idx on public.fms_complaint_notifications (created_at);

alter table public.fms_complaint_notifications enable row level security;

drop policy if exists fms_complaint_notifications_select_own on public.fms_complaint_notifications;
create policy fms_complaint_notifications_select_own on public.fms_complaint_notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists fms_complaint_notifications_update_own on public.fms_complaint_notifications;
create policy fms_complaint_notifications_update_own on public.fms_complaint_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- One call = one activity row + a notification fan-out.
-- Phase 9 will `create or replace` this with the same body plus a gated
-- email_outbox enqueue, exactly as every other module does.
create or replace function public.fms_complaint_announce(
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
  insert into public.fms_complaint_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_complaint_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;

comment on function public.fms_complaint_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Complaint event: an activity row always, plus one notification per recipient. Pass an EMPTY recipient list for a correction — it belongs on the audit trail without paging anyone.';
grant execute on function public.fms_complaint_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;


-- ===========================================================================
-- STORAGE — private bucket for the evidence photographs, the lab report, the
-- CAPA document and the credit note. Object path is
--   <complaint-id>/<slot>/<epoch>-<filename>
-- with slot ∈ evidence | lab_report | capa_doc | resolution_doc | other.
--
-- ⚠ THE FIRST PATH SEGMENT IS LOAD-BEARING. Phase 7 replaces the four policies
--   below with ones that derive the owning complaint from that segment and reuse
--   fms_complaint_can_see_request — the same hardening
--   20260821120000_fms_dispatch_doc_storage_policies.sql applied after
--   discovering that a bucket-id-only rule let any authenticated user mint a
--   signed URL for any invoice. The baseline below exists only so this phase has
--   a working bucket; DO NOT SHIP AN UPLOAD PATH ON IT.
--
--   That matters more here than in most modules: a complaint photograph carries
--   a named customer's grievance and a named vendor's failure.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-complaint-docs', 'fms-complaint-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms complaint docs read"   on storage.objects;
drop policy if exists "fms complaint docs insert" on storage.objects;
drop policy if exists "fms complaint docs update" on storage.objects;
drop policy if exists "fms complaint docs delete" on storage.objects;

create policy "fms complaint docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-complaint-docs');
create policy "fms complaint docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-complaint-docs');
create policy "fms complaint docs update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fms-complaint-docs') with check (bucket_id = 'fms-complaint-docs');
create policy "fms complaint docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-complaint-docs');


-- ===========================================================================
-- ASSERTIONS — this migration fails rather than silently widening access.
-- ===========================================================================
do $mig$
declare
  v_public int;
  v_tables text[] := array[
    'fms_complaint_step_owners', 'fms_complaint_config', 'fms_complaint_counters',
    'fms_complaint_activity', 'fms_complaint_notifications'
  ];
  t text;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename = any(v_tables)
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Complaint: % policy/policies are scoped to {public}; anon holds table grants, so that is an open door', v_public;
  end if;

  foreach t in array v_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'Complaint: RLS is not enabled on %', t;
    end if;
  end loop;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms complaint docs %') <> 4 then
    raise exception 'Complaint: expected exactly 4 fms-complaint-docs storage policies';
  end if;

  if public.fms_complaint_fy_code(date '2026-08-01') <> '2627' then
    raise exception 'Complaint: fy_code(2026-08-01) should be 2627, got %', public.fms_complaint_fy_code(date '2026-08-01');
  end if;
  if public.fms_complaint_fy_code(date '2026-03-31') <> '2526' then
    raise exception 'Complaint: fy_code(2026-03-31) should be 2526, got %', public.fms_complaint_fy_code(date '2026-03-31');
  end if;
end $mig$;

commit;
