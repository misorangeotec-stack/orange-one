-- ===========================================================================
-- Customer Onboarding — which of OUR Tally companies is this customer for?
--
-- WHY THIS WAS MISSING AND WHY IT MATTERS
--   A customer is onboarded so that a ledger can be created in Tally. Step 9
--   (fms_customer_record_tally) asks for the customer code, the ledger name and
--   the salesperson — and never asks which company's BOOKS the ledger belongs
--   in. Whoever keys it in has to already know.
--
--   A customer is genuinely a per-company thing: "APEX IMPEX" is three ledgers
--   in three companies with three separate credit limits. So the company is not
--   a step-9 detail, it is the framing question for the whole request — the
--   thing Accounts are proposing a credit limit FOR and the Director is
--   approving. It is therefore asked FIRST, before the GSTIN, and rides the
--   request to the end.
--
-- ⚠ THE DUPLICATE GUARD BECOMES PER-COMPANY (user's decision).
--   The same GSTIN may hold one live request in each company. See 3 below for
--   why the coalesce() in that index is load-bearing rather than decorative.
--
-- ADDITIVE: one new nullable column, one new index, one index replaced by a
-- strictly more permissive one. No data is rewritten, retyped or backfilled.
--
-- Reversal (in order):
--   create unique index fms_customer_requests_gst_live_uq
--     on public.fms_customer_requests (upper(btrim(gst_number)))
--     where status not in ('rejected','cancelled','draft') and gst_number is not null;
--   drop index if exists public.fms_customer_requests_company_gst_live_uq;
--   -- then re-run 20260803090000 (write_form) and 20260802120100
--   -- (submit_request, update_request) to restore the previous bodies
--   drop index if exists public.fms_customer_requests_company_idx;
--   alter table public.fms_customer_requests drop column if exists company_id;
-- ===========================================================================

-- ===========================================================================
-- 1. The column
-- ===========================================================================
alter table public.fms_customer_requests
  add column if not exists company_id uuid references public.mst_companies(id);

comment on column public.fms_customer_requests.company_id is
  'Which of OUR Tally companies this customer is being onboarded into — a '
  'mst_companies.id. Chosen at the GSTIN gate before the GST number is asked '
  'for, and required at submit. ⚠ RENDER THE ALIAS, never mst_companies.name: '
  'the name carries the financial year and the masters sync re-mints it every '
  'April, while the alias is portal-owned and stable. Null on every request '
  'raised before this shipped.';

-- Nullable and no default: every existing row stays valid, and a legacy row is
-- distinguishable from a deliberate choice. `on delete no action` (the default)
-- is wanted — a company with onboarding history must not be deletable.
create index if not exists fms_customer_requests_company_idx
  on public.fms_customer_requests (company_id);

-- ===========================================================================
-- 2. INTERNAL — write the step 1-7 form fields from a jsonb bag.
--
-- Unchanged from 20260803090000 except for the company_id assignment below.
-- Reproduced whole because create-or-replace has no partial form.
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
    -- ⚠ ORDINARY "absent means cleared", unlike gstin_snapshot below. The
    --   client sends company_id on every save (it is a step-1 form field, not a
    --   one-shot capture), so there is nothing to preserve against.
    company_id         = nullif(btrim(p->>'company_id'), '')::uuid,

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

-- ===========================================================================
-- 3. The duplicate guard, now scoped to the company.
--
-- ⚠ THE coalesce() IS LOAD-BEARING. Every request raised before today has a
--   NULL company_id, and NULLs never collide in a unique index — so indexing on
--   the bare column would drop the entire legacy population OUT of the guard,
--   and the same customer could be raised twice with nothing objecting.
--   Folding NULL onto a fixed sentinel keeps those rows guarded exactly as they
--   are today, while genuinely-chosen companies are compared normally.
--
-- The new index is strictly MORE permissive than the one it replaces (same key
-- plus a leading column), so no existing row can violate it — this cannot fail
-- on live data. It is created and asserted BEFORE the old one is dropped, so a
-- failure anywhere leaves the table guarded.
-- ===========================================================================
create unique index if not exists fms_customer_requests_company_gst_live_uq
  on public.fms_customer_requests
     (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
      upper(btrim(gst_number)))
  where status not in ('rejected','cancelled','draft') and gst_number is not null;

do $check$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'fms_customer_requests_company_gst_live_uq'
  ) then
    raise exception 'company+GSTIN guard was not created — refusing to drop the old one';
  end if;
end $check$;

drop index if exists public.fms_customer_requests_gst_live_uq;

-- ===========================================================================
-- 4. RPC — submit for approval.
--
-- Unchanged from 20260802120100 except that the duplicate lookup is now scoped
-- to the company. Reproduced whole because create-or-replace has no partial form.
--
-- ⚠⚠ EVERYTHING IN THIS MIGRATION IS BACKWARD-COMPATIBLE WITH THE FRONTEND
--    THAT IS ALREADY DEPLOYED, and that is not an accident — it is the whole
--    reason the "company is required" check lives in 20260918120200 instead of
--    here. An old client sends no company, its rows keep NULL, and the coalesce
--    sentinel in the new index guards them exactly as the old global index did.
--    A RAISE on a null company, by contrast, would refuse every submission from
--    a UI that has no way to answer it — a database change that breaks the live
--    app the moment it is applied, before any deploy.
--
--    Deploy ordering in this repo is "migration first, frontend second"
--    (CLAUDE.md). That only works while each migration is safe for the frontend
--    still running. Requirements go in the LAST migration, applied with the
--    deploy that satisfies them.
-- ===========================================================================
create or replace function public.fms_customer_submit_request(p_req uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r           public.fms_customer_requests%rowtype;
  v_uid       uuid := auth.uid();
  v_gst       text;
  v_state     text;
  v_statename text;
  v_no        text;
  v_fy        text;
  v_seq       integer;
  v_dupe      text;
  v_company   text;
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft','rework') then
    raise exception 'This request has already been submitted (status %)', r.status;
  end if;
  if r.raised_by <> v_uid and not public.fms_customer_is_coordinator(v_uid) then
    raise exception 'Only the person who raised this request may submit it';
  end if;

  -- ---- step 1 ----------------------------------------------------------
  -- ⚠ THE COMPANY IS NOT REQUIRED HERE, ON PURPOSE — see this migration's
  --   header. It becomes required in 20260918120200, which ships WITH the
  --   frontend that asks for it.
  if nullif(btrim(r.legal_name), '') is null then raise exception 'Step 1: legal company name is required'; end if;
  if r.customer_type is null              then raise exception 'Step 1: customer type is required'; end if;

  -- ---- step 2 ----------------------------------------------------------
  v_gst := upper(btrim(coalesce(r.gst_number, '')));
  if v_gst = '' then raise exception 'Step 2: GST number is required'; end if;
  if not public.fms_customer_validate_gstin(v_gst) then
    raise exception 'Step 2: % is not a valid GSTIN (format or checksum failed)', v_gst;
  end if;

  v_state := substring(v_gst from 1 for 2);
  select s.name into v_statename from public.fms_customer_gst_states s where s.code = v_state;
  if v_statename is null then
    raise exception 'Step 2: GST state code % is not recognised — tell an administrator to add it', v_state;
  end if;

  if nullif(btrim(r.registered_address), '') is null then raise exception 'Step 2: registered address is required'; end if;
  if nullif(btrim(r.city), '') is null              then raise exception 'Step 2: city is required'; end if;
  if nullif(btrim(r.factory_address), '') is null   then raise exception 'Step 2: factory address is required'; end if;
  if not r.billing_same_as_registered and nullif(btrim(r.billing_address), '') is null then
    raise exception 'Step 2: enter the billing address, or tick "same as registered"';
  end if;

  -- ---- step 3 (all four mandatory) -------------------------------------
  if nullif(btrim(r.contact_name), '') is null        then raise exception 'Step 3: contact person name is required'; end if;
  if nullif(btrim(r.contact_designation), '') is null then raise exception 'Step 3: designation is required'; end if;
  if coalesce(r.contact_mobile, '') !~ '^[0-9]{10}$'  then raise exception 'Step 3: mobile number must be 10 digits'; end if;
  if coalesce(r.contact_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Step 3: a valid email ID is required';
  end if;

  -- ---- steps 4 & 5 are ENTIRELY OPTIONAL — nothing to check here -------
  if 'other' = any(r.printing_applications)
     and nullif(btrim(r.printing_application_other), '') is null then
    raise exception 'Step 4: describe the "Other" printing application, or untick it';
  end if;

  -- ---- step 6 (reference 1 only) ---------------------------------------
  if nullif(btrim(r.ref1_company), '') is null then raise exception 'Step 6: trade reference 1 company name is required'; end if;
  if nullif(btrim(r.ref1_contact), '') is null then raise exception 'Step 6: trade reference 1 contact person is required'; end if;
  if nullif(btrim(r.ref1_mobile), '') is null  then raise exception 'Step 6: trade reference 1 mobile number is required'; end if;

  -- ---- step 7 (payment terms only; security_offered is optional) -------
  if r.payment_terms is null then raise exception 'Step 7: payment terms are required'; end if;

  -- ---- duplicate GSTIN, WITHIN THIS COMPANY -----------------------------
  -- Checked here so the user gets the other request's number instead of a raw
  -- unique-violation. The partial index is still the real guard against a race,
  -- and this condition mirrors it exactly — including the coalesce.
  select x.req_no into v_dupe from public.fms_customer_requests x
  where x.id <> p_req
    and upper(btrim(x.gst_number)) = v_gst
    and coalesce(x.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(r.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and x.status not in ('rejected','cancelled','draft')
  limit 1;
  if v_dupe is not null then
    select coalesce(nullif(btrim(c.alias), ''), c.name) into v_company
    from public.mst_companies c where c.id = r.company_id;
    raise exception 'A live onboarding request already exists for GSTIN % in % (%)',
      v_gst, coalesce(v_company, 'this company'), v_dupe;
  end if;

  -- ---- number it (rework keeps the number it already has) --------------
  if r.req_no is null then
    v_fy  := public.fms_customer_fy_code(current_date);
    v_seq := public.fms_customer_next_seq('CUST-' || v_fy);
    v_no  := 'CUST-' || v_fy || '-' || lpad(v_seq::text, 4, '0');
  else
    v_no := r.req_no;
  end if;

  update public.fms_customer_requests set
    req_no       = v_no,
    gst_number   = v_gst,
    -- Re-derived, always. An override is honoured only if it is a well-formed
    -- PAN; anything else falls back to what the GSTIN says.
    pan_number   = case
                     when coalesce(upper(btrim(r.pan_number)), '') ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
                       then upper(btrim(r.pan_number))
                     else public.fms_customer_pan_from_gstin(v_gst)
                   end,
    state_code   = v_state,
    state_name   = v_statename,
    status       = 'pending_accounts',
    current_step = 'accounts_verification',
    submitted_at = coalesce(submitted_at, now()),
    -- A resubmission clears the bounce but KEEPS rework_count as the tally.
    rework_at = null, rework_stage = null, rework_reason = null
  where id = p_req;

  perform public.fms_customer_announce(
    'request', p_req, 'submitted',
    'New customer ' || coalesce(r.legal_name, '') || ' (' || v_no || ') is ready for accounts verification.',
    public.fms_customer_step_owner_ids('accounts_verification'),
    jsonb_build_object('req_no', v_no, 'legal_name', r.legal_name, 'gst_number', v_gst,
                       'company_id', r.company_id));

  return v_no;
end $$;

-- create-or-replace preserves the existing ACL; restated so a fresh database
-- built from these migrations in order still ends up granted.
grant execute on function public.fms_customer_submit_request(uuid) to authenticated;

-- ===========================================================================
-- 5. RPC — edit the sales-side form after submission.
--
-- Unchanged from 20260802120100 except for the duplicate check at the end.
--
-- ⚠ WHY THIS CHECK IS NEW HERE. This path writes the form on a SUBMITTED row
--   and, until now, had no duplicate check at all — the partial unique index was
--   its only guard, so a collision surfaced as a raw unique_violation instead of
--   a sentence. That was survivable while gst_number was the only key; making
--   the company editable adds a second, much easier way to collide.
--
-- ⚠ IT MUST RUN AFTER write_form AND RE-READ THE ROW. `r` above is selected
--   before the write, so r.company_id / r.gst_number there are the OLD values —
--   checking against them would test the wrong pair entirely.
-- ===========================================================================
create or replace function public.fms_customer_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.fms_customer_requests%rowtype;
  v_uid     uuid := auth.uid();
  v_now     public.fms_customer_requests%rowtype;
  v_dupe    text;
  v_company text;
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.status = 'draft' then
    raise exception 'This is still a draft — save it instead';
  end if;
  if r.status not in ('rework','pending_accounts') or r.acc_verified_at is not null then
    raise exception 'This request can no longer be edited (status %)', r.status;
  end if;
  if r.raised_by <> v_uid and not public.fms_customer_is_coordinator(v_uid) then
    raise exception 'Only the person who raised this request may edit it';
  end if;

  perform public.fms_customer_write_form(p_req, p);

  -- Re-read: the values that matter are the ones write_form just landed.
  select * into v_now from public.fms_customer_requests where id = p_req;

  if nullif(btrim(v_now.gst_number), '') is not null then
    select x.req_no into v_dupe from public.fms_customer_requests x
    where x.id <> p_req
      and upper(btrim(x.gst_number)) = upper(btrim(v_now.gst_number))
      and coalesce(x.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(v_now.company_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and x.status not in ('rejected','cancelled','draft')
    limit 1;
    if v_dupe is not null then
      select coalesce(nullif(btrim(c.alias), ''), c.name) into v_company
      from public.mst_companies c where c.id = v_now.company_id;
      raise exception 'A live onboarding request already exists for GSTIN % in % (%)',
        upper(btrim(v_now.gst_number)), coalesce(v_company, 'this company'), v_dupe;
    end if;
  end if;

  update public.fms_customer_requests
     set edited_at = now(), edited_by = v_uid
   where id = p_req;
end $$;

grant execute on function public.fms_customer_update_request(uuid, jsonb) to authenticated;
