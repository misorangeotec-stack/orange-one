-- ===========================================================================
-- PRODUCTION ENTRY FMS — round-aware EDIT of the material handover.
--
-- fms_production_record_material_handover is already round-aware: when an
-- Additional Issue Slip round is open (its mh_done is false) it writes the top-up
-- handover into that round instead of the base mh_* columns. But the EDIT path
-- (fms_production_update_material_handover) always wrote the base columns — so
-- correcting an ADDITIONAL handover both showed and overwrote the ORIGINAL lines.
--
-- Fix: when the latest AIS round's handover is recorded (mh_done) but its RM
-- transfer hasn't happened yet (rmt_done false) — i.e. the handover currently
-- editable-until-next is the round's — the edit corrects that round's mh_lines.
-- Otherwise it corrects the base handover exactly as before.
--
-- Purely a function replace; no schema change. Additive/reversible.
-- ===========================================================================

create or replace function public.fms_production_update_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_lines jsonb := coalesce(p->'mh_bom_lines', '[]'::jsonb);
  v_sum numeric;
  v_rounds jsonb; v_n int; v_ais boolean; v_last jsonb;
begin
  select status, req_no, ais_rounds into v_status, v_no, v_rounds
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then
    raise exception 'Not authorized to edit the material handover'; end if;
  if not public.fms_production_mh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The material handover can no longer be edited: the RM transfer has already been recorded (status %).', v_status;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'mh_bom_lines must be a JSON array'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  -- The editable-until-next handover belongs to the latest AIS round when that
  -- round's handover is recorded (mh_done) but its RM transfer isn't (rmt_done).
  v_ais := v_n > 0
       and coalesce((v_rounds->(v_n-1)->>'mh_done')::boolean, false) = true
       and coalesce((v_rounds->(v_n-1)->>'rmt_done')::boolean, false) = false;

  if v_ais then
    v_last := (v_rounds->(v_n-1)) || jsonb_build_object('mh_lines', v_lines);
    update public.fms_production_requests set
      ais_rounds = jsonb_set(v_rounds, array[(v_n-1)::text], v_last),
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  else
    v_sum := public.fms_production_mh_lines_sum(v_lines);
    update public.fms_production_requests set
      mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, mh_actual_date),
      mh_status      = nullif(trim(p->>'mh_status'), ''),
      mh_bom_lines   = v_lines,
      mh_qty         = coalesce(v_sum, nullif(p->>'mh_qty','')::numeric),
      mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;

  perform public.fms_production_announce('request', p_req, 'material_handover_edited',
    format('Material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_material_handover(uuid, jsonb) to authenticated;
