-- ===========================================================================
-- HR Recruitment FMS — MASTER GOVERNANCE (owners + "Request a new entry").
--
-- Mirrors the Purchase module (20260630120000 + 20260713120000), adapted to HR:
--   fms_hr_master_managers  — per-master-type owners (Setup → Master Owners)
--   fms_hr_master_requests  — the "Request new …" queue (+ a pending dup guard)
--   fms_hr_is_master_manager(text, uuid)
--   fms_hr_resolve_master_request(uuid, boolean, jsonb, text)
--
-- It also RELAXES the five masters' *_write policy from `is_admin` to
-- `is_admin OR fms_hr_is_master_manager('<type>')` — a drop/create of a POLICY
-- only. No table, column, constraint or row is mutated; everything else is new.
-- Reuses public.is_admin(uuid) and public.set_updated_at().
--
-- OWNABLE vs REQUESTABLE — the one asymmetry, and it is deliberate:
--   * All FIVE masters are OWNABLE (fms_hr_master_managers), so a non-admin can
--     be made the owner of, say, the onboarding checklist and edit it directly.
--   * Only FOUR are REQUESTABLE (fms_hr_master_requests) — the onboarding
--     checklist is excluded by its CHECK constraint. It is not on any dropdown
--     (it is seeded server-side into fms_hr_onboarding_checks), so there is no
--     "it's missing from this list" moment to serve. That exclusion also keeps
--     the resolve RPC honest: fms_hr_onboarding_items is unique on a slug `key`
--     rather than `name` and has NO created_by column, so admitting it here
--     would drag in server-side key generation, collision de-duping and an
--     advisory lock for a path nobody would use.
--
-- Reversal:
--   drop function if exists public.fms_hr_resolve_master_request(uuid, boolean, jsonb, text);
--   -- restore the five write policies to `is_admin(auth.uid())` only, then:
--   drop function if exists public.fms_hr_is_master_manager(text, uuid);
--   drop table if exists public.fms_hr_master_requests;
--   drop table if exists public.fms_hr_master_managers;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_hr_master_managers — who may open each master. All five types.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in
                    ('job_platform','job_type','location','disqualification_reason','onboarding_item')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_hr_master_managers is
  'Assigns one or more owners per HR master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → requests fall back to the admins.';

create index if not exists fms_hr_master_managers_type_idx
  on public.fms_hr_master_managers (master_type);

drop trigger if exists trg_fms_hr_master_managers_updated on public.fms_hr_master_managers;
create trigger trg_fms_hr_master_managers_updated
  before update on public.fms_hr_master_managers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fms_hr_master_requests — the "Request new …" queue. FOUR types (see header).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in
                       ('job_platform','job_type','location','disqualification_reason')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_hr_master_requests is
  'New-master-entry requests raised by any user from the HR forms. Approved (→ the real master row is created) or rejected by an admin / the master''s owner, via fms_hr_resolve_master_request.';

create index if not exists fms_hr_master_requests_status_idx
  on public.fms_hr_master_requests (status, master_type);

create index if not exists fms_hr_master_requests_requested_by_idx
  on public.fms_hr_master_requests (requested_by, status);

-- Dup guard: at most one PENDING request per (type, name), case-insensitively —
-- matching the client's own check. Approved/rejected rows are exempt, so
-- re-requesting after a rejection still works. The client maps 23505 to
-- "Someone has already requested this — it's awaiting review."
-- (HR masters have no parent scoping, so unlike Purchase there is no parent id
--  in this key.)
create unique index if not exists fms_hr_master_requests_pending_uniq
  on public.fms_hr_master_requests (
    master_type,
    lower(coalesce(proposed_payload->>'name', ''))
  )
  where status = 'pending';

drop trigger if exists trg_fms_hr_master_requests_updated on public.fms_hr_master_requests;
create trigger trg_fms_hr_master_requests_updated
  before update on public.fms_hr_master_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- HELPER — is this user an assigned owner of this master type?
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;

comment on function public.fms_hr_is_master_manager(text, uuid) is
  'True if p_uid is an assigned owner of the given HR master type.';
grant execute on function public.fms_hr_is_master_manager(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RELAX the five masters' write policy: admin OR that master's owner.
-- (20260712120000 created them admin-only with the same `<table>_write` names.)
-- SELECT policies are untouched — already `using (true)` for authenticated.
-- Iterating an explicit (table, type) list, NOT `like '%_write'` — fms_hr_config
-- and fms_hr_step_owners share that suffix and must stay admin-only.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_hr_job_platforms',            'job_platform'),
      ('fms_hr_job_types',                'job_type'),
      ('fms_hr_locations',                'location'),
      ('fms_hr_disqualification_reasons', 'disqualification_reason'),
      ('fms_hr_onboarding_items',         'onboarding_item')
    ) as t(tbl, mt)
  loop
    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mt);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — master_managers: read all; write admin-only (it is Setup config).
-- ---------------------------------------------------------------------------
alter table public.fms_hr_master_managers enable row level security;

drop policy if exists fms_hr_master_managers_select on public.fms_hr_master_managers;
create policy fms_hr_master_managers_select on public.fms_hr_master_managers
  for select to authenticated using (true);

drop policy if exists fms_hr_master_managers_write on public.fms_hr_master_managers;
create policy fms_hr_master_managers_write on public.fms_hr_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS — master_requests: read all; anyone raises their own; resolve via the RPC.
-- No client delete.
--
-- Read is deliberately open (unlike fms_hr_activity, which is owner/coordinator-
-- only because its notes carry candidate names): these rows are dropdown fodder,
-- and a plain requester MUST be able to see their own request's status. The
-- client's duplicate guard also needs to see other people's pending requests to
-- say "already requested by X".
-- ---------------------------------------------------------------------------
alter table public.fms_hr_master_requests enable row level security;

drop policy if exists fms_hr_master_requests_select on public.fms_hr_master_requests;
create policy fms_hr_master_requests_select on public.fms_hr_master_requests
  for select to authenticated using (true);

drop policy if exists fms_hr_master_requests_insert on public.fms_hr_master_requests;
create policy fms_hr_master_requests_insert on public.fms_hr_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');

drop policy if exists fms_hr_master_requests_update on public.fms_hr_master_requests;
create policy fms_hr_master_requests_update on public.fms_hr_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(master_type, auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC — approve (create the real master row) or reject a master request.
--
-- SECURITY DEFINER so it can insert into the target master whatever the caller's
-- own per-table policy says; it re-checks authz itself and locks the request row
-- so the same request cannot be resolved twice.
--
-- ⚠ WIRE CONTRACT: the jsonb keys read below are produced verbatim by
-- frontend/src/apps/hr-recruitment/lib/masterFields.ts. Add a field there without
-- adding it here and it is silently dropped when the request is approved.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_resolve_master_request(
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
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
  v_name    text;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_hr_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin, or the assigned owner of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(v_type, auth.uid())) then
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
      if v_type = 'job_platform' then
        insert into public.fms_hr_job_platforms (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'job_type' then
        insert into public.fms_hr_job_types (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'location' then
        insert into public.fms_hr_locations (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'disqualification_reason' then
        insert into public.fms_hr_disqualification_reasons (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      else
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

    update public.fms_hr_master_requests
       set status             = 'approved',
           reviewed_by        = auth.uid(),
           review_note        = p_note,
           resolved_master_id = v_new_id,
           proposed_payload   = v_payload
     where id = p_request_id;
  else
    update public.fms_hr_master_requests
       set status      = 'rejected',
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

comment on function public.fms_hr_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real HR master row) or reject a master request. Admin or the master type''s owner only.';

grant execute on function public.fms_hr_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;
