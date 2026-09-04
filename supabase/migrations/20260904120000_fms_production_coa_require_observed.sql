-- PE-7 · A certificate may not be issued with a blank reading.
--
-- WHAT WENT WRONG. The COA went live on 02-09-2026 and two certificates were
-- issued with readings missing inside forty-eight hours:
--
--   lot 2608-1333  02-09-2026 16:56 IST   0 of 9 observed values
--   lot 2608-1314  03-09-2026             3 of 9 observed values
--
-- Nobody did anything wrong: the form opened, it saved, and nothing objected.
-- `fms_production_save_coa` checked the issue date, the card type, the round and
-- the caller's right to act, and then wrote whatever `lines` it was handed. The
-- modal even showed "0 of 9 observed" next to the table -- it reported the gap
-- and had no power to stop it.
--
-- A Certificate of Analysis is a claim, given to a customer, that a lot was
-- tested against nine standards. A blank reading makes that claim with no
-- evidence behind it, on a document that looks exactly like a real one.
--
-- THE GUARD, and its two deliberate edges:
--
--   1. It applies to a REJECTED round as well. Those readings are the evidence
--      FOR the rejection -- a failed lot needs them more than a passed one, not
--      less. PE-5 item A opened the certificate to failed and unrecorded rounds
--      on purpose; this does not narrow that, it only insists the readings are
--      there.
--
--   2. Blank is refused, but a NUMBER is not demanded. `observed` is free text,
--      so a test genuinely not run is typed -- "N/A", "Not tested", "sample
--      insufficient" -- and the certificate then says what happened instead of
--      saying nothing. Refusing emptiness is not the same as forcing a figure,
--      and the difference matters on a document somebody signs.
--
-- A certificate with NO lines at all is refused for the same reason, separately
-- worded: it is the same fault seen from the other end, and the modal already
-- declines to work without active parameters.
--
-- WHAT THIS DOES NOT DO. Nothing is written, corrected or back-filled. Lot
-- 2608-1314 keeps its three blanks and stays exactly as issued -- rewriting a
-- certificate that may already be in a customer's hands is the one thing this
-- module is built never to do (see 20260901120000's header). Editing it from the
-- screen will now require the blanks to be filled, which is the right moment for
-- a person to decide what belongs there.
--
-- Mirrored in the client at CoaModal.tsx (`missingObserved`), which names the
-- offending rows so the fix is one click away rather than a round trip. This is
-- the authority; that is the courtesy.
--
-- Body is otherwise IDENTICAL to 20260902130000's. Additive: no table, column or
-- row is touched.

create or replace function public.fms_production_save_coa(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid := nullif(p->>'request_id', '')::uuid;
  v_coa_in  uuid := nullif(p->>'coa_id', '')::uuid;
  v_today   date;
  v_issue   date;
  v_lines   jsonb := coalesce(p->'lines', '[]'::jsonb);
  v_push    jsonb := coalesce(p->'push_standards', '[]'::jsonb);
  v_std     jsonb;
  v_pid     uuid;
  v_pname   text;
  v_old     text;
  v_new     text;
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
  v_blank   int;
  v_names   text;
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

  -- NEW (PE-7). Placed AFTER the permission check on purpose: a caller with no
  -- right to be here should be told that, not handed a critique of their data.
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'A certificate cannot be issued with no test results on it.';
  end if;

  select count(*), string_agg(coalesce(l->>'name', '?'), ', ')
    into v_blank, v_names
    from jsonb_array_elements(v_lines) l
   where coalesce(btrim(l->>'observed'), '') = '';

  if v_blank > 0 then
    raise exception
      'Every reading must be filled in before a certificate can be issued. % of % are blank: %. If a test was not run, say so in the box rather than leaving it empty.',
      v_blank, jsonb_array_length(v_lines), v_names;
  end if;

  -- WHICH ROUND. An explicit coa_id means "correct THIS certificate", and it
  -- keeps its own round; anything else is the round currently being tested (or
  -- the last one tested). See 20260902120000's header.
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
    (request_id, round, product_name, lot_no, issue_date, conclusion, remarks,
     attachment_path, attachment_name, lines, qc_result, issued_by, updated_by)
  values
    (v_req, v_round, v_product, v_lot, v_issue,
     nullif(btrim(p->>'conclusion'), ''),
     nullif(btrim(p->>'remarks'), ''),
     nullif(btrim(p->>'attachment_path'), ''),
     nullif(btrim(p->>'attachment_name'), ''),
     v_lines, v_result, v_uid, v_uid)
  on conflict (request_id, round) do update
    set product_name = excluded.product_name,
        lot_no       = excluded.lot_no,
        issue_date   = excluded.issue_date,
        conclusion   = excluded.conclusion,
        remarks      = excluded.remarks,
        lines        = excluded.lines,
        -- Keyed on PRESENCE, not on value. An edit that uploads no new file
        -- sends no key at all, and the stored copy must survive it.
        attachment_path = case when p ? 'attachment_path'
                               then excluded.attachment_path
                               else fms_production_coas.attachment_path end,
        attachment_name = case when p ? 'attachment_name'
                               then excluded.attachment_name
                               else fms_production_coas.attachment_name end,
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

  -- Push edited standards back to the COA-parameter master.
  --
  -- ⚠ AFTER the certificate is written, deliberately: a save that fails for any
  --   reason must not leave a master edited behind it. The certificate keeps its
  --   own frozen copy either way, so the two can never disagree about what was
  --   printed.
  if jsonb_typeof(v_push) = 'array' then
    for v_std in select value from jsonb_array_elements(v_push) loop
      v_pid := nullif(v_std->>'parameter_id', '')::uuid;
      if v_pid is null then continue; end if;

      v_new   := nullif(btrim(v_std->>'standard'), '');
      v_pname := null;
      v_old   := null;
      select name, standard into v_pname, v_old
        from public.fms_production_coa_parameters where id = v_pid;
      -- A parameter deleted meanwhile, or a value that is already what the
      -- master holds: no write, and no trail for a change that did not happen.
      if v_pname is null then continue; end if;
      if v_new is not distinct from v_old then continue; end if;

      -- FULLY QUALIFIED on the row id. An unqualified update is refused.
      update public.fms_production_coa_parameters
         set standard = v_new
       where id = v_pid;

      insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
      values ('request', v_req, 'coa_standard_updated', v_uid,
              'Standard for "' || v_pname || '" updated in the master: ' ||
                coalesce(v_old, '(blank)') || ' → ' || coalesce(v_new, '(blank)'),
              jsonb_build_object('parameter_id', v_pid, 'parameter', v_pname,
                                 'from', v_old, 'to', v_new,
                                 'coa_id', v_id, 'lot_no', v_lot));
    end loop;
  end if;

  return v_id;
end $function$;
