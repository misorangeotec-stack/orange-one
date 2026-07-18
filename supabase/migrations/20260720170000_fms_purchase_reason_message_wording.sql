-- ===========================================================================
-- Purchase FMS — reword the fewer-than-three-vendors refusal.
--
-- "single-source reason" reads as "you picked ONE vendor", which is wrong (and
-- confusing) when the buyer shortlisted two. The rule is unchanged — fewer than
-- three vendors still requires a reason — only the wording moves, so the server
-- message matches the form's label and its client-side error.
--
-- Body carried forward verbatim from 20260720140000; the ONLY change is the
-- RAISE text on line ~45.
-- ===========================================================================
create or replace function public.fms_purchase_save_sourcing_request(
  p_request_id            uuid,
  p_vendors               jsonb,
  p_recommended_vendor_id uuid,
  p_lines                 jsonb,
  p_sourcing_reason       text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_req_id     uuid;
  v_elem       jsonb;
  v_vendor_ct  integer;
  v_line_ct    integer;
  v_locked     uuid;
  v_line_id    uuid;
  v_status     text;
  v_owner      uuid;
  v_qty        numeric(14,3);
  v_rate       numeric(14,2);
  v_gst        numeric(6,2);
  v_lead       integer;
  v_value      numeric(16,2);
  v_remark     text;
begin
  select id into v_req_id from public.fms_purchase_requests
   where id = p_request_id for update;
  if v_req_id is null then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this requisition';
  end if;

  v_vendor_ct := coalesce(jsonb_array_length(p_vendors), 0);
  if v_vendor_ct < 1 then raise exception 'Shortlist at least one vendor'; end if;
  if v_vendor_ct > 3 then raise exception 'At most three vendors can be shortlisted'; end if;
  if p_recommended_vendor_id is null then raise exception 'Tick the vendor you are recommending'; end if;

  if (select count(distinct e->>'vendor_id') from jsonb_array_elements(p_vendors) e) <> v_vendor_ct then
    raise exception 'Each shortlisted vendor must be different';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id
  ) then
    raise exception 'The recommended vendor must be one of the shortlisted vendors';
  end if;

  -- Fewer than three vendors requires a reason. Enforced here, not just in the
  -- form, so it cannot be bypassed by calling the RPC directly.
  if v_vendor_ct < 3 and nullif(p_sourcing_reason,'') is null then
    raise exception 'Give a reason for shortlisting fewer than 3 vendors.';
  end if;

  -- Lines already decided against a vendor pin the rest of the requisition to
  -- that same vendor — otherwise it ends up split across two vendors, which this
  -- model cannot represent and which would silently rewrite an agreed price.
  select ri.final_vendor_id into v_locked
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id
     and ri.status in ('approved_pending_po','po')
     and ri.final_vendor_id is not null
   limit 1;
  if v_locked is not null and v_locked is distinct from p_recommended_vendor_id then
    raise exception 'Part of this requisition is already approved against a different vendor (%). All its lines must go to that vendor.',
      (select name from public.fms_purchase_vendors where id = v_locked);
  end if;

  delete from public.fms_purchase_request_vendors where request_id = p_request_id;
  insert into public.fms_purchase_request_vendors (request_id, vendor_id, is_recommended, remark, sort_order)
  select p_request_id,
         (e->>'vendor_id')::uuid,
         (e->>'vendor_id')::uuid = p_recommended_vendor_id,
         nullif(e->>'remark',''),
         (ord - 1)::integer
    from jsonb_array_elements(p_vendors) with ordinality as t(e, ord);

  v_line_ct := coalesce(jsonb_array_length(p_lines), 0);
  if v_line_ct < 1 then raise exception 'Enter a rate for at least one item'; end if;

  for v_elem in select * from jsonb_array_elements(p_lines) loop
    v_line_id := (v_elem->>'request_item_id')::uuid;

    select ri.status, ri.request_id into v_status, v_owner
      from public.fms_purchase_request_items ri
     where ri.id = v_line_id for update;

    if v_status is null then raise exception 'Item line % not found', v_line_id; end if;
    if v_owner is distinct from p_request_id then
      raise exception 'Item line % does not belong to this requisition', v_line_id;
    end if;
    if v_status not in ('sourcing','approval','on_hold') then
      raise exception 'An item on this requisition is no longer open for sourcing (status %). Reload and try again.', v_status;
    end if;

    v_qty  := (v_elem->>'qty')::numeric;
    v_rate := (v_elem->>'rate')::numeric;
    v_gst  := nullif(v_elem->>'gst_pct','')::numeric;
    v_lead := nullif(v_elem->>'lead_time_days','')::integer;

    if coalesce(v_qty,0) <= 0 then raise exception 'Quantity must be greater than 0'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;

    v_value := round(v_qty * v_rate * (1 + coalesce(v_gst,0)/100.0), 2);

    select nullif(e->>'remark','') into v_remark
      from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id limit 1;

    delete from public.fms_purchase_quotations where request_item_id = v_line_id;
    insert into public.fms_purchase_quotations
      (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
    values (v_line_id, p_recommended_vendor_id, v_rate, v_gst, v_lead, v_remark, true);

    update public.fms_purchase_request_items
       set final_vendor_id = p_recommended_vendor_id,
           final_qty       = v_qty,
           final_rate      = v_rate,
           gst_pct         = v_gst,
           lead_time_days  = v_lead,
           line_value      = v_value,
           sourcing_reason = nullif(p_sourcing_reason,''),
           status          = 'approval',
           reject_reason   = null,
           sourced_at      = now(),
           sourced_by      = auth.uid()
     where id = v_line_id;
  end loop;

  update public.fms_purchase_requests
     set sourcing_reason = nullif(p_sourcing_reason,''),
         sourced_at      = now(),
         sourced_by      = auth.uid()
   where id = p_request_id;
end $function$;

grant execute on function public.fms_purchase_save_sourcing_request(uuid, jsonb, uuid, jsonb, text) to authenticated;
