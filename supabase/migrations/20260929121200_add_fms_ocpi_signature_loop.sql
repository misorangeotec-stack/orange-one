-- ===========================================================================
-- OCPI FMS — the signature loop: the last two steps of the chain.
--
--   fms_ocpi_deals.cs_doc_pages / ms_doc_pages     extra scanned pages
--   fms_ocpi_doc_pages(jsonb, text)                normalise a pages payload
--   fms_ocpi_record_customer_sign(deal, p)         the customer-signed copy
--   fms_ocpi_return_signature(deal, note)          management send it back
--   fms_ocpi_record_management_sign(deal, p)       countersigned; deal closed
--
-- ⚠ THE SCAN IS THE RECORD FROM HERE ON. Up to this point the module could
--   always re-render a document from its frozen payload. A signed contract
--   cannot be re-rendered — the signature exists only as pixels — so these two
--   uploads are the only irreplaceable artifacts the module holds. That is why
--   the storage rules get their own migration (…_fms_ocpi_doc_storage_policies)
--   and why nothing here deletes.
--
-- ⚠ MULTI-PAGE, BECAUSE THE OC IS FOUR TO SEVEN PAGES. A customer who initials
--   every page hands back a stack, and it is photographed on a phone one sheet
--   at a time. The single cs_doc_path column would have forced whoever is
--   standing there to give up four pages out of five. Same split Order to
--   Dispatch settled on in 20260831120000: page one in the text column, the rest
--   in a jsonb array of {path, name}. The primary is STRIPPED from the array so
--   a client posting the whole list cannot store page one twice.
--
-- ⚠ WHO MAY DO WHAT IS NOT SYMMETRIC.
--     customer sign   — the step owners, coordinators, OR THE SALESPERSON WHO
--                       RAISED THE DEAL. They are the person at the customer
--                       desk with the paper; demanding a step grant as well
--                       would make the common case the blocked one.
--     management sign — the step owners and coordinators ONLY. The raiser is
--                       deliberately excluded: countersigning is the other half
--                       of a two-party signature, and one person holding both
--                       pens is the whole thing this module exists to stop.
--
-- ⚠ MANAGEMENT CAN SEND A SIGNATURE BACK, and that is not scope creep. Without
--   it, one illegible or unsigned page leaves the deal parked at
--   awaiting_management_sign for good, the only escape being to countersign a
--   document management can see is wrong.
--
-- Purely ADDITIVE: two columns, four functions.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_record_management_sign(uuid, jsonb);
--   drop function if exists public.fms_ocpi_return_signature(uuid, text);
--   drop function if exists public.fms_ocpi_record_customer_sign(uuid, jsonb);
--   drop function if exists public.fms_ocpi_doc_pages(jsonb, text);
--   alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_deals_ms_pages_array;
--   alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_deals_cs_pages_array;
--   alter table public.fms_ocpi_deals drop column if exists ms_doc_pages;
--   alter table public.fms_ocpi_deals drop column if exists cs_doc_pages;
-- ===========================================================================

begin;

alter table public.fms_ocpi_deals
  add column if not exists cs_doc_pages jsonb,
  add column if not exists ms_doc_pages jsonb;

alter table public.fms_ocpi_deals
  drop constraint if exists fms_ocpi_deals_cs_pages_array,
  drop constraint if exists fms_ocpi_deals_ms_pages_array;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_deals_cs_pages_array
    check (cs_doc_pages is null or jsonb_typeof(cs_doc_pages) = 'array'),
  add constraint fms_ocpi_deals_ms_pages_array
    check (ms_doc_pages is null or jsonb_typeof(ms_doc_pages) = 'array');

comment on column public.fms_ocpi_deals.cs_doc_pages is
  'Pages of the customer-signed order confirmation AFTER the first: ordered [{path,name}]. Page one is cs_doc_path. NULL means there are no further pages.';
comment on column public.fms_ocpi_deals.ms_doc_pages is
  'Pages of the countersigned order confirmation AFTER the first: ordered [{path,name}]. Page one is ms_doc_path.';

-- ---------------------------------------------------------------------------
-- Normalise an extra-pages payload into what the columns are documented to
-- hold. ONE function for both signatures, because two hand-copied jsonb_agg
-- blocks is precisely how the two sides drift apart.
--
-- Not `security definer`: it touches no table, so it needs no elevation.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_doc_pages(p_pages jsonb, p_primary text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare v_out jsonb;
begin
  if p_pages is null or jsonb_typeof(p_pages) = 'null' then return null; end if;
  if jsonb_typeof(p_pages) = 'string'
     and coalesce(btrim(p_pages #>> '{}'), '') = '' then return null; end if;
  if jsonb_typeof(p_pages) <> 'array' then
    raise exception 'The signed pages must be a JSON array of {path, name}';
  end if;

  select jsonb_agg(jsonb_build_object(
           'path', btrim(e->>'path'),
           'name', coalesce(nullif(btrim(e->>'name'), ''), btrim(e->>'path')))
         order by ord)
    into v_out
    from jsonb_array_elements(p_pages) with ordinality t(e, ord)
   where coalesce(btrim(e->>'path'), '') <> ''
     -- ⚠ PAGE ONE IS STRIPPED — a client posting the whole list verbatim would
     --   otherwise store the primary twice and the strip would render it twice.
     and btrim(e->>'path') is distinct from nullif(btrim(p_primary), '');

  -- jsonb_agg over zero rows is already NULL, which IS the documented empty
  -- form. There is deliberately nothing to coalesce afterwards.
  return v_out;
end $fn$;

comment on function public.fms_ocpi_doc_pages(jsonb, text) is
  'Normalise a signed-document extra-pages payload: order preserving, blank paths dropped, the primary stripped, empty forms collapsed to NULL.';

-- ---------------------------------------------------------------------------
-- 1. THE CUSTOMER-SIGNED COPY.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_record_customer_sign(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_oc     text;
  v_path   text := nullif(btrim(coalesce(p->>'doc_path', '')), '');
  v_pages  jsonb;
  v_note   text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_to     uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_customer_sign' then
    raise exception 'This deal is not waiting for a customer signature';
  end if;

  -- The salesperson who raised it is the person holding the paper. They still
  -- need an edit grant on the module — can_act carries that test itself, so
  -- this arm has to state it.
  if not public.fms_ocpi_can_act('customer_signoff', p_deal, v_uid)
     and not (v_owner = v_uid and public.module_can_edit(v_uid, 'ocpi')) then
    raise exception 'You are not authorized to file the signed copy for this deal';
  end if;

  if v_path is null then
    raise exception 'Attach the signed order confirmation before recording it';
  end if;
  -- ⚠ The path must live under this own deal folder — the storage policy
  --   derives the owning deal from the first segment, so a file filed anywhere
  --   else would be readable by the wrong people.
  if split_part(v_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  v_pages := public.fms_ocpi_doc_pages(p->'doc_pages', v_path);

  update public.fms_ocpi_deals
     set status       = 'awaiting_management_sign',
         current_step = 'management_signoff',
         cs_doc_path  = v_path,
         cs_doc_pages = v_pages,
         cs_at        = now(),
         cs_by        = v_uid
   where id = p_deal;

  v_to := public.fms_ocpi_step_owner_ids('management_signoff');
  perform public.fms_ocpi_announce(
    'deal', p_deal, 'customer_signed',
    coalesce(v_oc, 'The order confirmation') || ' has been signed by the customer'
      || case when v_note is null then '' else ': ' || v_note end
      || ' — it needs countersigning.',
    coalesce(v_to, '{}'::uuid[]),
    jsonb_build_object('oc_no', v_oc, 'pages', 1 + coalesce(jsonb_array_length(v_pages), 0)));
end $fn$;

comment on function public.fms_ocpi_record_customer_sign(uuid, jsonb) is
  'File the customer-signed order confirmation and hand the deal to management for countersigning. Open to the step owners, coordinators, or the salesperson who raised the deal.';
grant execute on function public.fms_ocpi_record_customer_sign(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. SENDING A SIGNATURE BACK.
--
-- The scan is kept, not wiped: "this page is unreadable" is a comparison the
-- salesperson has to be able to make against what was actually filed.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_return_signature(p_deal uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_oc     text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_management_sign' then
    raise exception 'This deal is not waiting to be countersigned';
  end if;
  if not public.fms_ocpi_can_act('management_signoff', p_deal, v_uid) then
    raise exception 'You are not authorized to countersign order confirmations';
  end if;
  if v_note is null then
    raise exception 'Say what is wrong with the signed copy, so it can be put right';
  end if;

  update public.fms_ocpi_deals
     set status        = 'awaiting_customer_sign',
         current_step  = 'customer_signoff',
         rework_at     = now(),
         rework_stage  = 'management_signoff',
         rework_reason = v_note,
         rework_count  = rework_count + 1
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'signature_returned',
    'The signed copy of ' || coalesce(v_oc, 'the order confirmation')
      || ' was sent back: ' || v_note,
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('oc_no', v_oc));
end $fn$;

comment on function public.fms_ocpi_return_signature(uuid, text) is
  'Management sends a customer-signed copy back for a re-scan or a re-signature. Requires a reason; the filed scan is kept so the salesperson can see what was refused.';
grant execute on function public.fms_ocpi_return_signature(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE COUNTERSIGNATURE, WHICH CLOSES THE DEAL.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_record_management_sign(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  v_oc     text;
  v_path   text := nullif(btrim(coalesce(p->>'doc_path', '')), '');
  v_pages  jsonb;
  v_note   text := nullif(btrim(coalesce(p->>'note', '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, oc_no into v_status, v_owner, v_oc
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_status <> 'awaiting_management_sign' then
    raise exception 'This deal is not waiting to be countersigned';
  end if;

  -- ⚠ NO RAISER ARM HERE. See the header: one person must not hold both pens.
  if not public.fms_ocpi_can_act('management_signoff', p_deal, v_uid) then
    raise exception 'You are not authorized to countersign order confirmations';
  end if;

  if v_path is null then
    raise exception 'Attach the countersigned order confirmation before closing the deal';
  end if;
  if split_part(v_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  v_pages := public.fms_ocpi_doc_pages(p->'doc_pages', v_path);

  update public.fms_ocpi_deals
     set status       = 'closed',
         current_step = null,
         ms_doc_path  = v_path,
         ms_doc_pages = v_pages,
         ms_at        = now(),
         ms_by        = v_uid
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'deal_closed',
    coalesce(v_oc, 'The order confirmation') || ' has been countersigned'
      || case when v_note is null then '' else ': ' || v_note end
      || ' — the deal is complete.',
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('oc_no', v_oc, 'pages', 1 + coalesce(jsonb_array_length(v_pages), 0)));
end $fn$;

comment on function public.fms_ocpi_record_management_sign(uuid, jsonb) is
  'File the countersigned order confirmation and close the deal. Step owners and coordinators only — never the salesperson who raised it.';
grant execute on function public.fms_ocpi_record_management_sign(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- assertions --
do $$
begin
  -- The primary must be stripped, blanks dropped, order kept.
  if public.fms_ocpi_doc_pages(
       '[{"path":"a/oc/1.jpg"},{"path":"  "},{"path":"a/oc/2.jpg","name":"Back"}]'::jsonb,
       'a/oc/1.jpg')
     is distinct from '[{"name": "Back", "path": "a/oc/2.jpg"}]'::jsonb then
    raise exception 'fms_ocpi_doc_pages no longer strips the primary or drops blanks';
  end if;

  -- Every empty form collapses to NULL, not to an empty array.
  if public.fms_ocpi_doc_pages('[]'::jsonb, 'x') is not null
     or public.fms_ocpi_doc_pages('""'::jsonb, 'x') is not null
     or public.fms_ocpi_doc_pages(null, 'x') is not null then
    raise exception 'fms_ocpi_doc_pages no longer collapses the empty forms to NULL';
  end if;
end $$;

commit;
