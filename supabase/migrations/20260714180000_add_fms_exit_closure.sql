-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — CLOSURE (Phase 7, M7). THE TERMINAL STEP.
--
-- Table:
--   fms_exit_documents  — one row per document issued at closure, SNAPSHOTTED from
--                         the ACTIVE fms_exit_document_types (Experience Letter,
--                         Relieving Letter, Full & Final Statement, NOC)
--
-- RPCs (house shape: SECURITY DEFINER → select … for update → validate status →
-- fms_exit_can_act() → validate inputs → stamp THE STEP'S OWN timestamp on the header):
--   fms_exit_seed_documents(p_case)              — idempotent materialisation
--   fms_exit_issue_documents(p_case, p)          — the letters go OUT
--   fms_exit_record_ack(p_case, p_document, p)   — the signed acknowledgement comes BACK
--   fms_exit_archive_case(p_case, p)             — ⭐ THE TERMINAL ACT. IT REFUSES.
--
-- Replaced (create or replace, preserving M3 + M4 verbatim and appending one seed):
--   fms_exit_confirm_lwd — now ALSO seeds the document list, in the same transaction
--                          as the clearance checks and the assets.
--
-- ---------------------------------------------------------------------------
-- ⚠⚠ WHY `documents` AND `archive` ARE TWO STEPS AND NOT ONE ⚠⚠
--
--   Different owner, different TAT, and — decisively — DIFFERENT EVIDENCE. `documents`
--   is evidenced by the letter going out. `archive` is evidenced by THE SIGNED
--   ACKNOWLEDGEMENT COMING BACK, and by the leaver's own copy of the F&F being where
--   they can actually open it.
--
--   Merge the two and you hide the commonest real failure in the whole workflow:
--   **the letters were issued and the acknowledgement never came back.** The case
--   would read "closed", the employee would have no relieving letter on file, and
--   nobody would find out until a background check eighteen months later. So this
--   phase's whole job is to REFUSE TO CLOSE A CASE THAT IS NOT ACTUALLY CLOSED —
--   and to say, specifically, what is missing. "Cannot archive" is a useless error
--   at 6pm on a Friday.
-- ---------------------------------------------------------------------------
-- ⚠ EVERY GUARD BELOW IS `fms_exit_step_done` — **TIMESTAMP *OR* SKIPPED**.
--
--   Never the raw timestamp column. An absconder has no handover and gets no
--   relieving letter; a terminated employee's F&F may be waived. Those steps are
--   SKIPPED WITH A REASON, and a skipped step is complete-with-a-reason: it satisfies
--   every downstream guard, exactly as lib/queues.ts `stepDone()` says in TypeScript.
--   A guard reading `documents_issued_at is not null` would leave such a case
--   PERMANENTLY WEDGED — open in every queue, closable by nobody, forever.
-- ---------------------------------------------------------------------------
-- ⚠ SNAPSHOT, DO NOT JOIN. `name` and `requires_file` are COPIED from the master at
--   seed time, exactly as the clearance checks and the assets are. document_type_id is
--   `on delete set null` — PROVENANCE, not the label. Renaming "Relieving Letter" or
--   flipping its requires_file next quarter must not rewrite what THIS leaver was
--   actually given, and a document row whose name vanished with its master is a row
--   nobody can defend when the leaver's next employer rings up.
-- ---------------------------------------------------------------------------
-- ⚠ STORAGE — cases/<id>/share/… AND NOWHERE ELSE.
--
--   The issued letter and the signed acknowledgement BOTH go under `share/`, the ONE
--   prefix M2's "fms exit docs employee share read" policy lets the exiting employee
--   read. A relieving letter the leaver cannot open is not a relieving letter. The
--   RPCs VALIDATE the prefix rather than trusting the caller to pick the right uploader
--   — the same rule fms_exit_release_fnf_payment applies to the final F&F copy.
--
--   NO NEW STORAGE POLICY IS NEEDED, and adding one would be noise:
--     • the `documents` step's owner IS exit staff (they own a step other than
--       `resignation`), so M1's four bucket policies already let them read/write/
--       overwrite/delete anywhere in the bucket, share/ included;
--     • the employee's READ of share/ is M2's, and already live;
--     • M5's and M6's RESTRICTIVE policies test `foldername[3] = 'interview'` and
--       `= 'fnf'` respectively — a `share/` object is `[3] = 'share'`, so it passes
--       both on their third disjunct and is completely unaffected. CONFIRMED, not
--       assumed: that is precisely what M6's header promised ("IT MUST NOT CATCH
--       share/"), and this phase is the thing that would have broken if it did.
--
--   `cases/<id>/documents/…` stays available for any internal working (a draft, a
--   template) via the generic uploader — nothing in this migration references it,
--   because nothing this migration tracks may be filed where the leaver cannot see it.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reverses (in order):
--   drop function if exists public.fms_exit_archive_case(uuid, jsonb);
--   drop function if exists public.fms_exit_record_ack(uuid, uuid, jsonb);
--   drop function if exists public.fms_exit_issue_documents(uuid, jsonb);
--   drop function if exists public.fms_exit_seed_documents(uuid);
--   drop table if exists public.fms_exit_documents;
--   -- then restore fms_exit_confirm_lwd from 20260714150000.
-- ===========================================================================

-- ===========================================================================
-- fms_exit_documents — one row per document this leaver is to be given.
-- ===========================================================================
create table if not exists public.fms_exit_documents (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.fms_exit_cases on delete cascade,

  -- Provenance ONLY. Never joined to read the document's fields — see the header.
  document_type_id  uuid references public.fms_exit_document_types on delete set null,

  -- ---- the SNAPSHOT of the master row, as it stood when the LWD was confirmed ----
  name              text not null,
  -- A letter with no PDF is a promise, not a document. Snapshotted, so relaxing the
  -- master next quarter cannot retroactively excuse a letter that was never attached.
  requires_file     boolean not null default true,
  sort_order        integer not null default 0,

  -- ---- THE LETTER GOES OUT ----
  issued_on         date,                    -- a business DATE. Never a browser clock.
  file_path         text,                    -- cases/<id>/share/… — the RPC enforces it
  file_name         text,

  -- ---- ⭐ THE SIGNED ACKNOWLEDGEMENT COMES BACK ----
  -- The evidence `archive` depends on, and whose ABSENCE is the failure mode this
  -- whole phase exists to make visible.
  handed_over_on    date,
  ack_signed_path   text,                    -- cases/<id>/share/… — the RPC enforces it
  ack_signed_name   text,

  remarks           text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A case must not accumulate two Relieving Letters. Keyed on the SNAPSHOTTED name,
  -- not on document_type_id: that column is `on delete set null`, and a unique index
  -- over NULLs would stop deduplicating the moment a master row was deleted.
  unique (case_id, name)
);

-- …and belt-and-braces on the provenance link while it still exists.
create unique index if not exists fms_exit_documents_case_type_uniq
  on public.fms_exit_documents (case_id, document_type_id)
  where document_type_id is not null;

create index if not exists fms_exit_documents_case_idx on public.fms_exit_documents (case_id);

comment on table public.fms_exit_documents is
  'The documents issued at closure, SNAPSHOTTED from the ACTIVE fms_exit_document_types when the last working day was confirmed. Two evidence columns, not one: the letter going OUT (issued_on/file_path) and THE SIGNED ACKNOWLEDGEMENT COMING BACK (handed_over_on/ack_signed_path). fms_exit_archive_case refuses without the second — "letters issued, ack never returned" is the commonest real failure of an exit, and merging the two steps would hide it.';

comment on column public.fms_exit_documents.name is
  'SNAPSHOT of the master name. Renaming the master next quarter must not rewrite what THIS leaver was actually given.';

comment on column public.fms_exit_documents.ack_signed_path is
  'The copy the employee signs and RETURNS, under cases/<id>/share/. Its absence is what fms_exit_archive_case refuses on.';

drop trigger if exists trg_fms_exit_documents_updated on public.fms_exit_documents;
create trigger trg_fms_exit_documents_updated
  before update on public.fms_exit_documents
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — a document row is readable by whoever may read its case.
--
-- Deliberately the WIDE gate (fms_exit_can_read_case), not a narrow one: this is not
-- a confidential satellite. The employee MUST read it — these are their letters, and
-- MyExit is where they open them. The reporting manager and the clearance owners see
-- that the letters went out, which is a fact about the process, not about the money.
-- Nothing here carries a rupee or a word of the exit interview.
--
-- Every write is an RPC (SECURITY DEFINER, re-checking fms_exit_can_act).
-- ===========================================================================
alter table public.fms_exit_documents enable row level security;

drop policy if exists fms_exit_documents_select on public.fms_exit_documents;
create policy fms_exit_documents_select on public.fms_exit_documents
  for select to authenticated using (public.fms_exit_can_read_case(case_id, auth.uid()));

drop policy if exists fms_exit_documents_write_admin on public.fms_exit_documents;
create policy fms_exit_documents_write_admin on public.fms_exit_documents
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_exit_seed_documents — materialise the list, ONCE, from the ACTIVE master.
--
-- ⭐ WHERE THE SEED HAPPENS, AND WHY: at **fms_exit_confirm_lwd**, alongside the
--    clearance checks (M3) and the assets (M4). Not lazily when `documents` first opens.
--
--    Three reasons, in order of weight:
--
--    1. **There is no reliable hook for a lazy seed.** `documents` opens when
--       `stepDone(fnf_approve)` becomes true — and that can happen by the F&F approval
--       being **SKIPPED**, which runs `fms_exit_skip_step` and nothing else. A lazy seed
--       hung off fms_exit_approve_fnf would simply never fire on that path, and the case
--       would reach closure with an EMPTY document list and archive itself with no
--       letters at all. The one event every case passes through is the confirmed LWD.
--    2. **Consistency.** The module already has exactly one seeding idiom — `if count =
--       0`, from the active master, inside confirm_lwd, snapshotted. A second, different
--       idiom for the third list is a thing to remember, and it would be forgotten.
--    3. **Visibility.** HR wants to know from day one which letters this exit will owe.
--
--    The cost is that a document type added to the master mid-case is not picked up by
--    a case already in flight. That is the SAME trade the checks and the assets already
--    make, and it is the right one: a case in flight must never silently grow a box.
--    (`fms_exit_issue_documents` calls this defensively too, so a case that somehow has
--    no rows — e.g. one seeded before this migration existed — self-heals on first use.)
-- ===========================================================================
create or replace function public.fms_exit_seed_documents(p_case uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  select count(*) into v_n from public.fms_exit_documents where case_id = p_case;
  if v_n > 0 then return 0; end if;

  insert into public.fms_exit_documents (case_id, document_type_id, name, requires_file, sort_order)
  select p_case, t.id, t.name, t.requires_file, t.sort_order
    from public.fms_exit_document_types t
   where t.active
   order by t.sort_order, t.name
  on conflict (case_id, name) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public.fms_exit_seed_documents(uuid) is
  'Materialise this case''s document list from the ACTIVE fms_exit_document_types, SNAPSHOTTED and IDEMPOTENTLY (if count = 0). Called from fms_exit_confirm_lwd — the one event every case passes through — and defensively from fms_exit_issue_documents.';
grant execute on function public.fms_exit_seed_documents(uuid) to authenticated;

-- ===========================================================================
-- fms_exit_confirm_lwd — REPLACED to seed the documents as well.
--
-- ⚠ M3's body and M4's asset seed are reproduced VERBATIM below. The ONLY change is
--   the third seed block. Re-confirming a changed LWD still moves every due date and
--   touches no item: all three seeds are guarded by `if count = 0`, and every due date
--   is derived in TS from `lwd` + a snapshotted offset, so there is nothing stored to
--   rewrite.
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

  -- ---- SEED THE CHECKLIST. (M3.) Once, from the ACTIVE master, snapshotted. ----
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
  select count(*) into v_seeded from public.fms_exit_assets where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_assets (case_id, asset_type_id, name, sort_order)
    select p_case, t.id, t.name, t.sort_order
      from public.fms_exit_asset_types t
     where t.active
     order by t.sort_order, t.name
    on conflict (case_id, name) do nothing;
  end if;

  -- ---- SEED THE DOCUMENT LIST. (M7.) The third list, the same idiom. ----------
  -- Seeded HERE and not lazily at the `documents` step — see fms_exit_seed_documents.
  perform public.fms_exit_seed_documents(p_case);

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

-- ---- BACKFILL. Every case whose LWD was confirmed BEFORE this migration existed
--      has no document rows and would otherwise reach closure with an empty list and
--      archive itself having issued nothing. Idempotent by construction (the seed's
--      own `if count = 0` guard), and it touches no case that already has rows.
do $$
declare r record;
begin
  for r in select id from public.fms_exit_cases where lwd is not null loop
    perform public.fms_exit_seed_documents(r.id);
  end loop;
end $$;

-- ===========================================================================
-- ⭐ RPC — ISSUE THE DOCUMENTS. The letters go OUT.
--
-- Records issued_on / the file / remarks, per document, in one call — because HR
-- issues the experience letter and the relieving letter together, off one screen, and
-- a per-row RPC would make that three round-trips and three chances to stop halfway.
--
-- ⚠⚠ **A DOCUMENT WHOSE SNAPSHOTTED `requires_file` IS TRUE CANNOT BE ISSUED WITHOUT
--     A FILE — AND WHATEVER ARRIVES IN *THIS* CALL COUNTS.**
--
--     That second half is the fix from 20260712190000, and it is not a detail. The
--     stale …160000 version of the clearance toggle tested the STORED row alone:
--         if v_needsfile and v_file is null then raise …
--     …which REJECTED a tick that supplied its own evidence in the same call, making
--     the screen's offer of "attach the letter and mark it issued" a lie. Here the
--     uploaded path arrives in the same jsonb as issued_on, so reading the stored row
--     would refuse every first issue that ever happens.
--
-- `documents_issued_at` stamps once EVERY document row on the case carries an
-- issued_on — coalesced, so correcting a typo in a remark next week does not re-date a
-- step that completed on time. A case that will never issue one of them (a terminated
-- employee gets no relieving letter) does not force it: the `documents` STEP is
-- SKIPPED, with a reason, and archive then still demands the acknowledgement for the
-- letters that WERE issued.
-- ===========================================================================
drop function if exists public.fms_exit_issue_documents(uuid, jsonb);
create or replace function public.fms_exit_issue_documents(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_no      text;
  v_name    text;
  v_emp     uuid;
  v_docs    jsonb;
  v_d       jsonb;
  v_id      uuid;
  v_row     public.fms_exit_documents%rowtype;
  v_issued  date;
  v_path    text;
  v_pending integer;
  v_total   integer;
begin
  select status, exit_no, employee_name, employee_user_id
    into v_status, v_no, v_name, v_emp
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('documents', p_case, v_uid) then
    raise exception 'Not authorized to issue the exit documents on this case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its exit documents no longer apply', v_status;
  end if;

  -- Self-heal: a case seeded before this migration existed has no rows at all.
  perform public.fms_exit_seed_documents(p_case);

  v_docs := coalesce(p->'documents', '[]'::jsonb);
  if jsonb_typeof(v_docs) <> 'array' then
    raise exception 'The documents payload must be a JSON array';
  end if;

  for v_d in select * from jsonb_array_elements(v_docs) loop
    v_id := nullif(v_d->>'id', '')::uuid;
    if v_id is null then raise exception 'Every document line must name its row'; end if;

    select * into v_row from public.fms_exit_documents
     where id = v_id and case_id = p_case for update;
    if v_row.id is null then
      raise exception 'That document does not belong to this exit case';
    end if;

    -- ⭐ WHATEVER ARRIVED IN **THIS** CALL COUNTS. (20260712190000.) A new upload
    --   replaces the old; NO upload leaves the existing file alone, so correcting a
    --   remark cannot silently detach the letter it belongs to.
    v_path   := coalesce(nullif(v_d->>'file_path', ''), v_row.file_path);
    v_issued := coalesce(nullif(v_d->>'issued_on', '')::date, v_row.issued_on);

    -- The letter must be where the LEAVER can open it. A relieving letter filed under
    -- a staff-only prefix is a relieving letter the person does not have.
    if v_path is not null and v_path not like 'cases/' || p_case::text || '/share/%' then
      raise exception 'The % must be stored under cases/%/share/ — it is the one prefix the employee can open', v_row.name, p_case;
    end if;

    -- ⭐⭐ THE EVIDENCE RULE.
    if v_issued is not null and v_row.requires_file and v_path is null then
      raise exception '% cannot be marked issued without the document attached — a letter with no PDF is a promise, not a document', v_row.name;
    end if;

    update public.fms_exit_documents set
      issued_on = v_issued,
      file_path = v_path,
      file_name = coalesce(nullif(v_d->>'file_name', ''), file_name),
      remarks   = case when jsonb_exists(v_d, 'remarks')
                       then nullif(trim(v_d->>'remarks'), '') else remarks end
    where id = v_id;
  end loop;

  -- ---- The FACT, on the header. The DATABASE's call, never the screen's. ----
  select count(*), count(*) filter (where issued_on is null)
    into v_total, v_pending
    from public.fms_exit_documents where case_id = p_case;

  if v_total > 0 and v_pending = 0 then
    -- The letters, not the bank transfer, are what move an exit into Closure.
    -- `clearance` is in the source list on purpose: an absconder whose entire F&F was
    -- waived never passes through 'settlement' at all, and would otherwise sit in
    -- 'clearance' with every step behind it. Consistent with fms_exit_resume_status(),
    -- which reads `documents_issued_at is not null → closure`, so a hold/resume
    -- round-trip lands back exactly here. (Both sides of the CASE read the OLD status —
    -- that is how UPDATE evaluates, and it is what is wanted.)
    update public.fms_exit_cases set
      documents_issued_at = coalesce(documents_issued_at, now()),
      status       = case when status in ('clearance','settlement') then 'closure' else status end,
      current_step = case when status in ('clearance','settlement','closure') then 'archive' else current_step end
    where id = p_case;

    perform public.fms_exit_announce(
      'document', p_case, 'documents_issued',
      v_no || ' (' || v_name || ') — the exit documents have been issued. The case can be archived once the signed acknowledgement comes back.',
      (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
        || public.fms_exit_step_owner_ids('archive'),
      jsonb_build_object('exit_no', v_no)
    );
  else
    -- Something has been un-issued (a letter was withdrawn and reprinted). The stamp
    -- must go with it — a "documents issued" case with an unissued letter is a lie,
    -- and openSteps() would already have disagreed with the timestamp.
    update public.fms_exit_cases set documents_issued_at = null
     where id = p_case and documents_issued_at is not null;
  end if;
end $$;
grant execute on function public.fms_exit_issue_documents(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐⭐ RPC — RECORD THE SIGNED ACKNOWLEDGEMENT. THE THING COMING **BACK**.
--
-- This is the evidence `archive` depends on, and its absence is the exact failure this
-- phase exists to make visible. It is a SEPARATE RPC from the issue, deliberately:
-- issuing and acknowledging are separated by days, by a courier and by a human being
-- who has to sign something — and folding them into one call would let a screen record
-- both at once, which is precisely how "we posted it" quietly becomes "they signed it".
--
-- ⚠ AN ACKNOWLEDGEMENT OF A LETTER THAT WAS NEVER ISSUED IS REFUSED. Signed what?
-- ===========================================================================
drop function if exists public.fms_exit_record_ack(uuid, uuid, jsonb);
create or replace function public.fms_exit_record_ack(p_case uuid, p_document uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_no     text;
  v_row    public.fms_exit_documents%rowtype;
  v_on     date;
  v_path   text;
begin
  select status, exit_no into v_status, v_no
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('documents', p_case, v_uid) then
    raise exception 'Not authorized to record the acknowledgement on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its exit documents no longer apply', v_status;
  end if;

  select * into v_row from public.fms_exit_documents
   where id = p_document and case_id = p_case for update;
  if v_row.id is null then
    raise exception 'That document does not belong to this exit case';
  end if;
  if v_row.issued_on is null then
    raise exception '% has not been issued yet — there is nothing for them to have signed', v_row.name;
  end if;

  -- A business DATE. Defaults to today rather than being left null: a hand-over with
  -- no date reads as done and reports as never.
  v_on   := coalesce(nullif(p->>'handed_over_on', '')::date, v_row.handed_over_on, current_date);
  v_path := coalesce(nullif(p->>'ack_signed_path', ''), v_row.ack_signed_path);

  -- The signed copy lives with the leaver's own letters. Same prefix, same reason.
  if v_path is not null and v_path not like 'cases/' || p_case::text || '/share/%' then
    raise exception 'The signed acknowledgement must be stored under cases/%/share/', p_case;
  end if;

  update public.fms_exit_documents set
    handed_over_on  = v_on,
    ack_signed_path = v_path,
    ack_signed_name = coalesce(nullif(p->>'ack_signed_name', ''), ack_signed_name),
    remarks         = case when jsonb_exists(p, 'remarks')
                           then nullif(trim(p->>'remarks'), '') else remarks end
  where id = p_document;

  perform public.fms_exit_announce(
    'document', p_case, 'ack_received',
    v_no || ' — the signed acknowledgement for the ' || v_row.name || ' has come back.',
    public.fms_exit_step_owner_ids('archive'),
    jsonb_build_object('exit_no', v_no, 'document', v_row.name)
  );
end $$;
grant execute on function public.fms_exit_record_ack(uuid, uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐⭐⭐ fms_exit_archive_blockers — WHY THIS CASE CANNOT BE CLOSED, IN WORDS.
--
-- FIVE conditions, ALL of them required:
--
--   1. clearance         complete-or-SKIPPED
--   2. the F&F           PAID-or-SKIPPED
--   3. the documents     ISSUED-or-SKIPPED
--   4. ⭐ THE SIGNED ACKNOWLEDGEMENT attached for EVERY document actually issued
--   5. ⭐ THE FINAL F&F COPY attached, under share/ — unless the payment was skipped
--
-- (4) and (5) are the two this phase exists for, and neither is expressible as a
-- timestamp on the header: they are EVIDENCE, and evidence is a file. A case that
-- archives without them is a case where the leaver has no relieving letter on file and
-- no copy of their own settlement — discovered eighteen months later, by a background
-- check, with nobody left who remembers.
--
-- ⚠⚠ WHY THIS IS ITS OWN FUNCTION AND NOT JUST INLINE IN fms_exit_archive_case:
--
--    **THE SCREEN CANNOT COMPUTE CONDITION (5) FOR THE PERSON WHO HAS TO ACT ON IT.**
--    `final_fnf_path` lives on fms_exit_settlements, whose RLS is admin ∨ coordinator ∨
--    fms_exit_is_finance_staff ∨ the-leaver-after-approval (M6). The owner of the
--    `documents` / `archive` steps is EXIT STAFF, and exit staff is NOT finance staff —
--    so PostgREST hands them ZERO ROWS from that table and a client-side checklist
--    would confidently tell them the final F&F copy is missing when it is sitting right
--    there. They would go and ask payroll to upload it again.
--
--    So the DATABASE computes the checklist, in a SECURITY DEFINER function that returns
--    SENTENCES AND NOT ONE NUMBER — no amount, no mode, no UTR, nothing the M6 gate
--    exists to withhold. The panel renders exactly what the RPC will check, because it
--    IS what the RPC checks: fms_exit_archive_case calls this and refuses on its output.
--    The blocker list and the refusal can never drift apart, which is the whole point.
--
-- ⚠ EVERY STEP GUARD IS `fms_exit_step_done` — TIMESTAMP **OR SKIPPED**. THE ABSCONDER
--   PATH: no handover, no relieving letter, no F&F to pay. Those steps are skipped with
--   a reason, and this returns an EMPTY array. A guard on the raw timestamps would wedge
--   that case forever, and it is not a rare one.
--
-- ⚠ EVERY APPEND IS `array_append`, NEVER `v_blocked || '…'`. `text[] || <unknown
--   literal>` resolves to anyarray || ANYARRAY, not to array_append: Postgres tries to
--   parse the sentence as an array literal and dies with `malformed array literal: "the
--   full & final settlement has not been paid…"`. The refusal message would then be
--   REPLACED BY A PARSER ERROR — the one thing this code exists to get right, destroyed
--   by an operator-resolution rule. (It did exactly that on the first acceptance run.)
-- ===========================================================================
create or replace function public.fms_exit_archive_blockers(p_case uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_blocked  text[] := '{}';
  v_missing  text;
  v_n        integer;
  v_final    text;
begin
  if not exists (select 1 from public.fms_exit_cases where id = p_case) then
    raise exception 'Exit case not found';
  end if;
  -- It hands out no figures, but it does describe someone's exit. The case's own read
  -- gate is the right one — and it is true for every person who could ever press Archive.
  if not public.fms_exit_can_read_case(p_case, auth.uid()) then
    raise exception 'Not authorized to read this exit case';
  end if;

  -- ---- 1. CLEARANCE ------------------------------------------------------
  if not public.fms_exit_step_done(p_case, 'clearance') then
    select count(*) into v_n
      from public.fms_exit_clearance_checks
     where case_id = p_case and not done and not not_applicable;
    v_blocked := array_append(v_blocked, format(
      'the departmental clearance is not complete (%s item%s still outstanding — clear them, mark them not-applicable, or waive the clearance step with a reason)',
      v_n, case when v_n = 1 then '' else 's' end));
  end if;

  -- ---- 2. THE F&F --------------------------------------------------------
  if not public.fms_exit_step_done(p_case, 'fnf_payment') then
    v_blocked := array_append(v_blocked,
      'the full & final settlement has not been paid (release the payment, or waive the step with a reason)');
  end if;

  -- ---- 3. THE DOCUMENTS --------------------------------------------------
  if not public.fms_exit_step_done(p_case, 'documents') then
    select string_agg(name, ', ' order by sort_order, name) into v_missing
      from public.fms_exit_documents where case_id = p_case and issued_on is null;
    v_blocked := array_append(v_blocked, format(
      'the exit documents have not been issued (%s)',
      coalesce('still to issue: ' || v_missing, 'no documents have been prepared at all')));
  end if;

  -- ---- 4. ⭐ THE SIGNED ACKNOWLEDGEMENT — for every document ACTUALLY ISSUED.
  --      Not for the ones that were never issued: on a termination the relieving letter
  --      is legitimately never sent, and demanding a signature for it would wedge the
  --      case exactly as a raw-timestamp guard would.
  select string_agg(name, ', ' order by sort_order, name) into v_missing
    from public.fms_exit_documents
   where case_id = p_case and issued_on is not null and ack_signed_path is null;
  if v_missing is not null then
    v_blocked := array_append(v_blocked, format(
      'the signed acknowledgement has not come back for: %s (attach the signed copy the employee returned)', v_missing));
  end if;

  -- ---- 5. ⭐ THE LEAVER'S OWN COPY OF THE FINAL F&F -----------------------
  --      Under share/, which is the only prefix they can open. Waived only if the
  --      PAYMENT step itself was skipped — no payment, no statement to hand over.
  --      ⚠ Read from INSIDE this SECURITY DEFINER function precisely because the person
  --        who has to act on it cannot read fms_exit_settlements themselves. See header.
  if not exists (select 1 from public.fms_exit_step_skips
                  where case_id = p_case and step_key = 'fnf_payment') then
    select final_fnf_path into v_final from public.fms_exit_settlements where case_id = p_case;
    if v_final is null then
      v_blocked := array_append(v_blocked,
        'the employee''s own copy of the final full & final has not been attached (it goes under cases/<id>/share/ — they are entitled to their statement, and it is the one prefix they can open)');
    end if;
  end if;

  return v_blocked;
end $$;
comment on function public.fms_exit_archive_blockers(uuid) is
  'Why this exit cannot be archived yet, as sentences — the LIVE checklist the Documents panel renders, and the exact set fms_exit_archive_case refuses on (it calls this). SECURITY DEFINER because condition 5 reads fms_exit_settlements.final_fnf_path, which the `documents`/`archive` step owner CANNOT read (they are exit staff, not finance staff) — it returns words, never a figure.';
grant execute on function public.fms_exit_archive_blockers(uuid) to authenticated;

-- ===========================================================================
-- ⭐⭐⭐ RPC — ARCHIVE THE CASE. THE TERMINAL ACT, AND IT REFUSES.
--
-- The five conditions live in fms_exit_archive_blockers (above) — one implementation,
-- so the checklist on the screen and the refusal from the database cannot drift apart.
-- They are raised TOGETHER rather than one at a time, because "fix this, click again,
-- fix the next thing, click again" is how a person gives up and asks an admin to force
-- it through.
--
-- On success: archived_at, status = 'archived', and system_status_changed = true — the
-- sheet's "Status Change in System" / "Employee Archived". It is a MANUAL FLAG because
-- there is no HRMS here to call; setting it as part of the terminal act is what stops it
-- being a checkbox nobody ever ticks.
--
-- ⚠ AN ARCHIVED CASE LEAVES EVERY QUEUE AND EVERY COUNT. `isOpenCase()` in
--   lib/queues.ts excludes 'archived' (CONFIRMED at line 141, not assumed), so
--   openSteps() returns [] and buildQueueEntries emits nothing for it — the Dashboard,
--   every step queue, the Exit Control Center and the cross-FMS scoreboard all go quiet
--   at once, because all four read the same aggregator.
-- ===========================================================================
drop function if exists public.fms_exit_archive_case(uuid, jsonb);
create or replace function public.fms_exit_archive_case(p_case uuid, p jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_no       text;
  v_name     text;
  v_emp      uuid;
  v_blocked  text[];
begin
  select status, exit_no, employee_name, employee_user_id
    into v_status, v_no, v_name, v_emp
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('archive', p_case, v_uid) then
    raise exception 'Not authorized to archive this exit case';
  end if;
  if v_status = 'archived' then
    raise exception 'This exit case is already archived';
  end if;
  if v_status in ('withdrawn','rejected') then
    raise exception 'This exit case is % — it was never completed, and it is not archived, it is closed', v_status;
  end if;
  if v_status = 'on_hold' then
    raise exception 'This exit case is on hold — take it off hold before archiving it';
  end if;

  -- ⭐ THE SAME CHECK THE SCREEN SHOWED THEM. One implementation, by construction.
  v_blocked := public.fms_exit_archive_blockers(p_case);
  if cardinality(v_blocked) > 0 then
    raise exception 'This exit cannot be archived yet — %', array_to_string(v_blocked, '; and ');
  end if;

  update public.fms_exit_cases set
    archived_at           = now(),
    status                = 'archived',
    current_step          = 'archive',
    -- The sheet's "Status Change in System" / "Employee Archived". A manual flag: there
    -- is no HRMS to integrate with, and a flag set by the terminal act is a flag that
    -- actually gets set.
    system_status_changed = true,
    clearance_remarks     = coalesce(nullif(trim(p->>'remarks'), ''), clearance_remarks)
  where id = p_case;

  perform public.fms_exit_announce(
    'case', p_case, 'archived',
    v_no || ' (' || v_name || ') — the exit is complete and the case is archived. Every document was issued and acknowledged.',
    (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
      || public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('hr_head_approval'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_archive_case(uuid, jsonb) to authenticated;
