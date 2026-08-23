-- ===========================================================================
-- OCPI FMS — the quotation (part A) write door.
--
-- WHAT IS HERE
--   fms_ocpi_write_quotation(deal, jsonb)   internal — part-A columns only
--   fms_ocpi_save_draft(jsonb, deal)        create-or-update a draft
--   fms_ocpi_delete_draft(deal)             bin an abandoned draft
--   fms_ocpi_last_contact_for(customer)     prefill contacts from the last deal
--
-- ⚠ PART A AND PART B HAVE SEPARATE WRITERS, AND THAT IS THE POINT.
--   fms_ocpi_write_quotation touches ONLY the quotation columns. If one writer
--   overwrote the whole row from a payload, saving the quotation after the order
--   confirmation had been filled would blank every part-B answer — the warranty
--   periods, the dryer detail, the transport commitments — silently, because a
--   form that does not render a field also does not send it. The OC gets its own
--   writer in phase 6 for the mirror-image reason.
--
-- ⚠ THE BRANCH RULES ARE ENFORCED HERE TOO, NOT ONLY IN THE FORM.
--   Pick High Seas, answer CIF, then switch to Local Delivery: the form stops
--   showing the CIF question, but the answer is still on the row. Left there it
--   would print "Local Delivery … CIF" on a customer's contract, and it would
--   trip the fms_ocpi_transport_coherent CHECK on submit. So every field a
--   branch HIDES is nulled on write. The form (lib/branching.ts) does the same
--   thing for the user's benefit; this is the backstop that makes it true.
--
-- ⚠ A DRAFT VALIDATES ALMOST NOTHING. It only requires a customer name, so the
--   row can be found again in a list — everything else is the point of a draft.
--   Completeness is the submit RPC's job (phase 4), backed by the table CHECK.
--
-- ⚠ NO NUMBER IS MINTED HERE. quotation_no stays NULL for the whole of a
--   draft's life. An abandoned draft must not burn a number from a series
--   customers already hold.
--
-- Purely ADDITIVE: four functions, no schema change.
--
-- Reversal (reverse order):
--   drop function if exists public.fms_ocpi_last_contact_for(uuid);
--   drop function if exists public.fms_ocpi_delete_draft(uuid);
--   drop function if exists public.fms_ocpi_save_draft(jsonb, uuid);
--   drop function if exists public.fms_ocpi_write_quotation(uuid, jsonb);
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- INTERNAL — write the part-A form fields from a jsonb bag.
--
-- Not granted to authenticated: it performs no authz of its own and is reached
-- only through save_draft (and, in phase 4, the submit and edit RPCs).
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_quotation(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gst_available  boolean := (p->>'gst_available')::boolean;
  v_incl_ink       boolean := (p->>'incl_ink')::boolean;
  v_incl_spares    boolean := (p->>'incl_spares')::boolean;
  v_incl_head      boolean := (p->>'incl_head')::boolean;
  v_transport      text    := nullif(btrim(p->>'transport_terms'), '');
begin
  update public.fms_ocpi_deals set
    -- who
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),

    -- customer. customer_id is null for a brand-new lead that is not in Tally.
    customer_id        = nullif(p->>'customer_id', '')::uuid,
    customer_name      = nullif(btrim(p->>'customer_name'), ''),
    customer_address   = nullif(btrim(p->>'customer_address'), ''),
    customer_attn      = nullif(btrim(p->>'customer_attn'), ''),
    customer_email     = nullif(lower(btrim(p->>'customer_email')), ''),
    -- Normalised to bare 10 digits, so '+91 98790 72217' and '9879072217' are
    -- one number. Customer Onboarding does the same transform for the same
    -- reason: two spellings of one mobile is two customers.
    customer_mobile    = nullif(regexp_replace(
                           regexp_replace(coalesce(p->>'customer_mobile',''), '\D', '', 'g'),
                           '^(91|0)(?=[0-9]{10}$)', ''), ''),
    gst_available      = v_gst_available,
    -- BRANCH: no GST registration ⇒ there is no number to keep.
    gst_no             = case when v_gst_available is distinct from true then null
                              else nullif(upper(btrim(p->>'gst_no')), '') end,

    -- selling entity, resolved from the customer's Tally company
    company_id         = nullif(p->>'company_id', '')::uuid,
    location_id        = nullif(p->>'location_id', '')::uuid,

    -- machine
    machine_count      = nullif(p->>'machine_count', '')::integer,
    machine_id         = nullif(p->>'machine_id', '')::uuid,
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),

    -- deal inclusions
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

    -- commercial
    deal_value_currency = nullif(btrim(p->>'deal_value_currency'), ''),
    deal_value_amount   = nullif(p->>'deal_value_amount', '')::numeric,
    payment_type        = nullif(btrim(p->>'payment_type'), ''),
    payment_terms       = nullif(btrim(p->>'payment_terms'), ''),
    delivery_date       = nullif(p->>'delivery_date', '')::date,

    transport_terms     = v_transport,
    -- BRANCH: the two routes ask different follow-ups, and neither may keep the
    -- other's answer — see the header.
    high_seas_via       = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_via'), '') end,
    high_seas_cost_by   = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_cost_by'), '') end,
    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,

    remarks              = nullif(btrim(p->>'remarks'), ''),
    dollar_clause_agreed = (p->>'dollar_clause_agreed')::boolean
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_quotation(uuid, jsonb) is
  'Write the part-A (quotation) columns from a jsonb bag, nulling whatever the branch rules hide. Touches NO part-B column — see the migration header.';

-- ---------------------------------------------------------------------------
-- Create or update a draft quotation. Returns the deal id.
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
    -- A draft is private to its author; a coordinator may still tidy one up.
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  perform public.fms_ocpi_write_quotation(v_id, p);
  return v_id;
end $$;

comment on function public.fms_ocpi_save_draft(jsonb, uuid) is
  'Create or update a DRAFT quotation. Requires only a customer name — a draft is incomplete by definition. Mints no number.';
grant execute on function public.fms_ocpi_save_draft(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bin an abandoned draft.
--
-- ⚠ ONLY A DRAFT CAN BE DELETED. Once a quotation has been submitted it has a
--   number, and quite possibly a PDF in a customer's inbox — it is cancelled,
--   never deleted, so the number is never silently reused.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_delete_draft(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by into v_status, v_owner
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Quotation not found'; end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft can be deleted — a submitted quotation is cancelled instead';
  end if;
  if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
    raise exception 'This draft belongs to someone else';
  end if;

  delete from public.fms_ocpi_deals where id = p_deal;
end $$;

comment on function public.fms_ocpi_delete_draft(uuid) is
  'Delete a draft quotation. Refuses anything already submitted — that is cancelled, not deleted.';
grant execute on function public.fms_ocpi_delete_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Prefill: the contact details last recorded for this customer.
--
-- WHY THIS EXISTS
--   mst_parties.address, .email and .phone are empty in ALL 7,863 rows — the
--   Tally sync never fills them — so picking an existing customer yields a name
--   and, a quarter of the time, a GSTIN. Everything else has to be typed. Typed
--   ONCE, though: the next quotation for the same party starts from what the
--   last one recorded, and the module gets better at this the more it is used.
--
-- ⚠ SECURITY DEFINER ON PURPOSE, so the prefill works even when the previous
--   quotation belongs to a different salesperson. These are the CUSTOMER'S
--   contact details — company data about a party we trade with, not somebody's
--   private draft. Drafts are excluded anyway: an unfinished row is not a
--   reliable source, and it keeps this away from work in progress.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_last_contact_for(p_customer uuid)
returns table (
  customer_address text,
  customer_attn    text,
  customer_email   text,
  customer_mobile  text,
  gst_no           text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.customer_address, d.customer_attn, d.customer_email, d.customer_mobile, d.gst_no
    from public.fms_ocpi_deals d
   where d.customer_id = p_customer
     and d.status <> 'draft'
   order by d.created_at desc
   limit 1;
$$;

comment on function public.fms_ocpi_last_contact_for(uuid) is
  'The contact details last recorded against this Tally customer, for prefilling a new quotation. Tally itself holds none of these. Drafts excluded.';
grant execute on function public.fms_ocpi_last_contact_for(uuid) to authenticated;

commit;
