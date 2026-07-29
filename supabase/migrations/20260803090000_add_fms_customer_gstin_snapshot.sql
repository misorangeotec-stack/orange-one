-- ===========================================================================
-- Customer Onboarding — persist what the GST portal said at lookup time.
--
-- WHY A COLUMN AND NOT JUST A LIVE LOOKUP
--   The lookup happens once, at the GSTIN gate, when Sales raise the request.
--   The people who need the compliance half — Accounts proposing a credit limit,
--   the Director approving it — open the request days later. Re-querying then
--   would (a) spend another paid Appyflow call per approver per visit and (b)
--   silently change the evidence an approval was based on. So the snapshot is
--   frozen with the request, exactly like the credit-limit reason the Director
--   gate freezes.
--
--   It is deliberately a whole jsonb document rather than twenty columns: it is
--   evidence, read as a block, never filtered or aggregated on. Promoting a field
--   to a real column later stays possible and additive.
--
-- ADDITIVE ONLY: one new nullable column, and write_form gains one assignment.
-- Nothing existing is dropped, retyped or backfilled.
-- ===========================================================================

alter table public.fms_customer_requests
  add column if not exists gstin_snapshot jsonb;

comment on column public.fms_customer_requests.gstin_snapshot is
  'Frozen GST portal lookup taken when the request was raised: identity (Appyflow) '
  'plus compliance/filing history (jamku). Shape mirrors the gstin-lookup Edge '
  'Function''s data object, with the GSTIN echoed at .gstin so a changed GST '
  'number invalidates it. Null = no lookup ran, or no provider answered.';

-- ===========================================================================
-- INTERNAL — write the step 1-7 form fields from a jsonb bag.
--
-- Unchanged from 20260802120100 except for the gstin_snapshot assignment and the
-- invalidation statement below it. Reproduced whole because create-or-replace
-- has no partial form.
--
-- The client always sends the WHOLE form, so an absent key legitimately means
-- "cleared". Document columns are NOT touched here — they move only through
-- fms_customer_set_document, so saving the form can never blank an upload.
-- ===========================================================================
create or replace function public.fms_customer_write_form(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apps text[];
begin
  select coalesce(array_agg(x), '{}'::text[]) into v_apps
  from jsonb_array_elements_text(coalesce(p->'printing_applications', '[]'::jsonb)) as t(x)
  where nullif(btrim(x), '') is not null;

  update public.fms_customer_requests set
    legal_name         = nullif(btrim(p->>'legal_name'), ''),
    trade_name         = nullif(btrim(p->>'trade_name'), ''),
    customer_type      = nullif(btrim(p->>'customer_type'), ''),
    website            = nullif(btrim(p->>'website'), ''),

    gst_number         = nullif(upper(btrim(p->>'gst_number')), ''),
    pan_number         = nullif(upper(btrim(p->>'pan_number')), ''),
    msme_udyam_no      = nullif(btrim(p->>'msme_udyam_no'), ''),
    registered_address = nullif(btrim(p->>'registered_address'), ''),
    city               = nullif(btrim(p->>'city'), ''),
    factory_address    = nullif(btrim(p->>'factory_address'), ''),
    billing_same_as_registered = coalesce((p->>'billing_same_as_registered')::boolean, true),
    billing_address    = case when coalesce((p->>'billing_same_as_registered')::boolean, true)
                              then null else nullif(btrim(p->>'billing_address'), '') end,

    -- ⚠ PRESERVE-IF-ABSENT, unlike every other field here.
    --   A snapshot is captured once, at the gate. Every later autosave — and
    --   there is one every 2.5 seconds of typing — sends the form without having
    --   re-run the lookup, and the usual "absent means cleared" rule would wipe
    --   the evidence the approvers are meant to read. So only an actual object
    --   overwrites; anything else leaves the stored one alone.
    gstin_snapshot     = case
                           when jsonb_typeof(p->'gstin_snapshot') = 'object'
                             then p->'gstin_snapshot'
                           else gstin_snapshot
                         end,

    contact_name        = nullif(btrim(p->>'contact_name'), ''),
    contact_designation = nullif(btrim(p->>'contact_designation'), ''),
    -- Normalised to bare 10 digits. The wizard does the same transform; if only
    -- one side did it, '+91 90333 01207' and '9033301207' would be two customers
    -- and the GSTIN duplicate guard would be the only thing standing.
    contact_mobile      = nullif(regexp_replace(
                            regexp_replace(coalesce(p->>'contact_mobile',''), '\D', '', 'g'),
                            '^(91|0)(?=[0-9]{10}$)', ''), ''),
    contact_email       = nullif(lower(btrim(p->>'contact_email')), ''),

    printing_applications      = v_apps,
    printing_application_other = nullif(btrim(p->>'printing_application_other'), ''),
    current_ink_brand          = nullif(btrim(p->>'current_ink_brand'), ''),
    current_supplier           = nullif(btrim(p->>'current_supplier'), ''),
    monthly_ink_consumption    = nullif(btrim(p->>'monthly_ink_consumption'), ''),

    est_monthly_purchase = nullif(btrim(p->>'est_monthly_purchase'), '')::numeric,
    expected_first_order = nullif(btrim(p->>'expected_first_order'), '')::numeric,

    ref1_company = nullif(btrim(p->>'ref1_company'), ''),
    ref1_contact = nullif(btrim(p->>'ref1_contact'), ''),
    ref1_mobile  = nullif(regexp_replace(coalesce(p->>'ref1_mobile',''), '\D', '', 'g'), ''),
    ref2_company = nullif(btrim(p->>'ref2_company'), ''),
    ref2_contact = nullif(btrim(p->>'ref2_contact'), ''),
    ref2_mobile  = nullif(regexp_replace(coalesce(p->>'ref2_mobile',''), '\D', '', 'g'), ''),

    payment_terms          = nullif(btrim(p->>'payment_terms'), ''),
    requested_credit_limit = nullif(btrim(p->>'requested_credit_limit'), '')::numeric,
    requested_credit_days  = nullif(btrim(p->>'requested_credit_days'), '')::integer,
    security_offered       = nullif(btrim(p->>'security_offered'), ''),
    credit_reason          = nullif(btrim(p->>'credit_reason'), '')
  where id = p_req;

  -- A snapshot describes ONE GSTIN. If the rep goes back and edits the GST
  -- number, the frozen evidence now belongs to a different taxpayer — which is
  -- far worse than having none, because it still renders as fact. Drop it and
  -- let the gate re-run.
  update public.fms_customer_requests
     set gstin_snapshot = null
   where id = p_req
     and gstin_snapshot is not null
     and coalesce(upper(btrim(gstin_snapshot->>'gstin')), '') is distinct from coalesce(gst_number, '');
end $$;
