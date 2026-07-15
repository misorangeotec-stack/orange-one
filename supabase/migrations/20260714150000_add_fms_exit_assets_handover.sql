-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — ASSET RETURN + WORK HANDOVER & KT
-- (Phase 4, M4).
--
-- Tables:
--   fms_exit_assets   — one row per asset issued to the leaver, SNAPSHOTTED from
--                       the active fms_exit_asset_types when the LWD is confirmed
--   fms_exit_handover — 1:1 with the case: who took the work over, KT, evidence
--
-- Columns added to fms_exit_cases (additive, nullable) — the two SIGNATURES:
--   assets_hod_signed_at / _by / _remarks
--   assets_hr_signed_at  / _by / _remarks
--   (assets_returned_at and handover_completed_at already exist, from M2.)
--
-- Replaced (create or replace — behaviour PRESERVED, one block added):
--   fms_exit_confirm_lwd — now ALSO seeds fms_exit_assets, idempotently, in the
--                          same transaction as the clearance checklist. The M3
--                          header says this is coming.
--
-- RPCs:
--   fms_exit_update_asset      — status / returned-on / condition / recovery / file
--   fms_exit_sign_assets       — HOD signs, then HR — HR's signature COMPLETES the step
--   fms_exit_record_handover   — who is taking the work over, KT, notes, file
--   fms_exit_confirm_handover  — manager confirms, then HR — HR's COMPLETES the step
--   fms_exit_autotick_clearance— INTERNAL (not granted): the de-duplication engine
--
-- ---------------------------------------------------------------------------
-- ⚠ WHY THESE ARE STEPS **AND** CLEARANCE ROWS — DO NOT "SIMPLIFY" IT AWAY.
--
--   The operational sheet gives Asset Return and Handover their OWN planned /
--   actual / status / **HOD Sign** / **HR Sign** / **work-handed-over-to** columns.
--   That is a signature workflow, and a generic checklist row cannot carry it: a
--   tick has one actor, and these have two.
--
--   But the workflow tab ALSO lists them as clearance duties of Admin, IT and the
--   Reporting Manager. Both are real, and both are true at once.
--
--   They are de-duplicated by `satisfied_by_step` (seeded in M1, snapshotted onto
--   every check by M3):
--
--       admin_assets → asset_return      it_assets → asset_return
--       manager_kt   → handover
--
--   Completing the STEP auto-ticks the matching clearance ROWS. Clear the column in
--   Masters and the row becomes independent again — i.e. Admin and IT sign twice.
--   That is a CONFIG choice, not a code change.
-- ---------------------------------------------------------------------------
-- ⚠ THE AUTO-TICK BYPASSES `requires_file`, AND MUST.
--
--   The evidence for those rows is the SIGN-OFF ITSELF, recorded on the step (with
--   its own photo, its own condition notes, its own recovery amount). Demanding a
--   second upload on the clearance row would mean the Admin who just watched the
--   HOD and HR both sign is still blocked — which is precisely the double work
--   satisfied_by_step exists to abolish.
--
--   It does NOT bypass fms_exit_try_complete_clearance: the clearance step still
--   completes only when EVERY row is done-or-NA, and that is still the DATABASE's
--   decision. And it is IDEMPOTENT — a second signature must not error, and must
--   not rewrite done_by/done_at on a row that was already settled.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reverses (in order):
--   drop policy "fms exit docs manager assets insert"   on storage.objects;
--   drop policy "fms exit docs manager assets read"     on storage.objects;
--   drop policy "fms exit docs manager handover insert" on storage.objects;
--   drop policy "fms exit docs manager handover read"   on storage.objects;
--   drop function if exists public.fms_exit_confirm_handover(uuid,text,text);
--   drop function if exists public.fms_exit_record_handover(uuid,jsonb);
--   drop function if exists public.fms_exit_sign_assets(uuid,text,text);
--   drop function if exists public.fms_exit_update_asset(uuid,jsonb);
--   drop function if exists public.fms_exit_autotick_clearance(uuid,text);
--   drop table if exists public.fms_exit_handover;
--   drop table if exists public.fms_exit_assets;
--   alter table public.fms_exit_cases
--     drop column if exists assets_hod_signed_at, drop column if exists assets_hod_signed_by,
--     drop column if exists assets_hod_remarks,   drop column if exists assets_hr_signed_at,
--     drop column if exists assets_hr_signed_by,  drop column if exists assets_hr_remarks;
--   -- then restore fms_exit_confirm_lwd from 20260714140000.
-- ===========================================================================

-- ===========================================================================
-- THE TWO SIGNATURES. They live on the CASE HEADER, next to assets_returned_at,
-- deliberately: the queue, the Control Center and the detail header all read one
-- row per case, and a sign-off that lived on a satellite would force a join into
-- every one of them just to answer "is anyone still owed a signature?".
--
-- Nothing here is salary, F&F or interview content — the header stays wide-read.
-- ===========================================================================
alter table public.fms_exit_cases
  add column if not exists assets_hod_signed_at timestamptz,
  add column if not exists assets_hod_signed_by uuid references auth.users on delete set null,
  add column if not exists assets_hod_remarks   text,
  add column if not exists assets_hr_signed_at  timestamptz,
  add column if not exists assets_hr_signed_by  uuid references auth.users on delete set null,
  add column if not exists assets_hr_remarks    text;

comment on column public.fms_exit_cases.assets_hod_signed_at is
  'The reporting manager / HOD''s signature on the asset return. Required BEFORE HR''s — HR''s signature is what stamps assets_returned_at and completes the step.';

-- ===========================================================================
-- fms_exit_assets — one row per asset issued to the leaver.
--
-- ⚠ SNAPSHOT, DO NOT JOIN — the same rule as the clearance checks. `name` is a COPY
--   of the master's name at seed time. Renaming "Laptop" to "Laptop (company)" next
--   quarter must not rewrite what last quarter's leaver was actually asked to hand
--   back. asset_type_id keeps the provenance and is `on delete set null`, so deleting
--   a master row does not erase history.
-- ===========================================================================
create table if not exists public.fms_exit_assets (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.fms_exit_cases on delete cascade,
  -- Provenance only. NEVER joined to read the asset's name — see above.
  asset_type_id   uuid references public.fms_exit_asset_types on delete set null,
  name            text not null,                  -- the SNAPSHOT
  sort_order      integer not null default 0,     -- the master's order, snapshotted

  -- 'pending'        — still out there. THE ONLY STATUS THAT BLOCKS HR'S SIGNATURE.
  -- 'returned'       — back, with a condition and (optionally) a photo.
  -- 'not_applicable' — never issued to this person.
  -- 'lost'           — gone. Needs a recovery amount OR an explicit remark; a lost
  --                    laptop with no number is how a recovery quietly never happens.
  status          text not null default 'pending'
                    check (status in ('pending','returned','not_applicable','lost')),
  returned_on     date,
  condition       text,
  remarks         text,
  recovery_amount numeric(12,2),                  -- what is being recovered for a 'lost' asset

  file_path       text,                           -- a photo of the returned kit
  file_name       text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The idempotency guard for the seed, and the reason re-confirming a changed LWD
  -- cannot grow a second copy of the list. Master names are unique.
  unique (case_id, name)
);

comment on table public.fms_exit_assets is
  'One row per asset issued to the leaver, SNAPSHOTTED from the ACTIVE fms_exit_asset_types when the last working day was confirmed. Settling every row is what unlocks HR''s signature on the asset-return step; HR''s signature then auto-ticks the Admin + IT clearance rows.';

create index if not exists fms_exit_assets_case_idx   on public.fms_exit_assets (case_id);
create index if not exists fms_exit_assets_status_idx on public.fms_exit_assets (status);

drop trigger if exists trg_fms_exit_assets_updated on public.fms_exit_assets;
create trigger trg_fms_exit_assets_updated
  before update on public.fms_exit_assets
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_exit_handover — 1:1 with the case. The primary key IS the case id: there is
-- exactly one handover, and a second row would be a second version of the truth.
--
-- The receiver is `uuid OR free text`, the same shape HR uses for external
-- interviewers. The work is very often handed to someone with no portal login (a
-- contractor, a new joiner whose account is not open yet, a client-side counterpart)
-- — and "handed over to nobody" is not a handover, so the RPC demands one of the two.
-- ===========================================================================
create table if not exists public.fms_exit_handover (
  case_id              uuid primary key references public.fms_exit_cases on delete cascade,

  handover_to_user_id  uuid references auth.users on delete set null,
  handover_to_name     text,                       -- …or a plain name, for a non-portal person

  kt_done              boolean not null default false,
  kt_remarks           text,
  notes                text,
  file_path            text,                       -- the handover note / KT document
  file_name            text,

  manager_confirmed_at timestamptz,
  manager_confirmed_by uuid references auth.users on delete set null,
  manager_remarks      text,
  hr_confirmed_at      timestamptz,                -- THIS is what completes the step
  hr_confirmed_by      uuid references auth.users on delete set null,
  hr_remarks           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.fms_exit_handover is
  'The work handover & knowledge transfer, 1:1 with the case. The reporting manager confirms first; HR''s confirmation stamps handover_completed_at and auto-ticks the Reporting-Manager clearance row.';

drop trigger if exists trg_fms_exit_handover_updated on public.fms_exit_handover;
create trigger trg_fms_exit_handover_updated
  before update on public.fms_exit_handover
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — readable by whoever may read the case (fms_exit_can_read_case already
-- covers the reporting managers AND the clearance owners); every write is an RPC.
-- ===========================================================================
alter table public.fms_exit_assets enable row level security;

drop policy if exists fms_exit_assets_select on public.fms_exit_assets;
create policy fms_exit_assets_select on public.fms_exit_assets
  for select to authenticated using (public.fms_exit_can_read_case(case_id, auth.uid()));

drop policy if exists fms_exit_assets_write_admin on public.fms_exit_assets;
create policy fms_exit_assets_write_admin on public.fms_exit_assets
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_exit_handover enable row level security;

drop policy if exists fms_exit_handover_select on public.fms_exit_handover;
create policy fms_exit_handover_select on public.fms_exit_handover
  for select to authenticated using (public.fms_exit_can_read_case(case_id, auth.uid()));

drop policy if exists fms_exit_handover_write_admin on public.fms_exit_handover;
create policy fms_exit_handover_write_admin on public.fms_exit_handover
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- ⭐ THE AUTO-TICK — the thing that stops the same work being owed twice.
--
-- INTERNAL. Deliberately NOT granted to `authenticated`: it bypasses the evidence
-- rule, so it must only ever be reachable from a step-completion RPC that has
-- already proved the signature happened. (Postgres grants EXECUTE to PUBLIC by
-- default — hence the explicit revoke below. Without it this would be a public
-- "tick anything that claims to be satisfied by a step" endpoint.)
--
-- Three properties, all load-bearing:
--
--   1. IT BYPASSES `requires_file`. The evidence is the sign-off itself. (It does
--      NOT bypass fms_exit_try_complete_clearance — the caller still invokes that,
--      and the clearance step still completes only when every row is done-or-NA.)
--   2. IT IS IDEMPOTENT. `where not done and not not_applicable` means a second
--      signature ticks nothing, errors nothing, and — crucially — does NOT rewrite
--      done_at / done_by on a row that someone had already ticked by hand.
--   3. IT TOUCHES NOTHING ELSE. Scoped to `satisfied_by_step = p_step` on THIS case.
--      A row whose satisfied_by_step is null (Payroll, Accounts, Travel Desk,
--      Training, HR) is independent and stays exactly as it was.
-- ===========================================================================
create or replace function public.fms_exit_autotick_clearance(p_case uuid, p_step text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  update public.fms_exit_clearance_checks set
    done           = true,
    done_at        = now(),          -- server-side, as everywhere else
    done_by        = v_uid,
    pending_reason = null
  where case_id           = p_case
    and satisfied_by_step = p_step
    and not done
    and not not_applicable;          -- an N/A row is SETTLED; do not resurrect it
  get diagnostics v_n = row_count;

  -- The note goes on the ACTIVITY trail, not on the row: the row's own columns are
  -- its state, and a "how" that rewrote `pending_reason` would read as an excuse.
  if v_n > 0 then
    insert into public.fms_exit_activity (entity_type, entity_id, type, actor_id, note, meta)
    values ('case', p_case, 'clearance_autoticked', v_uid,
            'Completed via the ' ||
            case p_step when 'asset_return' then 'Asset Return' when 'handover' then 'Handover' else p_step end
            || ' step — ' || v_n || ' clearance row(s) ticked automatically.',
            jsonb_build_object('step', p_step, 'rows', v_n));
  end if;

  return v_n;
end $$;
revoke all on function public.fms_exit_autotick_clearance(uuid, text) from public;

-- ===========================================================================
-- RPC — CONFIRM THE LAST WORKING DAY. (Replaced from 20260714140000.)
--
-- ⚠ EVERY EXISTING BEHAVIOUR IS PRESERVED VERBATIM. The status/step guard, the
--   authz check, the idempotent `if count = 0` checklist seed, the announce
--   fan-out — and, above all, the property Phase 3's acceptance test pins down:
--   RE-CONFIRMING A CHANGED LWD MOVES EVERY DUE DATE AND TOUCHES NO ITEM (the due
--   dates are derived in TS from `lwd` + the snapshotted offsets, so there is
--   nothing stored to rewrite).
--
--   The ONE addition is the asset seed, guarded by its own `if count = 0`, in the
--   same transaction. The M3 header announced it.
-- ===========================================================================
drop function if exists public.fms_exit_confirm_lwd(uuid, date);
create or replace function public.fms_exit_confirm_lwd(p_case uuid, p_lwd date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_step    text;
  v_no      text;
  v_name    text;
  v_emp     uuid;
  v_mgrs    uuid[];
  v_seeded  integer;
  v_owners  uuid[];
  v_recips  uuid[];
begin
  if p_lwd is null then raise exception 'A last working day is required'; end if;

  select status, current_step, exit_no, employee_name, employee_user_id, reporting_manager_ids
    into v_status, v_step, v_no, v_name, v_emp, v_mgrs
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  -- The HR Head's approval is what puts a case into 'clearance' at step 'lwd_confirm'.
  -- Re-confirmation is legitimate for as long as the case is still in that phase
  -- (current_step has by then moved on to 'clearance'), which is what lets HR move a
  -- date that was agreed and then changed.
  if v_status <> 'clearance' or v_step not in ('lwd_confirm', 'clearance') then
    raise exception 'This case is not at the last-working-day step (status %, step %)', v_status, v_step;
  end if;
  if not public.fms_exit_can_act('lwd_confirm', p_case, v_uid) then
    raise exception 'Not authorized to confirm the last working day on this exit case';
  end if;

  update public.fms_exit_cases set
    lwd              = p_lwd,
    lwd_confirmed_at = now(),
    current_step     = 'clearance'
  where id = p_case;

  -- ---- SEED THE CHECKLIST. Once, from the ACTIVE master, snapshotted. ----
  select count(*) into v_seeded from public.fms_exit_clearance_checks where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_clearance_checks (
      case_id, item_id, item_key,
      name, department_label, description,
      owner_ids, owner_is_reporting_manager,
      requires_file, allows_link, due_days, sort_order, satisfied_by_step
    )
    select p_case, i.id, i.key,
           i.name, i.department_label, i.description,
           i.owner_ids, i.owner_is_reporting_manager,
           i.requires_file, i.allows_link, i.due_days, i.sort_order, i.satisfied_by_step
      from public.fms_exit_clearance_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (case_id, item_key) do nothing;
  end if;

  -- ---- SEED THE ASSET LIST. (M4.) Same shape, same guard, same transaction. ----
  -- Snapshotted for the same reason the checks are: this is the list THIS leaver was
  -- asked to hand back, and a master rename next quarter must not rewrite it. An
  -- employee who was issued none of them simply marks the rows not-applicable — which
  -- settles them, and is a fact worth recording rather than a list worth suppressing.
  select count(*) into v_seeded from public.fms_exit_assets where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_assets (case_id, asset_type_id, name, sort_order)
    select p_case, t.id, t.name, t.sort_order
      from public.fms_exit_asset_types t
     where t.active
     order by t.sort_order, t.name
    on conflict (case_id, name) do nothing;
  end if;

  -- Everyone whose clock just started: the employee, EVERY DISTINCT CLEARANCE OWNER
  -- (a row with no owner falls back to the `clearance` step's owners, so nothing is
  -- ever owed by nobody), and the reporting managers.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_owners
    from public.fms_exit_clearance_checks k,
         lateral unnest(
           case when cardinality(k.owner_ids) > 0 then k.owner_ids
                else public.fms_exit_step_owner_ids('clearance') end
         ) u
   where k.case_id = p_case;

  v_recips := coalesce(v_owners, '{}'::uuid[])
            || coalesce(v_mgrs, '{}'::uuid[])
            || case when v_emp is null then '{}'::uuid[] else array[v_emp] end;

  perform public.fms_exit_announce(
    'case', p_case, 'lwd_confirmed',
    v_no || ' — the last working day for ' || v_name || ' is ' || to_char(p_lwd, 'DD-MM-YYYY')
         || '. The clearance checklist is now open.',
    v_recips,
    jsonb_build_object('exit_no', v_no, 'lwd', p_lwd)
  );
end $$;
grant execute on function public.fms_exit_confirm_lwd(uuid, date) to authenticated;

-- ===========================================================================
-- RPC — record what happened to ONE asset.
--
-- The house shape: lock the row → validate the case's status → fms_exit_can_act →
-- validate the inputs → stamp the domain row.
--
-- ⚠ A 'lost' ASSET NEEDS A RECOVERY AMOUNT **OR** AN EXPLICIT REMARK. A lost laptop
--   with no number against it is how a recovery quietly never happens: the row is
--   settled, the step signs off, the F&F is generated, and nobody ever deducts
--   anything. Either say what is being recovered, or say why nothing is.
--
-- Editing stops once HR has signed: the step is complete, and a signature that can be
-- silently invalidated underneath the person who gave it is not a signature.
-- ===========================================================================
drop function if exists public.fms_exit_update_asset(uuid, jsonb);
create or replace function public.fms_exit_update_asset(p_asset uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_case     uuid;
  v_name     text;
  v_status   text;
  v_lwd      date;
  v_hr       timestamptz;
  v_new      text;
  v_amount   numeric(12,2);
  v_remarks  text;
  v_returned date;
begin
  select a.case_id, a.name into v_case, v_name
    from public.fms_exit_assets a where a.id = p_asset for update;
  if v_case is null then raise exception 'Asset not found'; end if;

  select c.status, c.lwd, c.assets_hr_signed_at into v_status, v_lwd, v_hr
    from public.fms_exit_cases c where c.id = v_case for update;

  if not public.fms_exit_can_act('asset_return', v_case, v_uid) then
    raise exception 'Not authorized to record the asset return on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its asset return no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the asset return is dated from it';
  end if;
  if v_hr is not null then
    raise exception 'HR has already signed off the asset return — it can no longer be edited';
  end if;

  v_new     := coalesce(nullif(trim(p->>'status'), ''), 'pending');
  if v_new not in ('pending','returned','not_applicable','lost') then
    raise exception 'Unknown asset status %', v_new;
  end if;

  v_amount  := nullif(p->>'recovery_amount', '')::numeric(12,2);
  v_remarks := nullif(trim(p->>'remarks'), '');
  v_returned := nullif(p->>'returned_on', '')::date;

  -- The one rule with teeth. See the header.
  if v_new = 'lost' and v_amount is null and v_remarks is null then
    raise exception
      '% is marked lost — record the amount being recovered, or say why nothing is being recovered', v_name;
  end if;

  update public.fms_exit_assets set
    status          = v_new,
    -- A returned asset came back on a DAY. Default it to today rather than leaving a
    -- returned-with-no-date row, which reads as returned and reports as never.
    returned_on     = case when v_new = 'returned' then coalesce(v_returned, current_date) else v_returned end,
    condition       = nullif(trim(p->>'condition'), ''),
    remarks         = v_remarks,
    -- Only a lost asset carries a recovery. Clearing it on any other status stops a
    -- stale number from an earlier "lost" riding along into the F&F.
    recovery_amount = case when v_new = 'lost' then v_amount else null end,
    file_path       = coalesce(nullif(p->>'file_path', ''), file_path),
    file_name       = coalesce(nullif(p->>'file_name', ''), file_name)
  where id = p_asset;
end $$;
grant execute on function public.fms_exit_update_asset(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ RPC — SIGN THE ASSET RETURN. Two signatures, in order, and the second one
-- completes the step.
--
--   'hod' — the reporting manager (or the configured asset_return owner). First.
--   'hr'  — HR. REFUSED until the HOD has signed AND every asset is settled, and it
--           is what stamps assets_returned_at → the step is done → THE AUTO-TICK
--           FIRES and the Admin + IT clearance rows flip to done, with no file asked
--           of anyone.
--
-- The order is the point. "HR signs first and the HOD rubber-stamps it later" is how
-- a laptop is written off by someone who never saw it.
--
-- IDEMPOTENT: signing twice returns quietly. It does not error (the second click of a
-- slow button is not a workflow violation) and it does not re-stamp — the first
-- signature's timestamp and signer are the truth.
-- ===========================================================================
drop function if exists public.fms_exit_sign_assets(uuid, text, text);
create or replace function public.fms_exit_sign_assets(p_case uuid, p_role text, p_remarks text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_lwd     date;
  v_no      text;
  v_name    text;
  v_mgrs    uuid[];
  v_hod     timestamptz;
  v_hr      timestamptz;
  v_pending integer;
begin
  if p_role not in ('hod','hr') then raise exception 'Unknown signing role %', p_role; end if;

  select status, lwd, exit_no, employee_name, reporting_manager_ids,
         assets_hod_signed_at, assets_hr_signed_at
    into v_status, v_lwd, v_no, v_name, v_mgrs, v_hod, v_hr
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('asset_return', p_case, v_uid) then
    raise exception 'Not authorized to sign the asset return on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its asset return no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the asset return is dated from it';
  end if;

  if p_role = 'hod' then
    if v_hod is not null then return; end if;   -- IDEMPOTENT
    update public.fms_exit_cases set
      assets_hod_signed_at = now(),
      assets_hod_signed_by = v_uid,
      assets_hod_remarks   = nullif(trim(p_remarks), '')
    where id = p_case;
    return;
  end if;

  -- ---- p_role = 'hr' — the signature that COMPLETES the step ----
  if v_hr is not null then return; end if;      -- IDEMPOTENT

  if v_hod is null then
    raise exception 'The reporting manager / HOD must sign the asset return first';
  end if;

  select count(*) into v_pending
    from public.fms_exit_assets where case_id = p_case and status = 'pending';
  if v_pending > 0 then
    raise exception
      '% asset(s) are still pending — every one must be returned, written off as lost, or marked not applicable before HR can sign',
      v_pending;
  end if;

  update public.fms_exit_cases set
    assets_hr_signed_at = now(),
    assets_hr_signed_by = v_uid,
    assets_hr_remarks   = nullif(trim(p_remarks), ''),
    assets_returned_at  = now()                 -- ← the step's authoritative timestamp
  where id = p_case;

  -- ⭐ THE DE-DUPLICATION. admin_assets + it_assets flip to done, no file demanded.
  perform public.fms_exit_autotick_clearance(p_case, 'asset_return');
  -- …but completion of the CLEARANCE step is still the database's own call, over the
  -- whole list. The auto-tick does not bypass it; it just fills in two of the boxes.
  perform public.fms_exit_try_complete_clearance(p_case);

  perform public.fms_exit_announce(
    'case', p_case, 'assets_returned',
    v_no || ' — the asset return for ' || v_name || ' is signed off by the HOD and HR.',
    coalesce(v_mgrs, '{}'::uuid[])
      || public.fms_exit_step_owner_ids('clearance')
      || public.fms_exit_step_owner_ids('payroll_inputs'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_sign_assets(uuid, text, text) to authenticated;

-- ===========================================================================
-- RPC — record the handover. WHO is taking the work over, and did the KT happen.
--
-- ⚠ A RECEIVER IS MANDATORY — a user id OR a plain name. "Handed over to nobody" is
--   not a handover; it is the work quietly evaporating on someone's last day, and it
--   is the single most common failure this step exists to catch.
--
-- Upsert on the case id: there is one handover, and re-recording it (the receiver
-- changed, the KT finally happened) overwrites the same row rather than growing a
-- second version of the truth. Locked once HR has confirmed.
-- ===========================================================================
drop function if exists public.fms_exit_record_handover(uuid, jsonb);
create or replace function public.fms_exit_record_handover(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_lwd    date;
  v_hr     timestamptz;
  v_to     uuid;
  v_to_nm  text;
begin
  select c.status, c.lwd into v_status, v_lwd
    from public.fms_exit_cases c where c.id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('handover', p_case, v_uid) then
    raise exception 'Not authorized to record the handover on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its handover no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the handover is dated from it';
  end if;

  select h.hr_confirmed_at into v_hr from public.fms_exit_handover h where h.case_id = p_case for update;
  if v_hr is not null then
    raise exception 'HR has already confirmed the handover — it can no longer be edited';
  end if;

  v_to    := nullif(p->>'handover_to_user_id', '')::uuid;
  v_to_nm := nullif(trim(p->>'handover_to_name'), '');
  if v_to is null and v_to_nm is null then
    raise exception 'Name the person taking the work over — a handover to nobody is not a handover';
  end if;

  insert into public.fms_exit_handover (
    case_id, handover_to_user_id, handover_to_name, kt_done, kt_remarks, notes, file_path, file_name
  ) values (
    p_case, v_to, v_to_nm,
    coalesce((p->>'kt_done')::boolean, false),
    nullif(trim(p->>'kt_remarks'), ''),
    nullif(trim(p->>'notes'), ''),
    nullif(p->>'file_path', ''),
    nullif(p->>'file_name', '')
  )
  on conflict (case_id) do update set
    handover_to_user_id = excluded.handover_to_user_id,
    handover_to_name    = excluded.handover_to_name,
    kt_done             = excluded.kt_done,
    kt_remarks          = excluded.kt_remarks,
    notes               = excluded.notes,
    -- A new upload replaces the old one; NO upload leaves the existing file alone,
    -- so saving "the KT is now done" does not silently detach the handover note.
    file_path           = coalesce(excluded.file_path, public.fms_exit_handover.file_path),
    file_name           = coalesce(excluded.file_name, public.fms_exit_handover.file_name);
end $$;
grant execute on function public.fms_exit_record_handover(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ RPC — CONFIRM THE HANDOVER. Manager first, then HR — and HR's confirmation
-- completes the step, stamps handover_completed_at, and AUTO-TICKS the Reporting
-- Manager's clearance row ("Work handover & knowledge transfer").
--
-- Same two-signature shape as the asset return, same idempotency, same reason: the
-- manager is the person who knows whether the work actually landed somewhere, and HR
-- is the person who is accountable for saying the exit is safe to complete.
-- ===========================================================================
drop function if exists public.fms_exit_confirm_handover(uuid, text, text);
create or replace function public.fms_exit_confirm_handover(p_case uuid, p_role text, p_remarks text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_lwd    date;
  v_no     text;
  v_name   text;
  v_mgrs   uuid[];
  v_to     uuid;
  v_to_nm  text;
  v_mgr_ok timestamptz;
  v_hr_ok  timestamptz;
begin
  if p_role not in ('manager','hr') then raise exception 'Unknown confirming role %', p_role; end if;

  select status, lwd, exit_no, employee_name, reporting_manager_ids
    into v_status, v_lwd, v_no, v_name, v_mgrs
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('handover', p_case, v_uid) then
    raise exception 'Not authorized to confirm the handover on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its handover no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the handover is dated from it';
  end if;

  select h.handover_to_user_id, h.handover_to_name, h.manager_confirmed_at, h.hr_confirmed_at
    into v_to, v_to_nm, v_mgr_ok, v_hr_ok
    from public.fms_exit_handover h where h.case_id = p_case for update;

  -- There is nothing to confirm until somebody has said who took the work over.
  if v_to is null and v_to_nm is null then
    raise exception 'Record the handover first — who is taking the work over?';
  end if;

  if p_role = 'manager' then
    if v_mgr_ok is not null then return; end if;   -- IDEMPOTENT
    update public.fms_exit_handover set
      manager_confirmed_at = now(),
      manager_confirmed_by = v_uid,
      manager_remarks      = nullif(trim(p_remarks), '')
    where case_id = p_case;
    return;
  end if;

  -- ---- p_role = 'hr' — the confirmation that COMPLETES the step ----
  if v_hr_ok is not null then return; end if;      -- IDEMPOTENT
  if v_mgr_ok is null then
    raise exception 'The reporting manager must confirm the handover first';
  end if;

  update public.fms_exit_handover set
    hr_confirmed_at = now(),
    hr_confirmed_by = v_uid,
    hr_remarks      = nullif(trim(p_remarks), '')
  where case_id = p_case;

  update public.fms_exit_cases set
    handover_completed_at = now()                  -- ← the step's authoritative timestamp
  where id = p_case;

  -- ⭐ THE DE-DUPLICATION. manager_kt flips to done — the manager does not sign twice.
  perform public.fms_exit_autotick_clearance(p_case, 'handover');
  perform public.fms_exit_try_complete_clearance(p_case);

  perform public.fms_exit_announce(
    'case', p_case, 'handover_completed',
    v_no || ' — the work handover for ' || v_name || ' is confirmed by the reporting manager and HR.',
    coalesce(v_mgrs, '{}'::uuid[])
      || public.fms_exit_step_owner_ids('clearance')
      || public.fms_exit_step_owner_ids('hr_verification'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_confirm_handover(uuid, text, text) to authenticated;

-- ===========================================================================
-- STORAGE — ADDITIVE ONLY. The 4 staff policies (M1), the 3 case policies (M2) and
-- the 2 clearance-owner policies (M3) are UNTOUCHED. Postgres OR-combines permissive
-- policies, so these purely WIDEN two narrow paths for people who already owe work.
--
-- ⚠ WITHOUT THESE, A REPORTING MANAGER CANNOT ATTACH THE ASSET PHOTO OR THE HANDOVER
--   NOTE. The M1 bucket policies are gated on fms_exit_is_exit_staff() /
--   fms_exit_is_coordinator(), and a reporting manager is NEITHER — they own the
--   asset_return and handover steps PER CASE, through reporting_manager_ids, not
--   through the step-owner table. They would be handed a file input that always 403s.
--   (Phases 2 and 3 both had to add exactly this kind of policy, for exactly this
--   reason.) Scoped to cases/<a case they manage>/{assets,handover}/… and nowhere else.
-- ===========================================================================
drop policy if exists "fms exit docs manager assets insert" on storage.objects;
create policy "fms exit docs manager assets insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'assets'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and auth.uid() = any(c.reporting_manager_ids)
    )
  );

drop policy if exists "fms exit docs manager assets read" on storage.objects;
create policy "fms exit docs manager assets read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'assets'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and auth.uid() = any(c.reporting_manager_ids)
    )
  );

drop policy if exists "fms exit docs manager handover insert" on storage.objects;
create policy "fms exit docs manager handover insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'handover'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and auth.uid() = any(c.reporting_manager_ids)
    )
  );

drop policy if exists "fms exit docs manager handover read" on storage.objects;
create policy "fms exit docs manager handover read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'handover'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and auth.uid() = any(c.reporting_manager_ids)
    )
  );
