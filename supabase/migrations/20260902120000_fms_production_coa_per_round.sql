-- ===========================================================================
-- PRODUCTION ENTRY FMS — THE COA MOVES INTO THE QUALITY CHECK.
--   One certificate per (job card, TEST ROUND), and a REJECTED round gets one too.
--
-- WHAT CHANGES, AND WHY (PE-5 items A and F, decided with the client 02-Sep-2026)
--
--   1. A COA may now be saved on a round that was REJECTED — and before the
--      verdict is picked at all. ⚠ The reasoning is load-bearing, because the
--      code below will look wrong to whoever reads it next: THE COA FORM IS THE
--      TEST-RESULTS RECORD, not only the certificate. The observed values on a
--      failed lot are real measurements and are the evidence for the rejection;
--      throwing them away because the verdict went the other way loses the lab's
--      actual work. The paper then says the lot failed (a watermark plus a
--      Result line — see the frontend's coaVm/coaPdf/coaXlsx/printCoa).
--
--   2. `request_id` stops being unique. Quality Checking is multi-round: a
--      rejected lot loops through the Additional Issue Slip and comes back as
--      Test 2. Test 1 KEEPS what it issued and Test 2 gets its own row, because
--      a certificate that may already be in a customer's hands must never be
--      silently overwritten by a later test. This REVERSES PE-3's decision 3
--      ("edited in place, never re-issued"), deliberately.
--
-- ⚠ WHICH ROUND A COA BELONGS TO IS STAMPED HERE, NEVER SENT BY THE CLIENT —
--   otherwise two certificates could claim the same test. The rule, mirrored in
--   frontend/src/apps/production-entry/lib/coaRound.ts:
--
--       current_step = 'quality_check'  ->  rounds_recorded + 1   (test underway)
--       otherwise                       ->  max(rounds_recorded, 1)  (last test)
--
--   `current_step` and NOT `status`, because a held card carries
--   status = 'on_hold' while current_step stays where it was. The two are set
--   together at every transition, so the hold is the only case where they
--   disagree — which is exactly the case this survives.
--
--   When an EXISTING certificate is being corrected the client sends `coa_id`
--   and this function keeps that row's stored round. That is what stops
--   "correct Test 1 while Test 2 is open" from silently minting a duplicate.
--
-- ⚠ THE VERDICT IS FROZEN ONTO THE CERTIFICATE, per round, exactly as the
--   standards already are. Re-reading qc_status at print time would relabel a
--   Test 1 certificate the moment Test 2 changed the verdict. Two writers stamp
--   it and they agree:
--     - fms_production_save_coa reads THAT ROUND's own record (qc_rounds[n-1]),
--       which is null when the certificate is entered before Approve/Reject;
--     - fms_production_record_quality stamps the round it has just recorded, so
--       a certificate entered first is labelled the moment the verdict exists.
--
-- ADDITIVE except for two things PE-5 sanctions explicitly: the unique-key swap
-- and the round back-fill. No column is dropped and no row is lost. Every
-- statement is idempotent.
--
-- Reversal (reverse order):
--   -- restore fms_production_record_quality + fms_production_save_coa from
--   -- 20260729120200_fms_production_additional_issue_slip.sql and
--   -- 20260901120000_fms_production_coa.sql respectively
--   drop index if exists public.fms_production_coas_request_round_uidx;
--   alter table public.fms_production_coas
--     add constraint fms_production_coas_request_id_key unique (request_id);
--     -- (fails if a second round has been issued; delete those rows first)
--   alter table public.fms_production_coas drop column if exists qc_result;
--   alter table public.fms_production_coas drop column if exists round;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. round — which test this certificate is for.
--
--    ⚠ EVERY EXISTING COA IS BACK-FILLED TO ROUND 1, the three sample ones on
--      lots 2608-1344 / 2608-1342 / 2608-1339 included. Left null they would
--      sort and group as an unlabelled fourth thing next to Test 1 and Test 2.
-- ---------------------------------------------------------------------------
alter table public.fms_production_coas add column if not exists round integer;
update public.fms_production_coas set round = 1 where round is null;
alter table public.fms_production_coas alter column round set default 1;
alter table public.fms_production_coas alter column round set not null;

comment on column public.fms_production_coas.round is
  'Which quality test round this certificate is for (1 = the first test). Stamped by fms_production_save_coa from the card, never chosen by the caller. Unique per (request_id, round): Test 1 keeps what it issued, Test 2 gets its own row.';

-- ---------------------------------------------------------------------------
-- 2. qc_result — the verdict of THAT ROUND, frozen onto the certificate.
--
--    ⚠ Back-filled from the card's own round record, NOT from qc_status. Left
--      null, every certificate already issued — including the three the
--      production team is about to audit — would print as NOT VERIFIED.
-- ---------------------------------------------------------------------------
alter table public.fms_production_coas add column if not exists qc_result text;
alter table public.fms_production_coas drop constraint if exists fms_production_coas_qc_result_check;
alter table public.fms_production_coas add constraint fms_production_coas_qc_result_check
  check (qc_result is null or qc_result in ('approved','rejected'));

update public.fms_production_coas c
   set qc_result = r.qc_rounds->(c.round - 1)->>'result'
  from public.fms_production_requests r
 where r.id = c.request_id
   and c.qc_result is null
   and (r.qc_rounds->(c.round - 1)->>'result') in ('approved','rejected');

comment on column public.fms_production_coas.qc_result is
  'approved | rejected | null — the verdict of THIS ROUND''s test, frozen at save. Null means the round had not been recorded when the certificate was entered; fms_production_record_quality stamps it as soon as the verdict exists. Never re-read from requests.qc_status, which mirrors the LATEST round and would relabel an old certificate.';

-- ---------------------------------------------------------------------------
-- 3. request_id stops being unique; the PAIR becomes unique.
--
--    ⚠ The constraint is found by its COLUMN LIST, not by a guessed name — it
--      was created implicitly by `request_id uuid not null unique`, so its name
--      is a Postgres convention rather than something this repo chose.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'fms_production_coas'
       and con.contype = 'u'
       and (select array_agg(att.attname::text order by att.attnum)
              from pg_attribute att
             where att.attrelid = con.conrelid
               and att.attnum = any(con.conkey)) = array['request_id']
  loop
    execute format('alter table public.fms_production_coas drop constraint %I', c.conname);
  end loop;
end $$;

-- A unique INDEX, not a constraint: `on conflict (request_id, round)` below
-- needs one on exactly these columns, and an index satisfies it.
create unique index if not exists fms_production_coas_request_round_uidx
  on public.fms_production_coas (request_id, round);

comment on table public.fms_production_coas is
  'Certificate of Analysis, one per (job card, test round) - Test 1 keeps what it issued, a re-test gets its own row. Written only through fms_production_save_coa.';

-- ---------------------------------------------------------------------------
-- 4. fms_production_save_coa — issue or correct one round's certificate.
--
--    Body from 20260901120000_fms_production_coa.sql. What changed:
--      - the "quality check must be approved" guard is GONE (see the header);
--      - ⚠ THE REPACKAGING REFUSAL DIRECTLY ABOVE IT STAYS. A repackaging card
--        runs no quality check at all, so it has no test to record. The two sat
--        together and only one goes;
--      - a replacement refusal in that same spirit: a card that has not REACHED
--        quality checking has no test to certify either. Without it, dropping
--        the approved-guard would let a certificate be issued against a lot
--        nobody has tested;
--      - the round is computed, `coa_id` is accepted for an in-place correction,
--        the verdict is stamped, and the upsert keys on the pair.
--
--    p = { request_id, coa_id?, issue_date?, conclusion?,
--          lines: [ { parameter_id?, name, standard?, observed?,
--                     equipment_id?, equipment_name?, appears_on?, sort_order? } ] }
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_save_coa(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid := nullif(p->>'request_id', '')::uuid;
  v_coa_in  uuid := nullif(p->>'coa_id', '')::uuid;
  v_today   date;
  v_issue   date;
  v_lines   jsonb := coalesce(p->'lines', '[]'::jsonb);
  v_product text;
  v_lot     text;
  v_type    text;
  v_step    text;
  v_rounds  jsonb;
  v_n       int;
  v_round   int;
  v_result  text;
  v_id      uuid;
  v_existed boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_req is null then raise exception 'A job card is required'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'lines must be a JSON array'; end if;

  select fg.name, r.jobcard_no, r.card_type, r.current_step, coalesce(r.qc_rounds, '[]'::jsonb)
    into v_product, v_lot, v_type, v_step, v_rounds
    from public.fms_production_requests r
    left join public.fms_production_fg_items fg on fg.id = r.fg_item_id
   where r.id = v_req;

  if not found then raise exception 'Job card % not found', v_req; end if;

  -- A repackaging card bypasses Quality Check entirely, so it can never have a
  -- test to certify. Checked explicitly rather than relying on the round count,
  -- so the refusal says WHY.
  if v_type = 'repackaging' then
    raise exception 'A repackaging card does not run quality checking, so it has no COA.';
  end if;

  v_n := jsonb_array_length(v_rounds);

  -- The replacement for the old approved-only guard: a lot that has not reached
  -- quality checking has nothing to certify. A REJECTED or not-yet-recorded
  -- round is allowed through on purpose — that is the whole of PE-5 item A.
  if v_n = 0 and v_step is distinct from 'quality_check' then
    raise exception 'This job card has not reached quality checking yet, so there is no test to certify.';
  end if;

  if not public.fms_production_can_act('quality_check', v_req, v_uid) then
    raise exception 'Only an owner of the Quality Checking step can issue or edit a COA.';
  end if;

  -- WHICH ROUND. An explicit coa_id means "correct THIS certificate", and it
  -- keeps its own round; anything else is the round currently being tested (or
  -- the last one tested). See the header.
  if v_coa_in is not null then
    select id, round into v_id, v_round
      from public.fms_production_coas
     where id = v_coa_in and request_id = v_req;
    if v_id is null then
      raise exception 'That certificate does not belong to this job card.';
    end if;
  else
    v_round := case when v_step = 'quality_check' then v_n + 1 else greatest(v_n, 1) end;
  end if;

  -- The verdict of THAT round, frozen on. Null while the round is still being
  -- recorded — fms_production_record_quality stamps it a moment later.
  v_result := v_rounds->(v_round - 1)->>'result';
  if v_result is not null and v_result not in ('approved','rejected') then
    v_result := null;
  end if;

  -- The issue date may be BACK-dated but never post-dated, and "today" is IST.
  -- The database runs in UTC, so `current_date` would let a 05:00-IST caller
  -- post-date by a day. Same guard as fms_production_submit_request.
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := coalesce(nullif(trim(p->>'issue_date'), '')::date, v_today);
  if v_issue > v_today then
    raise exception 'The COA issue date cannot be in the future.';
  end if;

  select id into v_id from public.fms_production_coas
   where request_id = v_req and round = v_round;
  v_existed := v_id is not null;

  insert into public.fms_production_coas
    (request_id, round, product_name, lot_no, issue_date, conclusion, lines, qc_result, issued_by, updated_by)
  values
    (v_req, v_round, v_product, v_lot, v_issue,
     nullif(btrim(p->>'conclusion'), ''), v_lines, v_result, v_uid, v_uid)
  on conflict (request_id, round) do update
    set product_name = excluded.product_name,
        lot_no       = excluded.lot_no,
        issue_date   = excluded.issue_date,
        conclusion   = excluded.conclusion,
        lines        = excluded.lines,
        -- Only ever fills a blank in: a verdict already stamped by
        -- record_quality is this round's own and must not be re-derived.
        qc_result    = coalesce(fms_production_coas.qc_result, excluded.qc_result),
        updated_by   = v_uid
  returning id into v_id;

  -- Activity only: entity_type stays 'request' (a COA belongs to its job card),
  -- so nothing else has to learn a new entity type. No notification fan-out —
  -- issuing a certificate is not somebody else's cue to act.
  insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
  values ('request', v_req,
          case when v_existed then 'coa_updated' else 'coa_issued' end,
          v_uid, null,
          jsonb_build_object('coa_id', v_id, 'lot_no', v_lot, 'issue_date', v_issue, 'round', v_round));

  return v_id;
end $$;
comment on function public.fms_production_save_coa(jsonb) is
  'Issue or correct the Certificate of Analysis for one TEST ROUND of a job card. The round is stamped from the card, never sent; pass coa_id to correct a specific certificate. A rejected or not-yet-recorded round may be certified (the paper says so); a repackaging card, and a card that has not reached quality checking, may not. Caller must be an admin, a process coordinator or a Quality Checking step owner. Product name and lot number are read from the card, never from the payload.';
grant execute on function public.fms_production_save_coa(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. fms_production_record_quality — body VERBATIM from
--    20260729120200_fms_production_additional_issue_slip.sql (the latest of the
--    three definitions), plus ONE statement, marked CHANGED.
--
--    ⚠ That statement is what makes "enter the certificate, then press Reject"
--      work. The certificate is saved before the verdict exists, so the thing
--      that decides the verdict writes it — once, onto that round's row only.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_rounds jsonb; v_round int; v_result text; v_date date; v_datein text;
begin
  select status, req_no, qc_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_quality' then raise exception 'This job card is not awaiting quality checking (status %)', v_status; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to record quality checking'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_round  := jsonb_array_length(v_rounds) + 1;

  v_result := lower(nullif(trim(p->>'qc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected') then raise exception 'Choose Approve or Reject'; end if;

  v_datein := nullif(trim(p->>'qc_test_date'), '');
  v_date := coalesce(v_datein::date, current_date);

  update public.fms_production_requests set
    qc_rounds = v_rounds || jsonb_build_object(
      'round', v_round, 'test_date', v_date, 'result', v_result,
      'remarks', nullif(trim(p->>'qc_remarks'), ''),
      'attachment_path', nullif(trim(p->>'qc_attachment_path'), ''),
      'attachment_name', nullif(trim(p->>'qc_attachment_name'), '')),
    qc_actual_date = v_date,
    qc_status = v_result,
    qc_remarks = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = nullif(trim(p->>'qc_attachment_path'), ''),
    qc_attachment_name = nullif(trim(p->>'qc_attachment_name'), ''),
    qc_by = v_uid
  where id = p_req;

  -- CHANGED: stamp the verdict onto THIS ROUND's certificate, if one was
  -- entered before Approve/Reject was pressed. Per round, never card-wide — a
  -- later test must not relabel an earlier certificate.
  update public.fms_production_coas
     set qc_result = v_result
   where request_id = p_req and round = v_round;

  if v_result = 'approved' then
    update public.fms_production_requests set
      qc_at = coalesce(qc_at, now()), qc_retest_due = null,
      status = 'awaiting_transfer_slip', current_step = 'transfer_slip'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_check',
      'Quality checking approved for ' || coalesce(v_no,'a job card') || ' (Test ' || v_round || ') — ready for the log book entry.',
      public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
  else
    -- Rejected: raise an additional issue slip; the returning re-test is due +2 days.
    update public.fms_production_requests set
      qc_retest_due = v_date + 2,
      status = 'awaiting_additional_issue_slip', current_step = 'additional_issue_slip'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_rejected',
      'Quality Test ' || v_round || ' rejected for ' || coalesce(v_no,'a job card') ||
      ' — raise an additional issue slip (re-test due ' || to_char(v_date + 2, 'DD-MM-YYYY') || ').',
      public.fms_production_step_owner_ids('additional_issue_slip'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_quality(uuid, jsonb) to authenticated;
