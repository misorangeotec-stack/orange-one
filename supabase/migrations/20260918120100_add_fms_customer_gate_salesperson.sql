-- ===========================================================================
-- Customer Onboarding — ask WHO OWNS the customer at the gate, not at step 9.
--
-- WHY THIS MOVES RATHER THAN ADDS
--   The salesperson was only ever captured at the very end, in
--   fms_customer_record_tally, alongside the ledger code. But the rep raising
--   the request is usually the salesperson, and everyone in between — Accounts
--   proposing a limit, the Sales Head grading, the Director approving — is
--   deciding about a named rep's customer. Asking last meant the answer was
--   absent for the whole of the process that depends on it.
--
-- ⚠ NO NEW COLUMN, DELIBERATELY. This writes `assigned_sales_exec_name`, the
--   SAME column the Tally step reads and writes (user's decision). A separate
--   "proposed salesperson" column would be a second truth that silently drifts
--   from the first; instead there is one answer, filled early and correctable at
--   step 9, which remains the last word before the ledger is made.
--
-- ⚠ WHY write_form OWNING IT IS NOT A RACE WITH assign_sales_exec.
--   write_form is reachable only via save_draft (drafts) and update_request,
--   and update_request refuses unless status is 'rework' or 'pending_accounts'
--   AND acc_verified_at is still null. record_tally cannot have run by then.
--   The one genuine overlap is a coordinator using the Assign card WHILE the
--   raiser has the edit form open — the ordinary last-write-wins of any shared
--   form, and now at least the field is visible to the person editing. An OLD
--   client cannot cause it at all: see the present-means-write note below.
--
-- ⚠ assigned_sales_exec_id IS NOT TOUCHED HERE. The portal user and the Tally
--   name are independent by design (see TallyPanel's header): the gate answers
--   the Tally name only, and the Assign card still owns the portal user and the
--   notification that goes with it.
--
-- ADDITIVE: no schema change at all — one function body.
--
-- ⚠ BACKWARD-COMPATIBLE, and it has to be. Applying this cannot break the
--   frontend still deployed: that client simply sends no
--   `assigned_sales_exec_name` key, so the field is written NULL on the draft
--   paths it uses — which is what it already was. Making the salesperson
--   REQUIRED is a separate migration (20260918120200) applied with the deploy
--   that asks for it.
--
-- Reversal: re-run 20260918120000 to restore the previous write_form body.
-- ===========================================================================

-- ===========================================================================
-- 1. INTERNAL — write the step 1-7 form fields from a jsonb bag.
--
-- Unchanged from 20260918120000 except for the assigned_sales_exec_name
-- assignment. Reproduced whole because create-or-replace has no partial form.
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
    -- ⚠ PRESENT-MEANS-WRITE, not the "absent means cleared" rule the rest of
    --   this function follows. `p ? 'key'` tests that the client actually SENT
    --   the field, rather than that it sent a value.
    --
    --   Both of these are step-1 fields that the current wizard always sends, so
    --   for it the two rules are identical. They differ for a client that predates
    --   them — a browser holding the previously deployed bundle, or the tab a rep
    --   left open across the deploy. Under "absent means cleared" that client's
    --   next autosave would silently blank the company, and worse, blank an
    --   `assigned_sales_exec_name` that the Assign card had set — a column this
    --   function did not touch at all until now, so nothing downstream expects it
    --   to be lost by an unrelated form save.
    company_id               = case
                                 when p ? 'company_id'
                                   then nullif(btrim(p->>'company_id'), '')::uuid
                                 else company_id
                               end,
    assigned_sales_exec_name = case
                                 when p ? 'assigned_sales_exec_name'
                                   then nullif(btrim(p->>'assigned_sales_exec_name'), '')
                                 else assigned_sales_exec_name
                               end,

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

