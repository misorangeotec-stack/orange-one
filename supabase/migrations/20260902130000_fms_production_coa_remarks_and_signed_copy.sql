-- ===========================================================================
-- PRODUCTION ENTRY FMS — COA: internal-only REMARKS, an uploaded SIGNED COPY,
-- and an edited standard that can be pushed back to the master.
--
-- PE-5 items D, F (the upload half) and C, decided with the client 02-Sep-2026.
-- Purely ADDITIVE: three nullable columns and one function body. Nothing is
-- dropped, no constraint is widened, and it re-runs safely.
--
--   D  remarks         — free text on the certificate, printed on the INTERNAL
--                        copy only. ⚠ The audience rule lives in the FRONTEND's
--                        coaVm.ts, behind the same `showsOn` switch the line rows
--                        use — the database stores one value and does not know
--                        which copy is being printed, exactly as it does not for
--                        the lines.
--   F  attachment_*    — a signed or scanned copy attached to the certificate,
--                        in the fms-production-docs bucket under
--                        <request_id>/coa/, the same path shape every step
--                        attachment in this module already uses.
--   C  push_standards  — the COA form may push an edited Standard back to the
--                        COA-parameter master.
--
-- ⚠ WHY C IS AN RPC AND NOT A TABLE WRITE. Two refusals would stop the obvious
--   `db.from('fms_production_coa_parameters').update(...)`:
--     · RLS on that table admits only an admin or a 'coa_parameter' master
--       manager, and the client's decision is that ANYONE WHO MAY ISSUE A COA
--       may push — a Quality Checking step owner is usually neither; and
--     · fms_production_activity is admin-write only, so the trail could not be
--       written from the browser at all.
--   Both run here instead, under the same fms_production_can_act('quality_check')
--   check the decision names — which is precisely `is_admin OR is_coordinator OR
--   is_step_owner`. The update is FULLY QUALIFIED on the parameter row id;
--   PostgREST refuses an unqualified one, and a rollback-wrapped SQL test would
--   never have shown it.
--
-- ⚠ THIS IS THE ONLY PLACE IN THE MODULE WHERE A MASTER CHANGES OUTSIDE Masters
--   OR A MASTER REQUEST, which is why every push writes an activity row naming
--   who changed which standard, from what to what. Without it a standard that
--   quietly drifts has no trail and the next argument about a certificate has no
--   answer.
--
-- ⚠ A PUSH NEVER TOUCHES A CERTIFICATE ALREADY ISSUED. `lines` is a frozen jsonb
--   snapshot per COA and is never re-read from the masters. Nobody should later
--   "helpfully" back-fill issued rows to match a corrected master.
--
-- Reversal (reverse order):
--   -- restore fms_production_save_coa from
--   -- 20260902120000_fms_production_coa_per_round.sql
--   alter table public.fms_production_coas drop column if exists attachment_name;
--   alter table public.fms_production_coas drop column if exists attachment_path;
--   alter table public.fms_production_coas drop column if exists remarks;
-- ===========================================================================

alter table public.fms_production_coas add column if not exists remarks         text;
alter table public.fms_production_coas add column if not exists attachment_path text;
alter table public.fms_production_coas add column if not exists attachment_name text;

comment on column public.fms_production_coas.remarks is
  'Free text about this batch, printed on the INTERNAL copy only so staff can write plainly without a customer reading it. The audience rule is enforced in the frontend view model (coaVm.ts), behind the same switch the line rows use - the database stores one value.';
comment on column public.fms_production_coas.attachment_path is
  'Storage object path in fms-production-docs of a signed/scanned copy of this certificate (<request_id>/coa/...). Optional, and there is no in-app way to remove one once attached.';

-- ---------------------------------------------------------------------------
-- fms_production_save_coa — body from 20260902120000_fms_production_coa_per_round.sql.
--
-- Unchanged and load-bearing: the repackaging refusal, the "has not reached
-- quality checking" refusal, the round rule, the coa_id correction path and the
-- per-round verdict stamp. THREE additions, each marked NEW:
--   · remarks, saved like conclusion (always sent by the form);
--   · attachment_path / attachment_name, keyed on PRESENCE — an edit that
--     uploads no new file must keep the stored one, the same rule
--     fms_production_update_quality follows;
--   · push_standards, applied AFTER the certificate is written so a failed save
--     cannot leave a master edited.
--
--    p = { request_id, coa_id?, issue_date?, conclusion?, remarks?,
--          attachment_path?, attachment_name?,
--          push_standards?: [ { parameter_id, standard } ],
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
  v_push    jsonb := coalesce(p->'push_standards', '[]'::jsonb);  -- NEW (C)
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
     nullif(btrim(p->>'remarks'), ''),                                    -- NEW (D)
     nullif(btrim(p->>'attachment_path'), ''),                            -- NEW (F)
     nullif(btrim(p->>'attachment_name'), ''),
     v_lines, v_result, v_uid, v_uid)
  on conflict (request_id, round) do update
    set product_name = excluded.product_name,
        lot_no       = excluded.lot_no,
        issue_date   = excluded.issue_date,
        conclusion   = excluded.conclusion,
        remarks      = excluded.remarks,
        lines        = excluded.lines,
        -- NEW (F): keyed on PRESENCE, not on value. An edit that uploads no new
        -- file sends no key at all, and the stored copy must survive it.
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

  -- NEW (C): push edited standards back to the COA-parameter master.
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
end $$;
comment on function public.fms_production_save_coa(jsonb) is
  'Issue or correct the Certificate of Analysis for one TEST ROUND of a job card. The round is stamped from the card, never sent; pass coa_id to correct a specific certificate. Carries the internal-only remarks and an optional signed-copy attachment (keyed on presence, so an edit without a new file keeps the stored one), and may push edited standards back to the COA-parameter master - the only place in the module where a master changes outside Masters, so every push writes an activity row. A rejected or not-yet-recorded round may be certified; a repackaging card, and a card that has not reached quality checking, may not.';
grant execute on function public.fms_production_save_coa(jsonb) to authenticated;
