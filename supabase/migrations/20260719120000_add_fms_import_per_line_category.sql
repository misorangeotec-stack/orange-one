-- Import FMS: category moves onto the request LINE.
--
-- Until now a request carried ONE category on its header, so every line had to
-- come from the same category. The New Request screen is becoming an inline
-- grid where each row picks its own Category and Item, so a single request may
-- now mix categories.
--
-- Additive only, per the repo rule:
--   * fms_import_request_items gains a NULLABLE category_id;
--   * fms_import_requests.category_id stays NOT NULL and keeps holding the
--     FIRST line's category, so RequestsList / RequestDetail and every other
--     existing read keep working untouched;
--   * fms_import_submit_request keeps its EXACT argument list — `create or
--     replace` with a different signature would create an OVERLOAD, not a
--     replacement, and PostgREST would then fail to resolve the call. The
--     per-line category therefore travels inside the existing p_items jsonb.
--
-- Both function bodies below were pulled from the LIVE database with
-- pg_get_functiondef (not copied from an earlier migration, which may have been
-- superseded) and are reproduced verbatim except for the deltas marked -- NEW.

begin;

-- ---- 1. the column -----------------------------------------------------------

alter table public.fms_import_request_items
  add column if not exists category_id uuid
    references public.fms_import_categories on delete restrict;

comment on column public.fms_import_request_items.category_id is
  'Category of THIS line. A request may mix categories across its lines. '
  'fms_import_requests.category_id is NOT NULL and stays so — it holds the '
  'FIRST line''s category, which keeps every pre-existing header-level read working.';

create index if not exists fms_import_request_items_category_idx
  on public.fms_import_request_items (category_id);

-- Every pre-existing line inherits its request's category, which is exactly
-- what it meant before this migration. Idempotent.
update public.fms_import_request_items ri
   set category_id = r.category_id
  from public.fms_import_requests r
 where r.id = ri.request_id
   and ri.category_id is null;

-- ---- 2. submit_request -------------------------------------------------------
-- Deltas vs the live body: p_category_id is no longer required, the header
-- category falls back to the first line's, and each line stores its own.

create or replace function public.fms_import_submit_request(
  p_company_id  uuid,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_note        text,
  p_currency    text,
  p_fx_rate     numeric,
  p_items       jsonb   -- [{item_id, category_id, quantity, unit, rate, line_remark}]
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text;
  v_elem       jsonb;
  v_qty        numeric(14,3);
  v_rate       numeric(16,4);
  v_val_fx     numeric(16,2);
  v_val_inr    numeric(16,2);
  v_fx         numeric(18,6);
  v_hdr_cat    uuid;   -- NEW
  v_cat        uuid;   -- NEW
begin
  -- NEW: category is no longer required on the header — it may arrive per line.
  if p_company_id is null or p_vendor_id is null then
    raise exception 'Company and vendor are required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;
  v_fx := coalesce(p_fx_rate, 0);
  if v_fx <= 0 then
    raise exception 'A valid exchange rate is required';
  end if;

  -- NEW: header category = the explicit param, else the FIRST line's.
  -- jsonb_array_elements preserves array order, so "first" is deterministic.
  v_hdr_cat := p_category_id;
  if v_hdr_cat is null then
    select nullif(e->>'category_id','')::uuid
      into v_hdr_cat
      from jsonb_array_elements(p_items) e
     where nullif(e->>'category_id','') is not null
     limit 1;
  end if;
  if v_hdr_cat is null then
    raise exception 'Every line needs a category';
  end if;

  v_fy  := public.fms_import_fy_code(current_date);
  v_seq := public.fms_import_next_seq('request:' || v_fy);
  v_no  := 'IPR-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_import_requests (request_no, company_id, category_id, vendor_id, currency, requester_id, note)
  values (v_no, p_company_id, v_hdr_cat, p_vendor_id, nullif(p_currency,''), auth.uid(), nullif(p_note, ''))
  returning id into v_request_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_qty  := coalesce((v_elem->>'quantity')::numeric, 0);
    v_rate := coalesce((v_elem->>'rate')::numeric, 0);
    v_cat  := coalesce(nullif(v_elem->>'category_id','')::uuid, v_hdr_cat);   -- NEW
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;
    if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;

    v_val_fx  := round(v_qty * v_rate, 2);   -- no GST on an import line
    v_val_inr := round(v_val_fx * v_fx, 2);

    insert into public.fms_import_request_items (
      request_id, item_id, category_id, quantity, unit, line_remark,
      final_vendor_id, final_qty, final_rate, gst_pct, currency,
      fx_rate_at_request, line_value_fx, line_value,
      status, sourced_at
    )
    values (
      v_request_id,
      (v_elem->>'item_id')::uuid,
      v_cat,                                 -- NEW
      v_qty,
      coalesce(v_elem->>'unit', ''),
      nullif(v_elem->>'line_remark', ''),
      p_vendor_id, v_qty, v_rate, null, nullif(p_currency,''),
      v_fx, v_val_fx, v_val_inr,
      'approval', now()   -- no sourcing: line enters straight at approval; sourced_at anchors the SLA
    );
  end loop;

  return v_request_id;
end $function$;

grant execute on function public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb) to authenticated;

-- ---- 3. resolve_master_request ----------------------------------------------
-- fms_import_vendor_item_prices is unique (vendor_id, item_id). The live
-- vendor_item_price branch does a plain insert, so approving a price request
-- for a pair that ALREADY has a price raises 23505 and the approver is stuck.
-- Re-pricing is exactly what the new "save to price list" tick produces, so
-- make the branch upsert. Body verbatim from the live definition; only that one
-- branch changed.

create or replace function public.fms_import_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null::jsonb,
  p_note       text  default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_import_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_import_vendors (name, gstin, contact_name, phone, email, address, default_currency, created_by)
      values (
        nullif(v_payload->>'name',''), null, v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address',
        nullif(v_payload->>'default_currency',''), auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_import_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      insert into public.fms_import_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      insert into public.fms_import_items (item_group_id, name, unit, created_by)
      values ((v_payload->>'item_group_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_import_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      -- NEW: upsert, so approving a price for an already-priced pair re-prices
      -- it instead of raising 23505. sort_order is deliberately left alone.
      insert into public.fms_import_vendor_item_prices (vendor_id, item_id, currency, rate, gst_pct, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'currency',''), 'USD'),
        coalesce((v_payload->>'rate')::numeric, 0),
        null,
        auth.uid()
      )
      on conflict (vendor_id, item_id) do update
        set currency = excluded.currency,
            rate     = excluded.rate,
            active   = true
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_import_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_import_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $function$;

grant execute on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

commit;
