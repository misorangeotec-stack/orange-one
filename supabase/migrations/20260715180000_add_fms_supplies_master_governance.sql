-- ===========================================================================
-- OFFICE SUPPLIES PURCHASE FMS — MASTER GOVERNANCE (owners + "Request a new entry").
--
-- Clone of fms_exit_* 20260714190000 (itself from Purchase's 20260630120000 +
-- 20260713120000), adapted to fms_supplies_*:
--   fms_supplies_master_managers        — per-master-type owners (Setup → Master Owners)
--   fms_supplies_master_requests        — the "Request new …" queue (+ a pending dup guard)
--   fms_supplies_is_master_manager(text, uuid)
--   fms_supplies_resolve_master_request(uuid, boolean, jsonb, text)
--
-- It also RELAXES the masters' *_write policy from `is_admin` to
-- `is_admin OR fms_supplies_is_master_manager('<type>')` — a POLICY drop/create only.
-- Reuses public.is_admin(uuid) and public.set_updated_at().
--
-- ── OWNABLE vs REQUESTABLE ──────────────────────────────────────────────────
--   * All FIVE masters are OWNABLE (company, department, category, item, service_type).
--   * Only TWO are REQUESTABLE — `item` and `service_type` (the ones staff pick from a
--     dropdown and might find missing). company / department / category are structural
--     (they carry a routing flag / an HOD), so an owner edits them on the Masters page.
--
-- ⚠ THE `_write`-SUFFIX TRAP. The relaxation iterates an EXPLICIT (table, type) list,
--   NOT `like '%_write'`: fms_supplies_config_write and fms_supplies_step_owners_write
--   share that suffix and MUST STAY ADMIN-ONLY.
--
-- Reversal:
--   drop function if exists public.fms_supplies_resolve_master_request(uuid, boolean, jsonb, text);
--   -- restore the five write policies to is_admin only, then:
--   drop function if exists public.fms_supplies_is_master_manager(text, uuid);
--   drop table if exists public.fms_supplies_master_requests;
--   drop table if exists public.fms_supplies_master_managers;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_supplies_master_managers — who may open each master. ALL FIVE types.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_supplies_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in
                    ('company','department','category','item','service_type')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_supplies_master_managers is
  'Assigns one or more owners per Office Supplies master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → requests fall back to the admins.';

create index if not exists fms_supplies_master_managers_type_idx
  on public.fms_supplies_master_managers (master_type);

drop trigger if exists trg_fms_supplies_master_managers_updated on public.fms_supplies_master_managers;
create trigger trg_fms_supplies_master_managers_updated
  before update on public.fms_supplies_master_managers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fms_supplies_master_requests — the "Request new …" queue. TWO types (item, service_type).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_supplies_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in ('item','service_type')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_supplies_master_requests is
  'New-master-entry requests raised from the Office Supplies forms. Approved (→ the real master row is created) or rejected by an admin / the master''s owner, via fms_supplies_resolve_master_request.';

create index if not exists fms_supplies_master_requests_status_idx
  on public.fms_supplies_master_requests (status, master_type);
create index if not exists fms_supplies_master_requests_requested_by_idx
  on public.fms_supplies_master_requests (requested_by, status);

-- Dup guard: at most one PENDING request per (type, parent, name), case-insensitively.
-- An item is scoped by its category_id; a service_type has no parent (→ '').
create unique index if not exists fms_supplies_master_requests_pending_uniq
  on public.fms_supplies_master_requests (
    master_type,
    coalesce(proposed_payload->>'category_id', ''),
    lower(coalesce(proposed_payload->>'name', ''))
  )
  where status = 'pending';

drop trigger if exists trg_fms_supplies_master_requests_updated on public.fms_supplies_master_requests;
create trigger trg_fms_supplies_master_requests_updated
  before update on public.fms_supplies_master_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- HELPER — is this user an assigned owner of this master type?
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_supplies_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_supplies_is_master_manager(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RELAX the masters' write policy: admin OR that master's owner.
-- ⚠ EXPLICIT (table, type) LIST — never `like '%_write'`. config + step_owners
--   share the suffix and must stay admin-only.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_supplies_companies',     'company'),
      ('fms_supplies_departments',   'department'),
      ('fms_supplies_categories',    'category'),
      ('fms_supplies_items',         'item'),
      ('fms_supplies_service_types', 'service_type')
    ) as t(tbl, mt)
  loop
    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_supplies_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_supplies_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mt);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — master_managers: read all; write admin-only (Setup config).
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_master_managers enable row level security;

drop policy if exists fms_supplies_master_managers_select on public.fms_supplies_master_managers;
create policy fms_supplies_master_managers_select on public.fms_supplies_master_managers
  for select to authenticated using (true);

drop policy if exists fms_supplies_master_managers_write on public.fms_supplies_master_managers;
create policy fms_supplies_master_managers_write on public.fms_supplies_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS — master_requests: read all; anyone raises their own; resolve via the RPC.
-- ⚠ THE INSERT POLICY IS WHY THE DEMO-PERSONA TRAP EXISTS elsewhere: requested_by
--   = auth.uid() is checked against the JWT. The store stamps the REAL session id.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_master_requests enable row level security;

drop policy if exists fms_supplies_master_requests_select on public.fms_supplies_master_requests;
create policy fms_supplies_master_requests_select on public.fms_supplies_master_requests
  for select to authenticated using (true);

drop policy if exists fms_supplies_master_requests_insert on public.fms_supplies_master_requests;
create policy fms_supplies_master_requests_insert on public.fms_supplies_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');

drop policy if exists fms_supplies_master_requests_update on public.fms_supplies_master_requests;
create policy fms_supplies_master_requests_update on public.fms_supplies_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_supplies_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_supplies_is_master_manager(master_type, auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC — approve (create the real master row) or reject a master request.
--
-- ⚠⚠ WIRE CONTRACT: the jsonb keys read below are produced VERBATIM by
--   frontend/src/apps/office-supplies/lib/masterFields.ts. Add a field there without
--   adding it here and IT IS SILENTLY DROPPED on approval.
--
--   The keys, per type:
--     item          → name, category_id
--     service_type  → name
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_resolve_master_request(
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
  v_cat     uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_supplies_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  if not (public.is_admin(auth.uid()) or public.fms_supplies_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    v_name := btrim(coalesce(v_payload->>'name', ''));
    if v_name = '' then
      raise exception 'A name is required to approve a master request';
    end if;

    begin
      if v_type = 'item' then
        v_cat := nullif(v_payload->>'category_id','')::uuid;
        if v_cat is null then
          raise exception 'A category is required to approve an item request';
        end if;
        insert into public.fms_supplies_items (category_id, name, created_by)
        values (v_cat, v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'service_type' then
        insert into public.fms_supplies_service_types (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      else
        raise exception 'Unknown master type %', v_type;
      end if;

    exception
      when unique_violation then
        raise exception '"%" is already in that master — reject this request instead of approving it.', v_name
          using errcode = '23505';
    end;

    update public.fms_supplies_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'A reason is required to reject a master request';
    end if;
    update public.fms_supplies_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

comment on function public.fms_supplies_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real Office Supplies master row) or reject a master request. Admin or the master type''s owner only. A rejection requires a reason.';

grant execute on function public.fms_supplies_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;
