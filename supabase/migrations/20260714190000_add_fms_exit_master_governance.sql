-- ===========================================================================
-- HR Exit FMS — M8: MASTER GOVERNANCE (owners + "Request a new entry").
--
-- Clone of the HR Recruitment module's 20260713130000 (itself cloned from
-- Purchase's 20260630120000 + 20260713120000), adapted to fms_exit_*:
--   fms_exit_master_managers        — per-master-type owners (Setup → Master Owners)
--   fms_exit_master_requests        — the "Request new …" queue (+ a pending dup guard)
--   fms_exit_is_master_manager(text, uuid)
--   fms_exit_resolve_master_request(uuid, boolean, jsonb, text)
--
-- It also RELAXES the five masters' *_write policy from `is_admin` to
-- `is_admin OR fms_exit_is_master_manager('<type>')` — a drop/create of a POLICY
-- only. No table, column, constraint or row is mutated; everything else is new.
-- Reuses public.is_admin(uuid) and public.set_updated_at().
--
-- ---------------------------------------------------------------------------
-- OWNABLE vs REQUESTABLE — the one asymmetry, and it is deliberate:
--
--   * All FIVE masters are OWNABLE (fms_exit_master_managers), so a non-admin can
--     be made the owner of, say, the clearance checklist and edit it directly on
--     the Masters page.
--   * Only FOUR are REQUESTABLE (fms_exit_master_requests) — `clearance_item` is
--     excluded by its CHECK constraint. It backs NO DROPDOWN (it is seeded
--     server-side into fms_exit_clearance_checks at LWD confirmation), so there is
--     no "it's missing from this list" moment to serve. That exclusion also keeps
--     the resolve RPC honest: fms_exit_clearance_items is unique on a slug `key`
--     rather than `name` and has NO created_by column, so admitting it here would
--     drag server-side key generation, collision de-duping and an advisory lock
--     into the RPC for a path nobody would use.
--
--   The exclusion is LOAD-BEARING. Do not "fix" it by adding clearance_item to the
--   requests CHECK. Its owner edits it on the Masters page — which is exactly why
--   it is still on the MANAGERS CHECK.
-- ---------------------------------------------------------------------------
--
-- ⚠ THE `_write`-SUFFIX TRAP. The policy relaxation below iterates an EXPLICIT
--   (table, master_type) list, NOT `select tablename … where policyname like
--   '%_write'`. `fms_exit_config_write` and `fms_exit_step_owners_write` share that
--   suffix and MUST STAY ADMIN-ONLY: a loop over the suffix would silently hand the
--   step-owner table — i.e. the authorization backbone of the whole module, and the
--   input to the PII read gate (fms_exit_is_exit_staff) — to whoever happens to own
--   the Asset Types master. HR's file carries the same warning for the same reason.
--
-- Reversal:
--   drop function if exists public.fms_exit_resolve_master_request(uuid, boolean, jsonb, text);
--   -- restore the five write policies to `is_admin(auth.uid())` only, then:
--   drop function if exists public.fms_exit_is_master_manager(text, uuid);
--   drop table if exists public.fms_exit_master_requests;
--   drop table if exists public.fms_exit_master_managers;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_exit_master_managers — who may open each master. ALL FIVE types.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_exit_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in
                    ('reason','asset_type','document_type','payroll_head','clearance_item')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_exit_master_managers is
  'Assigns one or more owners per HR Exit master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → requests fall back to the admins. All five masters are ownable — including clearance_item, which is NOT requestable (see fms_exit_master_requests).';

create index if not exists fms_exit_master_managers_type_idx
  on public.fms_exit_master_managers (master_type);

drop trigger if exists trg_fms_exit_master_managers_updated on public.fms_exit_master_managers;
create trigger trg_fms_exit_master_managers_updated
  before update on public.fms_exit_master_managers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fms_exit_master_requests — the "Request new …" queue. FOUR types (see header).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_exit_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in
                       ('reason','asset_type','document_type','payroll_head')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_exit_master_requests is
  'New-master-entry requests raised by any user from the HR Exit forms. Approved (→ the real master row is created) or rejected by an admin / the master''s owner, via fms_exit_resolve_master_request. clearance_item is deliberately absent from the CHECK: it feeds no dropdown and is keyed on a slug, not a name.';

create index if not exists fms_exit_master_requests_status_idx
  on public.fms_exit_master_requests (status, master_type);

create index if not exists fms_exit_master_requests_requested_by_idx
  on public.fms_exit_master_requests (requested_by, status);

-- Dup guard (precedent: 20260713120000_add_fms_purchase_master_request_guard.sql:23):
-- at most one PENDING request per (type, name), case-insensitively — matching the
-- client's own check. Approved/rejected rows are exempt, so re-requesting after a
-- rejection still works. The client maps 23505 to "Someone has already requested
-- this — it's awaiting review."
-- (Exit masters have no parent scoping, so unlike Purchase there is no parent id
--  in this key.)
create unique index if not exists fms_exit_master_requests_pending_uniq
  on public.fms_exit_master_requests (
    master_type,
    lower(coalesce(proposed_payload->>'name', ''))
  )
  where status = 'pending';

drop trigger if exists trg_fms_exit_master_requests_updated on public.fms_exit_master_requests;
create trigger trg_fms_exit_master_requests_updated
  before update on public.fms_exit_master_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- HELPER — is this user an assigned owner of this master type?
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;

comment on function public.fms_exit_is_master_manager(text, uuid) is
  'True if p_uid is an assigned owner of the given HR Exit master type.';
grant execute on function public.fms_exit_is_master_manager(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RELAX the five masters' write policy: admin OR that master's owner.
-- (20260714120000:509 created them admin-only with the same `<table>_write` names.)
-- SELECT policies are untouched — already `using (true)` for authenticated.
--
-- ⚠ EXPLICIT (table, type) LIST — never `like '%_write'`. fms_exit_config and
--   fms_exit_step_owners share that suffix and must stay admin-only. See the header.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_exit_reasons',         'reason'),
      ('fms_exit_asset_types',     'asset_type'),
      ('fms_exit_document_types',  'document_type'),
      ('fms_exit_payroll_heads',   'payroll_head'),
      ('fms_exit_clearance_items', 'clearance_item')
    ) as t(tbl, mt)
  loop
    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_exit_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_exit_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mt);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — master_managers: read all; write admin-only (it is Setup config).
-- ---------------------------------------------------------------------------
alter table public.fms_exit_master_managers enable row level security;

drop policy if exists fms_exit_master_managers_select on public.fms_exit_master_managers;
create policy fms_exit_master_managers_select on public.fms_exit_master_managers
  for select to authenticated using (true);

drop policy if exists fms_exit_master_managers_write on public.fms_exit_master_managers;
create policy fms_exit_master_managers_write on public.fms_exit_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS — master_requests: read all; anyone raises their own; resolve via the RPC.
-- No client delete.
--
-- Read is deliberately open (unlike fms_exit_activity, which is exit-staff-only
-- because its notes carry employee names): these rows are dropdown fodder, and a
-- plain requester MUST be able to see their own request's status. The client's
-- duplicate guard also needs to see other people's pending requests to say
-- "already requested by X".
--
-- ⚠ THE INSERT POLICY IS WHY THE DEMO-PERSONA TRAP EXISTS. `requested_by =
--   auth.uid()` is checked against the JWT — which, in demo mode, is still the REAL
--   admin's, not the persona's. The store therefore stamps `realUserId`, never the
--   effective identity. Stamp the persona and this policy rejects the insert.
-- ---------------------------------------------------------------------------
alter table public.fms_exit_master_requests enable row level security;

drop policy if exists fms_exit_master_requests_select on public.fms_exit_master_requests;
create policy fms_exit_master_requests_select on public.fms_exit_master_requests
  for select to authenticated using (true);

drop policy if exists fms_exit_master_requests_insert on public.fms_exit_master_requests;
create policy fms_exit_master_requests_insert on public.fms_exit_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');

drop policy if exists fms_exit_master_requests_update on public.fms_exit_master_requests;
create policy fms_exit_master_requests_update on public.fms_exit_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_exit_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_exit_is_master_manager(master_type, auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC — approve (create the real master row) or reject a master request.
--
-- SECURITY DEFINER so it can insert into the target master whatever the caller's
-- own per-table policy says; it re-checks authz itself and locks the request row
-- so the same request cannot be resolved twice.
--
-- ⚠⚠ WIRE CONTRACT: the jsonb keys read below are produced VERBATIM by
--   frontend/src/apps/hr-exit/lib/masterFields.ts. Add a field there without adding
--   it here and IT IS SILENTLY DROPPED when the request is approved.
--
--   The keys, per type:
--     reason         → name
--     asset_type     → name
--     document_type  → name, requires_file   ('yes' | 'no')
--     payroll_head   → name, kind            ('addition' | 'deduction')
--
--   The two non-name keys arrive as the SELECT strings the form uses, not as SQL
--   literals — a form field is a string, and pretending otherwise is how a boolean
--   arrives as the text 'no' and casts to true. They are interpreted below, and an
--   absent key falls back to the master's own column default.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type     text;
  v_status   text;
  v_payload  jsonb;
  v_new_id   uuid;
  v_name     text;
  v_requires boolean;
  v_kind     text;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_exit_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin, or the assigned owner of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_exit_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  -- The approver's (optionally edited) payload wins; else the original.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    v_name := btrim(coalesce(v_payload->>'name', ''));
    if v_name = '' then
      raise exception 'A name is required to approve a master request';
    end if;

    begin
      if v_type = 'reason' then
        insert into public.fms_exit_reasons (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'asset_type' then
        insert into public.fms_exit_asset_types (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'document_type' then
        -- A letter with no PDF is a promise, not a document — so the column defaults
        -- to true, and an absent key keeps that default rather than clearing it.
        v_requires := case
          when jsonb_exists(v_payload, 'requires_file')
            then lower(coalesce(v_payload->>'requires_file','')) in ('yes','true','t','1')
          else true
        end;
        insert into public.fms_exit_document_types (name, requires_file, created_by)
        values (v_name, v_requires, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'payroll_head' then
        -- Anything that is not explicitly an addition is a deduction — the column's
        -- own default, and the safer side of the ledger to land on by accident.
        v_kind := case
          when lower(coalesce(v_payload->>'kind','')) = 'addition' then 'addition'
          else 'deduction'
        end;
        insert into public.fms_exit_payroll_heads (name, kind, created_by)
        values (v_name, v_kind, auth.uid())
        returning id into v_new_id;

      else
        -- clearance_item can never reach here: the CHECK on fms_exit_master_requests
        -- refuses it at insert time. This is the belt to that braces.
        raise exception 'Unknown master type %', v_type;
      end if;

    exception
      when unique_violation then
        -- These masters carry a CASE-SENSITIVE unique(name); the client's dup check
        -- is case-INSENSITIVE (i.e. stricter), so this only fires on a genuine race:
        -- the exact name was added straight into the master while this request sat
        -- pending, or the approver edited the name into an existing one. Nothing is
        -- half-done — the request stays pending and can still be rejected.
        raise exception '"%" is already in that master — reject this request instead of approving it.', v_name
          using errcode = '23505';
    end;

    update public.fms_exit_master_requests
       set status             = 'approved',
           reviewed_by        = auth.uid(),
           review_note        = p_note,
           resolved_master_id = v_new_id,
           proposed_payload   = v_payload
     where id = p_request_id;
  else
    -- A rejection with no reason is a black hole: the requester sees "rejected" and
    -- has nothing to act on. The client demands one too; this is the real gate.
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'A reason is required to reject a master request';
    end if;

    update public.fms_exit_master_requests
       set status      = 'rejected',
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

comment on function public.fms_exit_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real HR Exit master row) or reject a master request. Admin or the master type''s owner only. A rejection requires a reason.';

grant execute on function public.fms_exit_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;
