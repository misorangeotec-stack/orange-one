-- ===========================================================================
-- ROLLBACK of 20270114120000_fms_complaint_other_supplier.sql.
--
-- Restores the type check and the two functions to their definitions as they
-- were on live before it (dumped with pg_get_functiondef on 09-10-2026).
-- Refuses to run while any other_supplier complaint exists — cancel or delete
-- those rows first, or the restored check would not validate.
-- ===========================================================================

begin;

do $rb$
begin
  if exists (select 1 from public.fms_complaint_requests where complaint_type = 'other_supplier') then
    raise exception 'Other Supplier complaints exist - deal with them before rolling back';
  end if;
end $rb$;

alter table public.fms_complaint_requests drop constraint if exists fms_complaint_requests_complaint_type_check;
alter table public.fms_complaint_requests add constraint fms_complaint_requests_complaint_type_check
  check (complaint_type in ('finished_good', 'raw_material'));

CREATE OR REPLACE FUNCTION public.fms_complaint_submit_request(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id     uuid;
  v_fy     text := public.fms_complaint_fy_code(current_date);
  v_seq    integer;
  v_no     text;
  v_type   text := coalesce(nullif(trim(p->>'complaint_type'), ''), 'finished_good');
  v_origin text := nullif(trim(p->>'rm_origin'), '');
  v_status text;
  v_step   text;
begin
  if not public.fms_complaint_can_raise(auth.uid()) then
    raise exception 'Not authorized to raise a complaint';
  end if;
  if v_type not in ('finished_good', 'raw_material') then
    raise exception 'Unknown complaint type: %', v_type;
  end if;

  if v_type = 'raw_material' then
    if v_origin is null then
      raise exception 'Choose the type - Domestic or Import. It decides who handles the complaint.';
    end if;
    if v_origin not in ('domestic', 'import') then
      raise exception 'Unknown raw-material type: %', v_origin;
    end if;
    -- Domestic -> Purchase. Import -> Management.
    if v_origin = 'domestic' then
      v_status := 'awaiting_purchase';       v_step := 'purchase';
    else
      v_status := 'awaiting_rm_management';  v_step := 'rm_management';
    end if;
  else
    -- Finished goods are unchanged: they still start at the plant.
    v_origin := null;
    v_status := 'awaiting_plant';  v_step := 'plant';
  end if;

  v_seq := public.fms_complaint_next_seq('complaint:' || v_fy);
  v_no  := 'CMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_complaint_requests (
    complaint_no, complaint_type, rm_origin, status, current_step,
    raised_by, requester_name, company_id,
    lot_no, lot_expiry_date, lot_source, category, ink_type,
    item_id, item_name, party_id, party_name,
    invoice_no, invoice_date, qty_affected, unit_name, nature_id,
    issue_identified_at, problem_details, other_remarks, submitted_at
  ) values (
    v_no, v_type, v_origin, v_status, v_step,
    auth.uid(),
    coalesce(nullif(trim(p->>'requester_name'), ''),
             (select name from public.profiles where id = auth.uid()), 'Unknown'),
    nullif(p->>'company_id', '')::uuid,
    nullif(trim(p->>'lot_no'), ''),
    nullif(p->>'lot_expiry_date', '')::date,
    coalesce(nullif(trim(p->>'lot_source'), ''), 'manual'),
    nullif(trim(p->>'category'), ''),
    nullif(trim(p->>'ink_type'), ''),
    nullif(p->>'item_id', '')::uuid,
    nullif(trim(p->>'item_name'), ''),
    nullif(p->>'party_id', '')::uuid,
    nullif(trim(p->>'party_name'), ''),
    nullif(trim(p->>'invoice_no'), ''),
    nullif(p->>'invoice_date', '')::date,
    nullif(p->>'qty_affected', '')::numeric,
    nullif(trim(p->>'unit_name'), ''),
    nullif(p->>'nature_id', '')::uuid,
    nullif(p->>'issue_identified_at', '')::timestamptz,
    nullif(trim(p->>'problem_details'), ''),
    nullif(trim(p->>'other_remarks'), ''),
    now()
  )
  returning id into v_id;

  perform public.fms_complaint_announce(
    'request', v_id, 'raised',
    format('%s raised complaint %s against %s',
           coalesce((select name from public.profiles where id = auth.uid()), 'Someone'),
           v_no, coalesce(nullif(trim(p->>'party_name'), ''), 'a party')),
    -- Whichever bucket the fork above chose.
    public.fms_complaint_step_owner_ids(v_step),
    jsonb_build_object('complaint_no', v_no, 'complaint_type', v_type,
                       'rm_origin', v_origin,
                       'lot_no', nullif(trim(p->>'lot_no'), ''))
  );
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.fms_complaint_email_payload(p_entity_type text, p_entity_id uuid, p_type text, p_text text, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_no    text := coalesce(p_meta->>'complaint_no', '');
  v_party text;
  v_rows  jsonb := '[]'::jsonb;
begin
  select * into r from public.fms_complaint_requests where id = p_entity_id;

  if r.id is not null then
    v_no    := coalesce(nullif(v_no, ''), r.complaint_no);
    v_party := coalesce(r.party_name, '—');

    -- The facts somebody needs to act WITHOUT opening the app. The party and the
    -- invoice re-label by type, exactly as the form does.
    v_rows := jsonb_build_array(
      jsonb_build_object('label', 'Complaint', 'value', coalesce(r.complaint_no, '—')),
      jsonb_build_object('label', 'Type',
        'value', case r.complaint_type when 'finished_good' then 'Finished Good' else 'Raw Material' end),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'Customer' else 'Vendor' end,
        'value', v_party),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'FG Lot No.' else 'RM Lot No.' end,
        'value', coalesce(r.lot_no, '—')),
      jsonb_build_object('label', 'Item', 'value', coalesce(r.item_name, '—')),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'Sales Invoice' else 'Purchase Invoice' end,
        'value', coalesce(r.invoice_no, '—')
                 || coalesce(' · ' || to_char(r.invoice_date, 'DD-MM-YYYY'), '')),
      jsonb_build_object('label', 'Severity',
        'value', coalesce(initcap(r.ack_severity), 'not set'))
    );
  end if;

  return jsonb_build_object(
    'subject',  case when v_no <> '' then v_no || ' — ' || coalesce(v_party, 'complaint') else 'Complaint update' end,
    'eyebrow',  'Quality · Complaint',
    'headline', coalesce(nullif(p_text, ''), 'A complaint was updated'),
    'rows',     v_rows,
    'note',     coalesce(r.problem_details, ''),
    'ctaPath',  '/complaint/requests/' || p_entity_id::text,
    'ctaLabel', 'Open the complaint'
  );
end $function$
;

commit;
