-- Domestic Purchase FMS: category moves onto the request LINE.
--
-- Until now a domestic request carried ONE category on its header, and the New
-- Request screen reset the whole grid whenever you changed it. Each row now
-- picks its own Category → Group → Item, so a request may mix categories —
-- mirroring Import's 20260719120000.
--
-- Additive: request_items gains a NULLABLE category_id; fms_purchase_requests
-- .category_id stays NOT NULL and keeps the FIRST line's category, so every
-- existing header-level read (RequestsList, RequestDetail, sourcing/approval)
-- keeps working. The submit RPC keeps its EXACT signature — a different arg list
-- would create an overload PostgREST can't resolve.

begin;

alter table public.fms_purchase_request_items
  add column if not exists category_id uuid
    references public.fms_purchase_categories on delete restrict;

comment on column public.fms_purchase_request_items.category_id is
  'Category of THIS line. A request may mix categories across its lines. '
  'fms_purchase_requests.category_id is NOT NULL and holds the FIRST line''s '
  'category, keeping every pre-existing header-level read working. Equal by '
  'construction to item_group.category_id, set from the chosen group at submit.';

create index if not exists fms_purchase_request_items_category_idx
  on public.fms_purchase_request_items (category_id);

-- Backfill: every existing line inherits its request's category (what it meant
-- before). Idempotent.
update public.fms_purchase_request_items ri
   set category_id = r.category_id
  from public.fms_purchase_requests r
 where r.id = ri.request_id
   and ri.category_id is null;

-- ---- submit_request — exact signature, category now per line ---------------
-- Deltas vs the live body: header category is optional (falls back to the first
-- line's), and each line stores its own category_id from the p_items element.

create or replace function public.fms_purchase_submit_request(
  p_company_id  uuid,
  p_category_id uuid,
  p_note        text,
  p_items       jsonb   -- [{item_id, category_id, quantity, unit, line_remark}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request_id uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text;
  v_elem       jsonb;
  v_count      integer := 0;
  v_hdr_cat    uuid;   -- NEW
  v_cat        uuid;   -- NEW
begin
  if p_company_id is null then
    raise exception 'Company is required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;

  -- NEW: header category = explicit param, else the first line's (array order is
  -- preserved by jsonb_array_elements, so "first" is deterministic).
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

  v_fy  := public.fms_purchase_fy_code(current_date);
  v_seq := public.fms_purchase_next_seq('request:' || v_fy);
  v_no  := 'PR-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_purchase_requests (request_no, company_id, category_id, requester_id, note)
  values (v_no, p_company_id, v_hdr_cat, auth.uid(), nullif(p_note, ''))
  returning id into v_request_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_elem->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Each item needs a quantity greater than 0';
    end if;
    v_cat := coalesce(nullif(v_elem->>'category_id','')::uuid, v_hdr_cat);   -- NEW
    insert into public.fms_purchase_request_items (request_id, item_id, category_id, quantity, unit, line_remark)
    values (
      v_request_id,
      (v_elem->>'item_id')::uuid,
      v_cat,                                       -- NEW
      (v_elem->>'quantity')::numeric,
      coalesce(v_elem->>'unit', ''),
      nullif(v_elem->>'line_remark', '')
    );
    v_count := v_count + 1;
  end loop;

  return v_request_id;
end $function$;

grant execute on function public.fms_purchase_submit_request(uuid, uuid, text, jsonb) to authenticated;

commit;
