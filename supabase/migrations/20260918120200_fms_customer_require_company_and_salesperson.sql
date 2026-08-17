-- ===========================================================================
-- Customer Onboarding — make the company and the salesperson REQUIRED at submit.
--
-- ⚠⚠ APPLY THIS WITH THE FRONTEND DEPLOY, NOT BEFORE IT.
--    Every other migration in this set is safe to apply against the frontend
--    already running: the column is nullable, the new duplicate index is a
--    superset of the old one, and write_form only writes the two new fields when
--    the client actually sends them. THIS one is different — it REFUSES a
--    submission that lacks them, so applying it while the deployed UI has no way
--    to answer would break every new-customer submission in production the
--    moment it lands.
--
--    The repo's rule is "migration first, frontend second" (CLAUDE.md), and that
--    holds for anything the frontend READS. A migration that DEMANDS something
--    from the frontend is the mirror case and belongs last.
--
-- ⚠ CONSEQUENCE FOR LEGACY ROWS. A request raised before these questions existed
--   carries neither, so if it is ever sent back for rework it cannot be
--   resubmitted until someone answers both. That is intended — they are exactly
--   the facts that were missing — and both sit on step 1 where the rep already
--   is. It affects only the rework path; completed and in-flight requests are
--   untouched.
--
-- ADDITIVE: one function body. No schema change.
--
-- Reversal: re-run 20260918120000, whose submit_request body is this one without
-- the two checks.
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
  if r.company_id is null then
    raise exception 'Step 1: choose the company this customer is being onboarded into';
  end if;
  if nullif(btrim(r.assigned_sales_exec_name), '') is null then
    raise exception 'Step 1: choose the salesperson who owns this customer';
  end if;
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
  -- Mirrors fms_customer_requests_company_gst_live_uq exactly, coalesce included.
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
    if v_company is null then
      raise exception 'A live onboarding request already exists for GSTIN % (%)', v_gst, v_dupe;
    else
      raise exception 'A live onboarding request already exists for GSTIN % in % (%)',
        v_gst, v_company, v_dupe;
    end if;
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
                       'company_id', r.company_id,
                       'sales_person', r.assigned_sales_exec_name));

  return v_no;
end $$;

grant execute on function public.fms_customer_submit_request(uuid) to authenticated;
