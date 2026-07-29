-- ===========================================================================
-- PRODUCTION ENTRY FMS — master requests raised INLINE from the pickers.
--
-- Until now a missing master meant leaving a half-filled issue slip and going
-- to the Master Requests page. The forms now offer "Request new <master>" right
-- inside the dropdown (the pattern the two purchase FMS apps already use), which
-- exposes three gaps this migration closes:
--
--   1. Raw materials and FG items each carry their OWN unit (it drives the Unit
--      column on every job card), but the resolve RPC inserted `name` only — so
--      an approved request landed unit-less and every BOM line using it showed
--      "-". Only the packaging_item branch read unit_id. Both other branches now
--      do the same.
--   2. No pending-duplicate guard existed (Purchase / Import / HR all have one),
--      so two people raising the same name in the same minute both got a row.
--   3. fms_production_email_payload's master label had no 'packaging_item' arm,
--      so packaging requests emailed as "category".
--
-- Additive: no table or column is altered, no data is rewritten. Both functions
-- are replaced with their existing bodies plus the changes noted inline.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Resolve a master request — raw_material / fg_item now carry unit_id.
--    Body from 20260728210000_fms_production_packaging.sql; the two insert
--    branches marked CHANGED are the only difference.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
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
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_production_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    -- 'category' is hidden from the UI registry but kept here: legacy pending
    -- rows may still reference it, and dropping the branch would fail them.
    if v_type = 'category' then
      insert into public.fms_production_categories (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'raw_material' then
      -- CHANGED: carry the requested unit through to the master.
      insert into public.fms_production_raw_materials (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    elsif v_type = 'fg_item' then
      -- CHANGED: carry the requested unit through to the master.
      insert into public.fms_production_fg_items (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    elsif v_type = 'unit' then
      insert into public.fms_production_units (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'packaging_item' then
      insert into public.fms_production_packaging_items (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_production_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_production_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
grant execute on function public.fms_production_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pending-duplicate guard.
--
-- Production masters are flat name lists with no parent, so the key is just
-- (type, lower(name)) — unlike Purchase / Import, whose index also coalesces a
-- category / item-group / vendor parent. Partial on `status = 'pending'`, so
-- re-requesting after a rejection is still allowed.
--
-- The client mirrors this key in RequestMasterModal's `clash` check; if one
-- drifts from the other, the app and the database disagree about what a
-- duplicate is.
--
-- NOTE: this fails if duplicate pending rows already exist. Resolve them first:
--   select master_type, lower(proposed_payload->>'name') nm, count(*)
--     from public.fms_production_master_requests where status = 'pending'
--    group by 1,2 having count(*) > 1;
-- ---------------------------------------------------------------------------
create unique index if not exists fms_production_master_requests_pending_uniq
  on public.fms_production_master_requests (master_type, lower(coalesce(proposed_payload->>'name','')))
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Email payload — label 'packaging_item' properly and show the Unit.
--    Body from 20260726140000_add_fms_production_email.sql; only the
--    master_request branch changes (marked CHANGED).
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/production-entry';
  r record;
  mr record;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
  v_unit text;
  v_next_label text;
  v_next_queue text;
  v_qty text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_production_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    -- CHANGED: 'packaging_item' had no arm, so those requests emailed as "category".
    v_label := case coalesce(p_meta->>'masterType', mr.master_type)
                 when 'raw_material' then 'raw material'
                 when 'packaging_item' then 'packaging item'
                 when 'fg_item' then 'FG item'
                 when 'unit' then 'unit'
                 else 'category' end;
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    -- CHANGED: the requested unit, shown as its own row when one was picked.
    select u.name into v_unit from public.fms_production_units u
     where u.id = nullif(mr.proposed_payload->>'unit_id','')::uuid;
    v_rows := jsonb_build_array(jsonb_build_object('label','Name','value', v_name))
              || case when coalesce(v_unit,'') <> ''
                      then jsonb_build_array(jsonb_build_object('label','Unit','value', v_unit))
                      else '[]'::jsonb end;
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', v_rows,
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', v_rows,
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- production job card ----
  select req.*,
         cat.name as category_name,
         rm.name  as raw_material_name,
         fg.name  as fg_item_name,
         un.name  as unit_name
    into r
    from public.fms_production_requests req
    left join public.fms_production_categories    cat on cat.id = req.category_id
    left join public.fms_production_raw_materials  rm on rm.id  = req.raw_material_id
    left join public.fms_production_fg_items       fg on fg.id  = req.fg_item_id
    left join public.fms_production_units          un on un.id  = req.unit_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_doc := 'Job card #' || r.req_no;
  v_qty := case when r.required_qty is null then '-'
                else trim(to_char(r.required_qty, 'FM999999990.###')) ||
                     case when coalesce(r.unit_name,'') <> '' then ' ' || r.unit_name else '' end end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Job card no.','value', coalesce(nullif(btrim(r.jobcard_no),''), r.req_no)),
    jsonb_build_object('label','Category','value', coalesce(r.category_name,'-')),
    jsonb_build_object('label','Raw material','value', coalesce(r.raw_material_name,'-')),
    jsonb_build_object('label','Required qty','value', v_qty),
    jsonb_build_object('label','FG item','value', coalesce(r.fg_item_name,'-'))
  );

  -- Map the row's next due step -> friendly label + queue path.
  v_next_label := case r.current_step
                    when 'material_handover' then 'Material Handover'
                    when 'transfer_slip'     then 'Transfer Slip & Batch Card'
                    when 'production_entry'  then 'Production Entry'
                    when 'quality_check'     then 'Quality Checking'
                    when 'mc_testing'        then 'M/C Testing'
                    when 'pm_handover'       then 'Packing Material Handover'
                    when 'pm_transfer'       then 'Packing Material Transfer'
                    when 'packing_entry'     then 'Packing Entry'
                    when 'fg_transfer'       then 'FG Transfer'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'material_handover' then '/queues/material-handover'
                    when 'transfer_slip'     then '/queues/transfer-slip'
                    when 'production_entry'  then '/queues/production'
                    when 'quality_check'     then '/queues/quality'
                    when 'mc_testing'        then '/queues/mc-testing'
                    when 'pm_handover'       then '/queues/pm-handover'
                    when 'pm_transfer'       then '/queues/pm-transfer'
                    when 'packing_entry'     then '/queues/packing'
                    when 'fg_transfer'       then '/queues/fg-transfer'
                    else '/requests/' || r.id::text end;

  -- Eyebrow = what just happened (the announced/completed step).
  v_eyebrow := case p_type
                 when 'raised' then 'New job card'
                 when 'material_handover' then 'Handover confirmed'
                 when 'transfer_slip' then 'Transfer slip done'
                 when 'production_entry' then 'Production recorded'
                 when 'quality_check' then 'Quality checked'
                 when 'mc_testing' then 'M/C tested'
                 when 'pm_handover' then 'PM handed over'
                 when 'pm_transfer' then 'PM transferred'
                 when 'packing_entry' then 'Packing recorded'
                 when 'fg_transfer' then 'Closed'
                 else 'Production Entry' end;

  if r.status = 'closed' then
    v_action := 'recorded the FG transfer';
    v_headline := 'Job card closed - FG transferred to Hojiwala';
    v_subject := 'Job card closed - ' || v_doc;
    v_cta_label := 'Open the job card'; v_cta_path := b || '/requests/' || r.id::text;
    if r.final_qty is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Final qty','value', trim(to_char(r.final_qty,'FM999999990.###'))));
    end if;
    if coalesce(btrim(r.fg_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Remarks','text', r.fg_remarks));
    end if;
  else
    v_action := case p_type when 'raised' then 'raised a job card' else 'completed a production step' end;
    v_headline := 'Ready for ' || v_next_label;
    v_subject := 'Ready for ' || v_next_label || ' (' || v_doc || ')';
    v_cta_label := 'Open ' || v_next_label || ' queue'; v_cta_path := b || v_next_queue;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'Production Entry update'));
end $$;
grant execute on function public.fms_production_email_payload(text, uuid, text, text, jsonb) to authenticated;
