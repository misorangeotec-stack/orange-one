-- ===========================================================================
-- OCPI FMS — the setup masters, and who is allowed to grow them.
--
--   fms_ocpi_head_types / _ink_types / _dryer_types   three vocabularies
--   fms_ocpi_master_managers                          who owns each master
--   fms_ocpi_master_requests                          "please add X"
--   fms_ocpi_is_master_manager(type, uid)
--   fms_ocpi_resolve_master_request(req, approve, payload, note)
--
-- ⚠ THESE THREE LISTS WERE HARDCODED IN THE BROWSER. `HEAD_TYPES`, `INK_TYPES`
--   and `DRYER_TYPES` sat as `as const` arrays in lib/fieldSpec.ts, transcribed
--   off the Microsoft form. They are not structural vocabularies like "advance
--   or credit" — they are a list of HARDWARE, and hardware arrives. Adding a
--   Ricoh head meant a code change, a build and a deploy, which is how a
--   salesperson ends up typing it into a free-text box instead and the same head
--   appears in the data as four different strings.
--
-- ⚠ TWO KINDS OF MASTER HERE, AND THEY BEHAVE DIFFERENTLY ON PURPOSE.
--     machine     — the deal stores machine_id, a real foreign key. A request
--                   must be APPROVED before a quotation can point at it, exactly
--                   as an item request works in General Purchase.
--     head/ink/   — the deal stores the TEXT (head_type text, ink_type text …).
--     dryer         So a salesperson may still type a value that is not in the
--                   list and carry on; the request only makes the LIST better
--                   for the next person. Blocking a quotation until somebody
--                   approves a vocabulary entry would be a worse product than
--                   the free-text box this replaces, and the column shape does
--                   not require it.
--   Say that out loud, because a reader coming from the other FMS modules will
--   expect requests to gate the form, and here three of the four do not.
--
-- ⚠ A MACHINE APPROVED THIS WAY LANDS WITH has_template = false. It can carry a
--   quotation immediately and is refused at the order-confirmation step BY NAME
--   (fms_ocpi_submit_oc). That is the honest state: somebody has to transcribe
--   the deck before a contract can be printed, and pretending otherwise would
--   produce a blank order confirmation.
--
-- ⚠ THE MASTERS' WRITE POLICIES ARE RELAXED TO "admin OR that master's owner",
--   naming each table EXPLICITLY. Never a `like '%_write'` sweep: fms_ocpi_config
--   and fms_ocpi_step_owners share the suffix and must stay admin-only — they are
--   permissions, not data.
--
-- Purely ADDITIVE.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_resolve_master_request(uuid, boolean, jsonb, text);
--   drop function if exists public.fms_ocpi_is_master_manager(text, uuid);
--   drop table if exists public.fms_ocpi_master_requests;
--   drop table if exists public.fms_ocpi_master_managers;
--   drop table if exists public.fms_ocpi_dryer_types, public.fms_ocpi_ink_types,
--                        public.fms_ocpi_head_types;
--   -- and re-apply 20260929120100 to restore the admin-only machines policy
-- ===========================================================================

begin;

/* --------------------------------------------------------- the vocabularies */

create table if not exists public.fms_ocpi_head_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fms_ocpi_ink_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fms_ocpi_dryer_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_ocpi_head_types is
  'Print-head models offered on a quotation. Seeded from the six the Microsoft form listed; the deal stores the NAME, not this id.';
comment on table public.fms_ocpi_ink_types is
  'Ink types offered on a quotation. The deal stores the NAME, not this id.';
comment on table public.fms_ocpi_dryer_types is
  'Dryer options offered on a quotation. "Not Applicable" is a real answer and is a row here, because the branching reads it.';

do $$
declare t text;
begin
  foreach t in array array['fms_ocpi_head_types','fms_ocpi_ink_types','fms_ocpi_dryer_types'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Seeded VERBATIM from lib/fieldSpec.ts, which took them from the live form.
-- `on conflict do nothing` so re-running this cannot duplicate or renumber.
insert into public.fms_ocpi_head_types (name, sort_order) values
  ('300DPI - KJ4B', 10),
  ('600 DPI - KJ4B', 20),
  ('EPSON PRINTHEAD I 3200', 30),
  ('KATANA 600 DPI - HANGLORY', 40),
  ('RICOH GEN 6 HEAD', 50),
  ('RC 600 DPI - Hanglory', 60)
on conflict (name) do nothing;

insert into public.fms_ocpi_ink_types (name, sort_order) values
  ('Sublimation Ink', 10), ('Reactive Ink', 20), ('Pigment', 30)
on conflict (name) do nothing;

insert into public.fms_ocpi_dryer_types (name, sort_order) values
  ('Chinese', 10), ('Indian', 20), ('Not Applicable', 30)
on conflict (name) do nothing;

/* --------------------------------------------------- ownership and requests */

create table if not exists public.fms_ocpi_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in ('machine','head_type','ink_type','dryer_type')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_ocpi_master_managers is
  'Who owns each OCPI master: they may edit it directly and resolve requests against it. With NOBODY assigned, only admins can — which is the safe default, not a gap.';

create table if not exists public.fms_ocpi_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in ('machine','head_type','ink_type','dryer_type')),
  proposed_payload   jsonb not null default '{}'::jsonb,
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_ocpi_master_requests is
  'New-master-entry requests raised from the OCPI forms. Approved (the real master row is created) or rejected by an admin or the master''s owner, via fms_ocpi_resolve_master_request.';

create index if not exists fms_ocpi_master_requests_status_idx
  on public.fms_ocpi_master_requests (status, master_type);
create index if not exists fms_ocpi_master_requests_requested_by_idx
  on public.fms_ocpi_master_requests (requested_by, status);

-- At most one PENDING request per (type, name), case-insensitively: three people
-- hitting the same missing head type should queue one job, not three.
create unique index if not exists fms_ocpi_master_requests_pending_uniq
  on public.fms_ocpi_master_requests (master_type, lower(coalesce(proposed_payload->>'name', '')))
  where status = 'pending';

drop trigger if exists trg_fms_ocpi_master_requests_updated on public.fms_ocpi_master_requests;
create trigger trg_fms_ocpi_master_requests_updated
  before update on public.fms_ocpi_master_requests
  for each row execute function public.set_updated_at();

/* ----------------------------------------------------------------- helper -- */

create or replace function public.fms_ocpi_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.fms_ocpi_master_managers m
     where m.master_type = p_master_type
       and m.manager_user_id = p_uid
  );
$fn$;

comment on function public.fms_ocpi_is_master_manager(text, uuid) is
  'Does this user own this OCPI master? Ownership grants direct edit and the right to resolve requests against it.';
grant execute on function public.fms_ocpi_is_master_manager(text, uuid) to authenticated;

/* ---------------------------------------------------------------- policies -- */

alter table public.fms_ocpi_head_types      enable row level security;
alter table public.fms_ocpi_ink_types       enable row level security;
alter table public.fms_ocpi_dryer_types     enable row level security;
alter table public.fms_ocpi_master_managers enable row level security;
alter table public.fms_ocpi_master_requests enable row level security;

-- ⚠ EXPLICIT (table, type) PAIRS — see the header. A suffix sweep would catch
--   fms_ocpi_config_write and fms_ocpi_step_owners_write, which are permissions.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_ocpi_machines',    'machine'),
      ('fms_ocpi_head_types',  'head_type'),
      ('fms_ocpi_ink_types',   'ink_type'),
      ('fms_ocpi_dryer_types', 'dryer_type')
    ) as t(tbl, mt)
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (true)', r.tbl);

    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using ((select public.is_admin((select auth.uid())))
                or (select public.fms_ocpi_is_master_manager(%2$L, (select auth.uid()))))
         with check ((select public.is_admin((select auth.uid())))
                or (select public.fms_ocpi_is_master_manager(%2$L, (select auth.uid()))))',
      r.tbl, r.mt);
  end loop;
end $$;

-- The machine SECTIONS follow their machine's owner, not a type of their own:
-- a template's boilerplate is part of the machine, and a second ownership list
-- for it would be a second thing to keep in step.
drop policy if exists fms_ocpi_machine_sections_write on public.fms_ocpi_machine_sections;
create policy fms_ocpi_machine_sections_write on public.fms_ocpi_machine_sections
  for all to authenticated
  using ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))))
  with check ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))));

drop policy if exists fms_ocpi_master_managers_select on public.fms_ocpi_master_managers;
create policy fms_ocpi_master_managers_select on public.fms_ocpi_master_managers
  for select to authenticated using (true);

drop policy if exists fms_ocpi_master_managers_write on public.fms_ocpi_master_managers;
create policy fms_ocpi_master_managers_write on public.fms_ocpi_master_managers
  for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_ocpi_master_requests_select on public.fms_ocpi_master_requests;
create policy fms_ocpi_master_requests_select on public.fms_ocpi_master_requests
  for select to authenticated using (true);

-- ⚠ `requested_by = auth.uid()` is checked against the JWT, so a request can
--   never be filed in somebody else's name.
drop policy if exists fms_ocpi_master_requests_insert on public.fms_ocpi_master_requests;
create policy fms_ocpi_master_requests_insert on public.fms_ocpi_master_requests
  for insert to authenticated
  with check (requested_by = (select auth.uid())
              and status = 'pending'
              and (select public.module_can_edit((select auth.uid()), 'ocpi')));

-- Resolution goes through the RPC; this exists so an owner can correct a note.
drop policy if exists fms_ocpi_master_requests_update on public.fms_ocpi_master_requests;
create policy fms_ocpi_master_requests_update on public.fms_ocpi_master_requests
  for update to authenticated
  using ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager(master_type, (select auth.uid()))))
  with check ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager(master_type, (select auth.uid()))));

/* --------------------------------------------------------------------- RPC -- */

/**
 * Approve (creating the real master row) or reject a master request.
 *
 * ⚠⚠ WIRE CONTRACT. The jsonb keys read below are produced VERBATIM by
 *   frontend/src/apps/ocpi/lib/masterFields.ts. Add a field there without adding
 *   it here and IT IS SILENTLY DROPPED on approval.
 *
 *     machine     → name  (lands with has_template = false — see the header)
 *     head_type   → name
 *     ink_type    → name
 *     dryer_type  → name
 */
create or replace function public.fms_ocpi_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_name    text;
  v_new_id  uuid;
  v_to      uuid[];
  v_asker   uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select master_type, status, proposed_payload, requested_by
    into v_type, v_status, v_payload, v_asker
    from public.fms_ocpi_master_requests
   where id = p_request_id
   for update;

  if v_type is null then raise exception 'Master request not found'; end if;
  if v_status <> 'pending' then
    raise exception 'That request has already been %', v_status;
  end if;
  if not (public.is_admin(v_uid) or public.fms_ocpi_is_master_manager(v_type, v_uid)) then
    raise exception 'You do not own the % master, so you cannot resolve this', replace(v_type, '_', ' ');
  end if;

  -- The reviewer may correct the payload before approving — a typed head model
  -- with the manufacturer misspelled should be fixed here, not bounced back.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    v_name := btrim(coalesce(v_payload->>'name', ''));
    if v_name = '' then
      raise exception 'A name is required to approve a master request';
    end if;

    if v_type = 'machine' then
      insert into public.fms_ocpi_machines (name, has_template, active, sort_order)
      values (v_name, false, true,
              coalesce((select max(sort_order) + 10 from public.fms_ocpi_machines), 10))
      on conflict (name) do update set active = true
      returning id into v_new_id;
    elsif v_type = 'head_type' then
      insert into public.fms_ocpi_head_types (name, sort_order)
      values (v_name, coalesce((select max(sort_order) + 10 from public.fms_ocpi_head_types), 10))
      on conflict (name) do update set active = true
      returning id into v_new_id;
    elsif v_type = 'ink_type' then
      insert into public.fms_ocpi_ink_types (name, sort_order)
      values (v_name, coalesce((select max(sort_order) + 10 from public.fms_ocpi_ink_types), 10))
      on conflict (name) do update set active = true
      returning id into v_new_id;
    elsif v_type = 'dryer_type' then
      insert into public.fms_ocpi_dryer_types (name, sort_order)
      values (v_name, coalesce((select max(sort_order) + 10 from public.fms_ocpi_dryer_types), 10))
      on conflict (name) do update set active = true
      returning id into v_new_id;
    else
      raise exception 'Unknown master type: %', v_type;
    end if;
  end if;

  update public.fms_ocpi_master_requests
     set status             = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by        = v_uid,
         review_note        = nullif(btrim(coalesce(p_note, '')), ''),
         resolved_master_id = v_new_id,
         proposed_payload   = v_payload
   where id = p_request_id;

  v_to := case when v_asker is null or v_asker = v_uid then '{}'::uuid[] else array[v_asker] end;
  perform public.fms_ocpi_announce(
    'master_request', p_request_id,
    case when p_approve then 'master_approved' else 'master_rejected' end,
    'Your ' || replace(v_type, '_', ' ') || ' request "' || coalesce(v_payload->>'name', 'entry') || '" was '
      || case when p_approve then 'approved' else 'rejected' end
      || case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else ': ' || btrim(p_note) end,
    v_to,
    jsonb_build_object('master_type', v_type, 'approved', p_approve));

  return v_new_id;
end $fn$;

comment on function public.fms_ocpi_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (creating the real master row) or reject an OCPI master request. Admins and that master''s owners only. See the WIRE CONTRACT note for the payload keys.';
grant execute on function public.fms_ocpi_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

/* -------------------------------------------------------------- assertions -- */

do $$
begin
  if (select count(*) from public.fms_ocpi_head_types) < 6
     or (select count(*) from public.fms_ocpi_ink_types) < 3
     or (select count(*) from public.fms_ocpi_dryer_types) < 3 then
    raise exception 'the three OCPI vocabularies did not seed';
  end if;

  -- config and step_owners must NOT have been caught by the write-policy loop.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('fms_ocpi_config', 'fms_ocpi_step_owners')
       and qual like '%is_master_manager%') then
    raise exception 'a permissions table was relaxed to master owners';
  end if;
end $$;

commit;
