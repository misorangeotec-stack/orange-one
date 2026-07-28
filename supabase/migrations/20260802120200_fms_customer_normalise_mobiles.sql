-- ===========================================================================
-- CUSTOMER CREATION FMS — one mobile-normalisation rule, applied everywhere.
--
-- BUG THIS FIXES
--   fms_customer_write_form normalised contact_mobile properly (strip non-digits,
--   then drop a leading 91 or 0) but only stripped non-digits from ref1_mobile
--   and ref2_mobile. Caught in browser testing: a trade reference typed as
--   `09123456780` was stored verbatim as 11 digits, while the same number typed
--   into the contact field became `9123456780`. Two spellings of one number in
--   one row, which breaks any attempt to match a reference against a customer,
--   or to de-duplicate references across requests.
--
--   The root cause was the rule being written out three times instead of once.
--   This extracts it into fms_customer_norm_mobile() and calls that in all three
--   places, so the next field to need it cannot get a fourth variant.
--
-- Purely ADDITIVE: adds one immutable helper and re-issues one function body.
-- No table, column, constraint or policy changes. Existing rows are left alone
-- (there is no back-fill) — the only affected data would be trade references
-- captured before this ran, which are advisory free-text anyway.
--
-- Reversal:
--   re-apply 20260802120100_add_fms_customer_requests.sql to restore the old
--   fms_customer_write_form body, then
--   drop function if exists public.fms_customer_norm_mobile(text);
-- ===========================================================================

-- ===========================================================================
-- The single definition of "an Indian mobile number, as we store it".
--
-- Strip everything that is not a digit, then drop a leading country code (91) or
-- trunk zero ONLY when exactly ten digits remain after it.
--
-- The `(?=[0-9]{10}$)` lookahead is what makes that conditional, and it earns its
-- keep on the numbers that merely LOOK like they carry a prefix: a 9-digit
-- landline written `0265123456` keeps its zero (8 digits would remain, so it is
-- not a mobile with a trunk prefix), and a mistyped 13-digit string is left
-- intact for the validator to reject rather than silently reshaped into a
-- plausible wrong number. `919876543210` and `09876543210` DO lose their prefix,
-- because in both cases exactly ten digits follow — which is the whole point.
--
-- ⚠ MIRRORED CLIENT-SIDE as normaliseMobile() in
--   frontend/src/apps/receivables-hub/lib/customerOnboarding/schema.ts.
--   Keep the two in step. The server is the authority — the client copy exists
--   so the field shows the user the value that will actually be stored.
-- ===========================================================================
create or replace function public.fms_customer_norm_mobile(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(coalesce(p_raw, ''), '\D', '', 'g'),
      '^(91|0)(?=[0-9]{10}$)', ''
    ),
  '');
$$;

comment on function public.fms_customer_norm_mobile(text) is
  'Canonical mobile-number form for the Customer Creation FMS: bare 10 digits. Mirrored by normaliseMobile() in lib/customerOnboarding/schema.ts.';

grant execute on function public.fms_customer_norm_mobile(text) to authenticated;

-- ===========================================================================
-- Re-issue fms_customer_write_form so all three mobile fields go through the
-- helper. Body is otherwise identical to 20260802120100.
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

    contact_name        = nullif(btrim(p->>'contact_name'), ''),
    contact_designation = nullif(btrim(p->>'contact_designation'), ''),
    contact_mobile      = public.fms_customer_norm_mobile(p->>'contact_mobile'),
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
    ref1_mobile  = public.fms_customer_norm_mobile(p->>'ref1_mobile'),
    ref2_company = nullif(btrim(p->>'ref2_company'), ''),
    ref2_contact = nullif(btrim(p->>'ref2_contact'), ''),
    ref2_mobile  = public.fms_customer_norm_mobile(p->>'ref2_mobile'),

    payment_terms          = nullif(btrim(p->>'payment_terms'), ''),
    requested_credit_limit = nullif(btrim(p->>'requested_credit_limit'), '')::numeric,
    requested_credit_days  = nullif(btrim(p->>'requested_credit_days'), '')::integer,
    security_offered       = nullif(btrim(p->>'security_offered'), ''),
    credit_reason          = nullif(btrim(p->>'credit_reason'), '')
  where id = p_req;
end $$;
