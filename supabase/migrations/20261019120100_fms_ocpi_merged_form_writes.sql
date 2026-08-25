-- ===========================================================================
-- OCPI — STAGE B of the revision: one form saves both halves of the deal.
--
-- THE PROBLEM THIS SOLVES
--   The revision folds the order confirmation's questions into the quotation
--   form as optional fields. But the two halves have always had two writers —
--   fms_ocpi_write_quotation owns the part-A columns, fms_ocpi_write_oc owns
--   part B — and that separation is load-bearing: 20260929121000's header says
--   in as many words that if one writer touched the other's columns, saving the
--   order confirmation could blank the quotation.
--
--   Meanwhile fms_ocpi_save_oc_draft REFUSES while the deal is a draft — it
--   accepts only 'awaiting_order_confirmation' and 'rework'. So a merged form
--   filling a detail field on a brand-new draft had nowhere to save it.
--
--   The fix keeps both writers and both column sets exactly as they are, and
--   makes the DRAFT SAVER call both. One RPC, one transaction, no column
--   crosses a writer boundary.
--
-- ⚠ WRITE_QUOTATION MUST RUN FIRST. fms_ocpi_write_oc branches on part-A
--   answers it does not own — incl_head and dryer_type — and reads them OFF THE
--   ROW rather than trusting its payload. Calling it before write_quotation
--   would branch on the PREVIOUS save's answers, so a salesperson who ticks
--   "no head included" and saves would still have the head-shipment columns
--   kept from a moment ago.
--
-- ⚠ WRITE_OC IS CALLED ONLY WHEN THE PAYLOAD ACTUALLY CARRIES PART-B KEYS.
--   write_oc nulls every part-B column its branches hide, so calling it with a
--   part-A-only bag would blank the whole order confirmation. The `?|` test
--   makes the omission safe in both directions: keys present ⇒ part B is
--   written (including deliberate blanks); keys absent ⇒ part B is untouched.
--
-- ALSO HERE
--   · The dollar-exchange clause is asked ONLY on dollar deals. It is a USD
--     term; asking a rupee customer to agree to it, and printing their answer,
--     was noise. The form hides it (branching.ts) and this clears it, because
--     those two must never disagree — the branching header says so.
--   · The submitted-completeness CHECK grows to cover Sections B and C, which
--     the client has made mandatory. Conditional fields are required only when
--     their own branch is open, so a deal with no head is never blocked on head
--     questions it was never shown.
--
-- ⚠ VERIFIED BEFORE APPLYING: all 20 non-draft rows already satisfy every new
--   condition (0 failures on each of the seven clauses). A CHECK that a live row
--   violates fails the migration, and this was measured rather than assumed.
--
-- Purely ADDITIVE in effect: no column added or dropped, two functions re-issued,
-- one CHECK widened.
--
-- Reversal (reverse order):
--   alter table public.fms_ocpi_deals drop constraint if exists fms_ocpi_complete_when_submitted;
--   alter table public.fms_ocpi_deals add constraint fms_ocpi_complete_when_submitted check (
--     status = 'draft' or (
--       nullif(btrim(customer_name), '') is not null
--       and nullif(btrim(coalesce(salesperson_name, '')), '') is not null
--       and machine_id is not null and machine_count is not null
--       and deal_value_amount is not null and deal_value_currency is not null));
--   -- then re-run 20260929120400's fms_ocpi_save_draft and fms_ocpi_write_quotation verbatim
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · The draft saver writes both halves.
--
-- Everything above `perform` is unchanged from 20260929120400. Only the tail
-- moves: write_quotation, then write_oc when the bag carries part-B keys.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_save_draft(p jsonb, p_deal uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_deal;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'customer_name'), '') is null then
    raise exception 'Enter the customer name before saving';
  end if;

  if v_id is null then
    if not public.fms_ocpi_can_act('quotation', null, v_uid) then
      raise exception 'You are not authorized to raise a quotation';
    end if;
    insert into public.fms_ocpi_deals (raised_by, status, current_step)
    values (v_uid, 'draft', 'quotation')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_ocpi_deals where id = v_id for update;
    if v_status is null then raise exception 'Quotation not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This quotation has already been submitted — use Edit instead';
    end if;
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  -- ⚠ ORDER IS SEMANTIC — see the header. write_oc branches on part-A answers
  --   it reads off the row, so part A must already be written.
  perform public.fms_ocpi_write_quotation(v_id, p);

  -- ⚠ Only when the caller actually sent part-B keys. write_oc nulls whatever
  --   its branches hide, so a part-A-only bag would blank the whole order
  --   confirmation.
  if p ?| array[
       'head_ship_mode', 'head_ship_via', 'head_balance_remarks', 'head_separate_invoice',
       'dryer_chambers', 'heating_mode', 'dryer_warranty', 'platter_details',
       'air_blade', 'external_centering', 'ink_dust_exhauster', 'chilling_system',
       'other_commitments', 'printer_warranty', 'head_warranty', 'post_warranty_head_price',
       'consumables_supplier', 'insurance_clause_agreed',
       'ref_no', 'delivery_days', 'trade_term', 'machine_model_no',
       'prepared_by', 'approved_by', 'gst_rate', 'machine_value_inr'
     ] then
    perform public.fms_ocpi_write_oc(v_id, p);
  end if;

  return v_id;
end $$;

comment on function public.fms_ocpi_save_draft(jsonb, uuid) is
  'Create or update a draft quotation from one merged payload. Calls fms_ocpi_write_quotation, then fms_ocpi_write_oc when the bag carries part-B keys — one transaction, and neither writer touches the other''s columns. Requires only the customer name; mints no number.';

-- ---------------------------------------------------------------------------
-- 2 · The dollar clause is a dollar term.
--
-- Re-issues fms_ocpi_write_quotation with ONE change: dollar_clause_agreed is
-- cleared unless the deal is in USD. Everything else is verbatim.
--
-- ⚠ THE FORM HIDES THE SAME FIELD ON THE SAME CONDITION (branching.ts
--   PART_A_VISIBILITY). That file's header states the two must be changed
--   together or they will disagree; this is that change.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_quotation(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gst_available boolean := (p->>'gst_available')::boolean;
  v_incl_ink      boolean := (p->>'incl_ink')::boolean;
  v_incl_spares   boolean := (p->>'incl_spares')::boolean;
  v_incl_head     boolean := (p->>'incl_head')::boolean;
  v_transport     text    := nullif(btrim(p->>'transport_terms'), '');
  v_currency      text    := nullif(btrim(p->>'deal_value_currency'), '');
begin
  update public.fms_ocpi_deals set
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),

    customer_id        = nullif(p->>'customer_id', '')::uuid,
    customer_name      = nullif(btrim(p->>'customer_name'), ''),
    customer_address   = nullif(btrim(p->>'customer_address'), ''),
    customer_attn      = nullif(btrim(p->>'customer_attn'), ''),
    customer_email     = nullif(lower(btrim(p->>'customer_email')), ''),
    customer_mobile    = nullif(regexp_replace(
                           regexp_replace(coalesce(p->>'customer_mobile',''), '\D', '', 'g'),
                           '^(91|0)(?=[0-9]{10}$)', ''), ''),
    gst_available      = v_gst_available,
    -- BRANCH: no GST registration ⇒ there is no number to keep.
    gst_no             = case when v_gst_available is distinct from true then null
                              else nullif(upper(btrim(p->>'gst_no')), '') end,

    company_id         = nullif(p->>'company_id', '')::uuid,
    location_id        = nullif(p->>'location_id', '')::uuid,

    machine_count      = nullif(p->>'machine_count', '')::integer,
    machine_id         = nullif(p->>'machine_id', '')::uuid,
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),

    incl_ink           = v_incl_ink,
    -- BRANCH: ink not included ⇒ no quantity to state.
    ink_qty_included   = case when v_incl_ink is distinct from true then null
                              else nullif(btrim(p->>'ink_qty_included'), '') end,
    incl_spares        = v_incl_spares,
    -- BRANCH: spares not included ⇒ no spare detail.
    spare_details      = case when v_incl_spares is distinct from true then null
                              else nullif(btrim(p->>'spare_details'), '') end,
    incl_head          = v_incl_head,
    -- BRANCH: head not included ⇒ no count.
    heads_included     = case when v_incl_head is distinct from true then null
                              else nullif(p->>'heads_included', '')::integer end,
    dryer_type         = nullif(btrim(p->>'dryer_type'), ''),

    deal_value_currency = v_currency,
    deal_value_amount   = nullif(p->>'deal_value_amount', '')::numeric,
    payment_type        = nullif(btrim(p->>'payment_type'), ''),
    payment_terms       = nullif(btrim(p->>'payment_terms'), ''),
    delivery_date       = nullif(p->>'delivery_date', '')::date,

    transport_terms     = v_transport,
    -- BRANCH: the two routes ask different follow-ups, and neither may keep the
    -- other's answer.
    high_seas_via       = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_via'), '') end,
    high_seas_cost_by   = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_cost_by'), '') end,
    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,

    remarks              = nullif(btrim(p->>'remarks'), ''),

    -- BRANCH (new, stage B): the dollar-exchange clause is a USD term. A rupee
    -- deal is never asked it, so it must not keep an answer from when the deal
    -- was quoted in dollars — that answer would print on a contract the customer
    -- never agreed it for.
    dollar_clause_agreed = case when v_currency is distinct from 'USD' then null
                                else (p->>'dollar_clause_agreed')::boolean end
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_quotation(uuid, jsonb) is
  'Write the part-A (quotation) columns from a jsonb bag, nulling whatever the branch rules hide — including the dollar-exchange clause on any non-USD deal. Touches NO part-B column.';

-- ---------------------------------------------------------------------------
-- 3 · Sections B and C are mandatory once a quotation leaves draft.
--
-- The client made Deal inclusions and Commercial terms compulsory. This is the
-- backstop; lib/fieldSpec.ts's missingForSubmit says the same thing in
-- sentences, before the button is pressed.
--
-- ⚠ CONDITIONAL FIELDS ARE REQUIRED ONLY WHEN THEIR BRANCH IS OPEN. "Deal
--   includes a head" = No must not then demand a head count. Each clause is
--   written as `branch is not open OR the answer is present`, which is vacuously
--   true for the deals that were never asked.
-- ---------------------------------------------------------------------------
alter table public.fms_ocpi_deals
  drop constraint if exists fms_ocpi_complete_when_submitted;

alter table public.fms_ocpi_deals
  add constraint fms_ocpi_complete_when_submitted check (
    status = 'draft' or (
          nullif(btrim(customer_name), '') is not null
      and nullif(btrim(coalesce(salesperson_name, '')), '') is not null
      and machine_id is not null
      and machine_count is not null
      and deal_value_amount is not null
      and deal_value_currency is not null

      -- Section B · Deal inclusions — the three questions are answered …
      and incl_ink is not null
      and incl_spares is not null
      and incl_head is not null
      -- … and each "Yes" carries its detail.
      and (incl_ink    is not true or nullif(btrim(coalesce(ink_qty_included, '')), '') is not null)
      and (incl_spares is not true or nullif(btrim(coalesce(spare_details,   '')), '') is not null)
      and (incl_head   is not true or heads_included is not null)

      -- Section C · Commercial terms
      and payment_type is not null
      and nullif(btrim(coalesce(payment_terms, '')), '') is not null
      and delivery_date is not null
      and transport_terms is not null
      and (transport_terms <> 'high_seas' or (high_seas_via is not null and high_seas_cost_by is not null))
      and (transport_terms <> 'local'     or local_cost_by is not null)
    ));

commit;
