-- ===========================================================================
-- CUSTOMER CREATION FMS — REQUESTS + WORKFLOW (Phase 1).
--
-- One wide table holding all nine steps of the onboarding form, plus every
-- workflow RPC. Depends on 20260802120000_add_fms_customer_foundations.sql.
--
-- ⚠⚠ DO NOT WIRE THIS MODULE TO ORDER-TO-DISPATCH. There is no
--   dispatch_customer_id column and no push_to_dispatch RPC, deliberately —
--   Order-to-Dispatch sources its customer data from elsewhere. The completed
--   request IS the record. Decided 28-Jul-2026; do not "helpfully" add it.
--
-- ⚠ WHY ONE WIDE TABLE AND NOT A REFERENCES LINE TABLE
--   The form has EXACTLY two trade references, of which the first is mandatory
--   and the second optional. That asymmetry is a column-level rule; in a line
--   table it degrades into a trigger or an RPC-only invariant that nothing
--   enforces if a row is ever written directly. Same call as
--   fms_supplies_requests ("case-style, no header+line split"). If N references
--   ever becomes real it is an additive table + backfill + view — don't pay now.
--
-- ⚠ DRAFTS ARE WHY ALMOST NOTHING IS `not null`
--   A draft is by definition incomplete, so the mandatory fields cannot be
--   column-level NOT NULL. They are enforced by ONE deferred-in-spirit CHECK,
--   fms_customer_complete_when_submitted, which applies to every row whose
--   status is not 'draft'. submit_request raises friendly, field-named errors
--   long before that constraint can fire — the constraint is the backstop that
--   makes the rule true even for a direct write.
--
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL — announce() is
--   best-effort and its errors are swallowed. Every step stamps its own
--   *_at / *_by columns on this table, and those are the history.
--
-- ⚠ STATUSES ARE NOT STEP KEYS. completed / rejected / rework / on_hold /
--   cancelled live in `status` and never in StepKey. A status loose in the queue
--   is work owed by nobody.
--
-- ⚠ RLS IS InitPlan-WRAPPED AND ITS NEIGHBOURS ARE NOT — deliberate; see the
--   foundations header. Note especially that the read policy does NOT call
--   fms_customer_can_read_request(id, uid): that helper takes a PER-ROW column
--   as an argument, so wrapping it in (select …) would change nothing and it
--   would run once per row. The constant predicates are inlined as InitPlans and
--   only cheap column comparisons are left per-row. The helper still exists
--   because the RPCs call it with a single known id.
--
-- Purely ADDITIVE. Reversal (in order):
--   drop policy if exists "fms customer docs read"/"…insert"/"…update"/"…delete" on storage.objects;
--   drop policy if exists fms_customer_activity_select on public.fms_customer_activity;
--   drop function if exists public.fms_customer_reopen_request(uuid,text);
--   drop function if exists public.fms_customer_cancel_request(uuid,text);
--   drop function if exists public.fms_customer_hold_request(uuid,boolean,text);
--   drop function if exists public.fms_customer_assign_sales_exec(uuid,uuid,text);
--   drop function if exists public.fms_customer_set_document(uuid,text,text,text);
--   drop function if exists public.fms_customer_record_tally(uuid,jsonb);
--   drop function if exists public.fms_customer_decide_director(uuid,jsonb);
--   drop function if exists public.fms_customer_decide_sales_head(uuid,jsonb);
--   drop function if exists public.fms_customer_decide_accounts(uuid,jsonb);
--   drop function if exists public.fms_customer_submit_request(uuid);
--   drop function if exists public.fms_customer_update_request(uuid,jsonb);
--   drop function if exists public.fms_customer_delete_draft(uuid);
--   drop function if exists public.fms_customer_save_draft(jsonb,uuid);
--   drop function if exists public.fms_customer_write_form(uuid,jsonb);
--   drop function if exists public.fms_customer_resume_status(uuid);
--   drop function if exists public.fms_customer_can_act(text,uuid,uuid);
--   drop function if exists public.fms_customer_can_read_request(uuid,uuid);
--   drop function if exists public.fms_customer_director_required(uuid);
--   drop function if exists public.fms_customer_pan_from_gstin(text);
--   drop function if exists public.fms_customer_validate_gstin(text);
--   drop table if exists public.fms_customer_requests;
-- ===========================================================================

create table if not exists public.fms_customer_requests (
  id      uuid primary key default gen_random_uuid(),

  -- NULL while draft; stamped by submit. An abandoned draft must not burn a
  -- number and leave a hole in the CUST-2627-#### series (partial unique below).
  req_no  text,

  -- ======================= STEP 1 — customer information ===================
  legal_name    text,
  trade_name    text,
  customer_type text check (customer_type is null or customer_type in
                  ('manufacturer','dealer','distributor','trader','exporter','end_user')),
  website       text,

  -- ======================= STEP 2 — business & KYC ==========================
  -- state_code/state_name are DERIVED from gst_number by submit_request, never
  -- trusted from the client. state_name is a SNAPSHOT so renaming a state in
  -- fms_customer_gst_states can never rewrite what a past request recorded.
  -- NOTE: there is no `region` column. Region was dropped from the form on the
  -- user's instruction (28-Jul-2026) — do not reintroduce it.
  gst_number         text,
  pan_number         text,
  msme_udyam_no      text,
  registered_address text,
  city               text,
  state_code         text references public.fms_customer_gst_states(code),
  state_name         text,
  factory_address    text,
  billing_same_as_registered boolean not null default true,
  billing_address    text,

  -- All four KYC uploads are OPTIONAL (per the amended spec). No attachments
  -- table: each document is a path + original-filename pair, written only via
  -- fms_customer_set_document so the form save can never blank one.
  gst_doc_path    text, gst_doc_name    text,
  pan_doc_path    text, pan_doc_name    text,
  cheque_doc_path text, cheque_doc_name text,
  msme_doc_path   text, msme_doc_name   text,

  -- ======================= STEP 3 — contact (all mandatory) ================
  contact_name        text,
  contact_designation text,
  contact_mobile      text,          -- normalised to bare 10 digits
  contact_email       text,

  -- ======================= STEP 4 — ink profile (FULLY optional) ===========
  -- text[] rather than jsonb: a closed seven-value vocabulary, so it is
  -- CHECK-able, GIN-indexable and filterable with @>.
  -- ⚠ The `<@` containment test yields NULL (not false) if the array holds a
  --   NULL element, which would let '{null}' pass — hence the array_position
  --   conjunct. Do not simplify it away.
  printing_applications      text[] not null default '{}',
  printing_application_other text,
  current_ink_brand          text,
  current_supplier           text,
  monthly_ink_consumption    text check (monthly_ink_consumption is null
    or monthly_ink_consumption in ('lt_100','100_300','300_500','500_1000','gt_1000')),

  -- ======================= STEP 5 — business potential (optional) ==========
  est_monthly_purchase numeric(16,2),
  expected_first_order numeric(16,2),

  -- ======================= STEP 6 — trade references =======================
  -- Reference 1 required once submitted (see the completeness CHECK); 2 optional.
  ref1_company text, ref1_contact text, ref1_mobile text,
  ref2_company text, ref2_contact text, ref2_mobile text,

  -- ======================= STEP 7 — credit request =========================
  -- security_offered is OPTIONAL per the amended spec. A 'credit' request with
  -- no limit named is ALLOWED — the UI shows an amber note, never an error.
  payment_terms          text check (payment_terms is null or payment_terms in ('advance','credit')),
  requested_credit_limit numeric(16,2),
  requested_credit_days  integer,
  security_offered       text check (security_offered is null
                           or security_offered in ('pdc','bank_guarantee','none')),
  credit_reason          text,

  -- ======================= per-request assignment ==========================
  -- BOTH, deliberately. The uuid is the portal user: it drives notifications and
  -- grants read access below. The name is the Tally `customers.sales_person`
  -- STRING that the hub's own scoping keys on (profiles.receivables_salespersons
  -- / lib/scope.tsx) — a different vocabulary that does not map to user ids.
  -- Storing only one of them breaks either the bell or the rep's dashboard.
  assigned_sales_exec_id   uuid references auth.users on delete set null,
  assigned_sales_exec_name text,

  -- ======================= workflow ========================================
  status text not null default 'draft' check (status in (
    'draft','pending_accounts','pending_sales_head','pending_director',
    'pending_tally','completed','rejected','rework','on_hold','cancelled')),
  current_step   text not null default 'submission',
  raised_by      uuid references auth.users on delete set null,
  raised_by_name text,
  submitted_at   timestamptz,

  -- ================= STEP 8a — accounts verification =======================
  acc_gst_verified      boolean,
  acc_refs_verified     boolean,
  acc_recommended_limit numeric(16,2),
  acc_recommended_days  integer,
  acc_remarks           text,
  acc_verified_date     date,
  acc_verified_at       timestamptz,
  acc_verified_by       uuid references auth.users on delete set null,

  -- ================= STEP 8b — sales head ==================================
  -- Category is A–E, not the document's A/B/C: the hub's live vocabulary
  -- (lib/customerCategory.ts) is A/B/C/D/E and the reports people already read
  -- are cut that way. Widening later would be a data migration; narrowing is free.
  sh_customer_category  text check (sh_customer_category is null
                          or sh_customer_category in ('A','B','C','D','E')),
  sh_business_potential text,
  sh_decision           text check (sh_decision is null or sh_decision in ('approve','reject','rework')),
  sh_force_director     boolean not null default false,
  sh_remarks            text,
  sh_decided_date       date,
  sh_decided_at         timestamptz,
  sh_decided_by         uuid references auth.users on delete set null,

  -- ================= STEP 8c — director (conditional) ======================
  -- FROZEN at the moment the Sales Head approves, together with the threshold
  -- then in force. Deriving "was a Director needed?" live would mean an admin
  -- editing the threshold silently rewrites the history of every past request.
  dir_required              boolean not null default false,
  dir_required_reason       text check (dir_required_reason is null
                              or dir_required_reason in ('threshold','forced')),
  dir_threshold_at_decision numeric(16,2),
  dir_decision              text check (dir_decision is null or dir_decision in ('approve','reject','rework')),
  dir_remarks               text,
  dir_decided_date          date,
  dir_decided_at            timestamptz,
  dir_decided_by            uuid references auth.users on delete set null,

  -- ================= STEP 9 — customer creation (Tally) ====================
  -- customer_code is TYPED IN, not generated: Tally (or Accounts) issues it.
  -- req_no is our number; customer_code is theirs. NO dispatch_customer_id.
  customer_code        text,
  tally_ledger_created boolean,
  tally_ledger_name    text,
  customer_status      text check (customer_status is null
                         or customer_status in ('active','hold','rejected')),
  tally_date           date,
  tally_at             timestamptz,
  tally_by             uuid references auth.users on delete set null,

  -- ================= terminal / exception ==================================
  rejected_at  timestamptz, reject_stage text, reject_reason text,
  rework_at    timestamptz, rework_stage text, rework_reason text,
  rework_count integer not null default 0,
  hold_at      timestamptz, hold_reason text,
  cancelled_at timestamptz, cancel_reason text,
  edited_at    timestamptz, edited_by uuid references auth.users on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fms_customer_printing_apps_valid check (
    printing_applications <@ array['dtf','sublimation','reactive','pigment','uv','textile','other']::text[]
    and array_position(printing_applications, null) is null
  ),

  -- The mandatory-field rule, expressed once. Everything the amended spec marks
  -- with an asterisk, and nothing else: step 4 and step 5 are entirely optional,
  -- reference 2 is optional, security_offered is optional, and all four KYC
  -- uploads are optional.
  constraint fms_customer_complete_when_submitted check (
    status = 'draft' or (
          nullif(btrim(legal_name), '')         is not null
      and customer_type                          is not null
      and nullif(btrim(gst_number), '')          is not null
      and nullif(btrim(pan_number), '')          is not null
      and nullif(btrim(registered_address), '')  is not null
      and nullif(btrim(city), '')                is not null
      and nullif(btrim(state_code), '')          is not null
      and nullif(btrim(factory_address), '')     is not null
      and nullif(btrim(contact_name), '')        is not null
      and nullif(btrim(contact_designation), '') is not null
      and nullif(btrim(contact_mobile), '')      is not null
      and nullif(btrim(contact_email), '')       is not null
      and nullif(btrim(ref1_company), '')        is not null
      and nullif(btrim(ref1_contact), '')        is not null
      and nullif(btrim(ref1_mobile), '')         is not null
      and payment_terms                          is not null
    )
  )
);

comment on table public.fms_customer_requests is
  'New-customer onboarding requests (9-step form). One row per prospective customer. ⚠ NOTHING here is ever pushed to fms_dispatch_* — Order-to-Dispatch sources customers elsewhere. The completed row IS the record.';

drop trigger if exists trg_fms_customer_requests_updated on public.fms_customer_requests;
create trigger trg_fms_customer_requests_updated
  before update on public.fms_customer_requests
  for each row execute function public.set_updated_at();

-- req_no unique only once stamped — drafts carry NULL and must not collide.
create unique index if not exists fms_customer_requests_req_no_uq
  on public.fms_customer_requests (req_no) where req_no is not null;

-- Duplicate guard: one LIVE request per GSTIN. Deliberately PERMISSIVE about
-- rejected/cancelled rows — a customer turned down today may be re-raised later
-- with better information (user's decision, 28-Jul-2026), and the old row keeps
-- the reason. Drafts are excluded so two reps drafting the same prospect don't
-- deadlock before either has committed.
create unique index if not exists fms_customer_requests_gst_live_uq
  on public.fms_customer_requests (upper(btrim(gst_number)))
  where status not in ('rejected','cancelled','draft') and gst_number is not null;

create index if not exists fms_customer_requests_status_idx on public.fms_customer_requests (status);
create index if not exists fms_customer_requests_raised_idx on public.fms_customer_requests (raised_by);
create index if not exists fms_customer_requests_exec_idx   on public.fms_customer_requests (assigned_sales_exec_id);
create index if not exists fms_customer_requests_apps_idx   on public.fms_customer_requests using gin (printing_applications);

-- ===========================================================================
-- GSTIN — format + mod-36 checksum.
--
-- Layout: 2 state + 10 PAN + 1 entity + 1 'Z' + 1 check = 15.
-- Algorithm: index each of the first 14 characters in base-36; multiply by an
-- alternating weight of 1,2,1,2,…; for each product add floor(p/36) + (p mod 36);
-- the check character's value is (36 - sum mod 36) mod 36.
--
-- ⚠ THIS IS THE AUTHORITATIVE COPY. A mirror lives in
--   frontend/src/apps/receivables-hub/lib/customerOnboarding/gstin.ts purely so
--   the wizard can underline a bad GSTIN before Next is pressed. submit_request
--   re-runs THIS one, so a client that skips or fakes its check gains nothing.
--   Keep the two in step — there are fixtures on both sides.
-- ===========================================================================
create or replace function public.fms_customer_validate_gstin(p_gstin text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_g     text := upper(btrim(coalesce(p_gstin, '')));
  v_alpha text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_sum   integer := 0;
  v_val   integer;
  v_prod  integer;
  i       integer;
begin
  if v_g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then
    return false;
  end if;

  for i in 1..14 loop
    v_val := strpos(v_alpha, substr(v_g, i, 1)) - 1;
    if v_val < 0 then return false; end if;
    v_prod := v_val * (case when i % 2 = 1 then 1 else 2 end);
    v_sum  := v_sum + (v_prod / 36) + (v_prod % 36);
  end loop;

  return substr(v_alpha, ((36 - (v_sum % 36)) % 36) + 1, 1) = substr(v_g, 15, 1);
end $$;
grant execute on function public.fms_customer_validate_gstin(text) to authenticated;

-- PAN is characters 3..12 of the GSTIN.
-- ⚠ OFF-BY-ONE: this is substring(g from 3 for 10) — 1-indexed, length-based.
--   The TS mirror is g.slice(2, 12) — 0-indexed, end-EXCLUSIVE. They agree.
--   Get either wrong and every PAN in the system is silently one char off.
create or replace function public.fms_customer_pan_from_gstin(p_gstin text)
returns text
language sql
immutable
as $$
  select substring(upper(btrim(coalesce(p_gstin, ''))) from 3 for 10);
$$;
grant execute on function public.fms_customer_pan_from_gstin(text) to authenticated;

-- ===========================================================================
-- Does this request need a Director?
--
-- Routed on the ACCOUNTS-RECOMMENDED limit where one exists, falling back to
-- what the customer asked for. The recommendation is the number that will
-- actually be granted; routing on the customer's ask would let a rep trigger —
-- or dodge — a Director review by typing a different figure.
-- ===========================================================================
create or replace function public.fms_customer_director_required(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Advance-payment customers carry no credit exposure.
    when r.payment_terms = 'advance'
         and coalesce((c.value->>'exempt_advance_terms')::boolean, true)
      then false
    -- A credit customer who named no limit and got no recommendation.
    when coalesce(r.acc_recommended_limit, r.requested_credit_limit) is null
         and coalesce((c.value->>'exempt_when_no_limit_requested')::boolean, true)
      then false
    else coalesce(r.acc_recommended_limit, r.requested_credit_limit, 0)
       > coalesce((c.value->>'director_threshold')::numeric, 0)
  end
  from public.fms_customer_requests r
  left join public.fms_customer_config c on c.key = 'approval'
  where r.id = p_req;
$$;
grant execute on function public.fms_customer_director_required(uuid) to authenticated;

-- ===========================================================================
-- AUTHZ
-- ===========================================================================

-- Single-row read gate. Used by the RPCs (which know one id). NOT used as the
-- RLS policy body — see the header for why.
create or replace function public.fms_customer_can_read_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_customer_requests r
    where r.id = p_req
      and (r.status <> 'draft' or r.raised_by = p_uid or public.is_admin(p_uid))
      and ( public.is_admin(p_uid)
         or public.fms_customer_is_coordinator(p_uid)
         or public.fms_customer_is_any_step_owner(p_uid)
         or r.raised_by = p_uid
         or r.assigned_sales_exec_id = p_uid )
  );
$$;
grant execute on function public.fms_customer_can_read_request(uuid, uuid) to authenticated;

-- May this user action this step on this request?
-- ⚠ MIRRORED CLIENT-SIDE in lib/customerOnboarding/store.tsx as canActOn().
--   Keep this list and that one in step. The UI greys a button; THIS is the gate.
create or replace function public.fms_customer_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_uid is null then return false; end if;
  if public.is_admin(p_uid) or public.fms_customer_is_coordinator(p_uid) then return true; end if;

  -- The raiser owns their own submission, both first time and after a rework.
  if p_step_key = 'submission' then
    return exists (select 1 from public.fms_customer_requests r
                   where r.id = p_req and r.raised_by = p_uid);
  end if;

  return public.fms_customer_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_customer_can_act(text, uuid, uuid) to authenticated;

-- Where a held request goes back to. Derived from current_step, which hold does
-- not touch — so a stashed status can never go stale.
create or replace function public.fms_customer_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case r.current_step
    when 'accounts_verification' then 'pending_accounts'
    when 'sales_head_approval'   then 'pending_sales_head'
    when 'director_approval'     then 'pending_director'
    when 'tally_creation'        then 'pending_tally'
    else case when r.submitted_at is null then 'draft' else 'rework' end
  end
  from public.fms_customer_requests r where r.id = p_req;
$$;
grant execute on function public.fms_customer_resume_status(uuid) to authenticated;

-- ===========================================================================
-- INTERNAL — write the step 1-7 form fields from a jsonb bag.
--
-- Deliberately NOT granted to authenticated: it performs no authorization and
-- no validation, so it must only ever be reached through save_draft /
-- update_request, which do both. SECURITY DEFINER callers run as the owner and
-- can invoke it regardless of the grant.
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
end $$;

-- ===========================================================================
-- RPC — save a draft (create on first call, update thereafter).
--
-- Validates almost nothing: a draft is by definition incomplete. The only bar is
-- a non-blank legal name, so the Drafts list has something to show.
-- ===========================================================================
create or replace function public.fms_customer_save_draft(p jsonb, p_req uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_req;
  v_status text;
  v_owner  uuid;
  v_name   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'legal_name'), '') is null then
    raise exception 'Enter the legal company name before saving';
  end if;

  if v_id is null then
    -- A 'submission' step-owners row, when present, restricts who may raise.
    -- No row at all = anyone with hub access may raise one.
    if exists (select 1 from public.fms_customer_step_owners o
               where o.step_key = 'submission' and cardinality(o.employee_ids) > 0)
       and not public.fms_customer_can_act('submission', null, v_uid) then
      raise exception 'You are not authorized to raise a new customer';
    end if;

    select coalesce(nullif(btrim(pr.name), ''), '') into v_name
    from public.profiles pr where pr.id = v_uid;

    insert into public.fms_customer_requests (raised_by, raised_by_name, status, current_step)
    values (v_uid, nullif(v_name, ''), 'draft', 'submission')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
    from public.fms_customer_requests where id = v_id for update;
    if v_status is null then raise exception 'Request not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This request has already been submitted — use Edit instead';
    end if;
    if v_owner <> v_uid and not public.is_admin(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  perform public.fms_customer_write_form(v_id, p);
  return v_id;
end $$;
grant execute on function public.fms_customer_save_draft(jsonb, uuid) to authenticated;

-- ===========================================================================
-- RPC — delete a draft. Drafts only; a submitted request is cancelled, never
-- deleted. ⚠ The CLIENT must remove <id>/** from fms-customer-docs BEFORE
-- calling this: storage does not cascade from a table, so orphaned PAN cards
-- and cancelled cheques would sit in a private bucket forever with nothing
-- pointing at them.
-- ===========================================================================
create or replace function public.fms_customer_delete_draft(p_req uuid)
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
  select status, raised_by into v_status, v_owner
  from public.fms_customer_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'draft' then raise exception 'Only a draft can be deleted'; end if;
  if v_owner <> v_uid and not public.is_admin(v_uid) then
    raise exception 'This draft belongs to someone else';
  end if;
  delete from public.fms_customer_requests where id = p_req;
end $$;
grant execute on function public.fms_customer_delete_draft(uuid) to authenticated;

-- ===========================================================================
-- RPC — submit (draft → pending_accounts, or resubmit after rework).
--
-- ⚠ RECOMPUTES, NEVER TRUSTS. PAN, state code and state name are re-derived
--   from the GSTIN here, the checksum is re-run, and every mandatory field is
--   re-checked with a field-named message. A client that skips its own
--   validation gains nothing but a worse error message.
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

  -- ---- duplicate GSTIN --------------------------------------------------
  -- Checked here so the user gets the other request's number instead of a raw
  -- unique-violation. The partial index is still the real guard against a race.
  select x.req_no into v_dupe from public.fms_customer_requests x
  where x.id <> p_req
    and upper(btrim(x.gst_number)) = v_gst
    and x.status not in ('rejected','cancelled','draft')
  limit 1;
  if v_dupe is not null then
    raise exception 'A live onboarding request already exists for GSTIN % (%)', v_gst, v_dupe;
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
    jsonb_build_object('req_no', v_no, 'legal_name', r.legal_name, 'gst_number', v_gst));

  return v_no;
end $$;
grant execute on function public.fms_customer_submit_request(uuid) to authenticated;

-- ===========================================================================
-- RPC — edit the sales-side form after submission.
--
-- Allowed while the request is in rework, or while it still sits with Accounts
-- AND Accounts has stamped nothing. Once acc_verified_at exists the form locks:
-- editing underneath a completed verification is how an audit trail becomes
-- fiction.
-- ===========================================================================
create or replace function public.fms_customer_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.fms_customer_requests%rowtype;
  v_uid uuid := auth.uid();
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
  update public.fms_customer_requests
     set edited_at = now(), edited_by = v_uid
   where id = p_req;
end $$;
grant execute on function public.fms_customer_update_request(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — STEP 8a, accounts verification.
--   p = { gst_verified, refs_verified, recommended_limit, recommended_days,
--         remarks, verified_date, decision: forward|reject|rework }
--
-- The acc_* block is stamped on EVERY outcome, so a rejection still records what
-- was checked, and a rework that comes back shows Accounts a diff rather than a
-- blank form.
--
-- ⚠ verified_date comes from the CLIENT. Postgres current_date is UTC, so
--   between 00:00 and 05:30 IST it returns yesterday — the fallback below is a
--   backstop, not the normal path.
-- ===========================================================================
create or replace function public.fms_customer_decide_accounts(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.fms_customer_requests%rowtype;
  v_uid    uuid := auth.uid();
  v_dec    text := coalesce(nullif(btrim(p->>'decision'), ''), 'forward');
  v_remark text := nullif(btrim(p->>'remarks'), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending_accounts' then
    raise exception 'This request is not awaiting accounts verification (status %)', r.status;
  end if;
  if not public.fms_customer_can_act('accounts_verification', p_req, v_uid) then
    raise exception 'Not authorized to verify this request';
  end if;
  if v_dec not in ('forward','reject','rework') then
    raise exception 'Unknown accounts decision: %', v_dec;
  end if;
  if v_dec <> 'forward' and v_remark is null then
    raise exception 'A reason is required to % this request', v_dec;
  end if;

  update public.fms_customer_requests set
    acc_gst_verified      = (p->>'gst_verified')::boolean,
    acc_refs_verified     = (p->>'refs_verified')::boolean,
    acc_recommended_limit = nullif(btrim(p->>'recommended_limit'), '')::numeric,
    acc_recommended_days  = nullif(btrim(p->>'recommended_days'), '')::integer,
    acc_remarks           = v_remark,
    acc_verified_date     = coalesce(nullif(btrim(p->>'verified_date'), '')::date, current_date),
    acc_verified_at       = coalesce(acc_verified_at, now()),
    acc_verified_by       = coalesce(acc_verified_by, v_uid)
  where id = p_req;

  if v_dec = 'forward' then
    update public.fms_customer_requests
       set status = 'pending_sales_head', current_step = 'sales_head_approval'
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'accounts_verified',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') is verified and awaiting your approval.',
      public.fms_customer_step_owner_ids('sales_head_approval'),
      jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));

  elsif v_dec = 'reject' then
    update public.fms_customer_requests
       set status = 'rejected', current_step = 'accounts_verification',
           rejected_at = now(), reject_stage = 'accounts', reject_reason = v_remark
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rejected',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') was rejected by accounts: ' || v_remark,
      array[r.raised_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));

  else
    update public.fms_customer_requests
       set status = 'rework', current_step = 'submission',
           rework_at = now(), rework_stage = 'accounts', rework_reason = v_remark,
           rework_count = rework_count + 1
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rework',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') needs changes: ' || v_remark,
      array[r.raised_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
  end if;
end $$;
grant execute on function public.fms_customer_decide_accounts(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — STEP 8b, sales head.
--   p = { customer_category, business_potential, decision: approve|reject|rework,
--         force_director, remarks, decided_date }
--
-- ⚠ THE DIRECTOR DECISION IS FROZEN HERE, together with the threshold then in
--   force. force_director can only ADD a Director, never remove one: the OR is
--   deliberate and the UI renders the box ticked-and-disabled when the threshold
--   already fires.
-- ===========================================================================
create or replace function public.fms_customer_decide_sales_head(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.fms_customer_requests%rowtype;
  v_uid     uuid := auth.uid();
  v_dec     text := coalesce(nullif(btrim(p->>'decision'), ''), 'approve');
  v_remark  text := nullif(btrim(p->>'remarks'), '');
  v_forced  boolean := coalesce((p->>'force_director')::boolean, false);
  v_bythresh boolean;
  v_needs   boolean;
  v_thresh  numeric;
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending_sales_head' then
    raise exception 'This request is not awaiting sales-head approval (status %)', r.status;
  end if;
  if not public.fms_customer_can_act('sales_head_approval', p_req, v_uid) then
    raise exception 'Not authorized to approve this request';
  end if;
  if v_dec not in ('approve','reject','rework') then
    raise exception 'Unknown sales-head decision: %', v_dec;
  end if;
  if v_dec <> 'approve' and v_remark is null then
    raise exception 'A reason is required to % this request', v_dec;
  end if;
  if v_dec = 'approve' and nullif(btrim(p->>'customer_category'), '') is null then
    raise exception 'Choose a customer category (A-E) before approving';
  end if;

  update public.fms_customer_requests set
    sh_customer_category  = nullif(btrim(p->>'customer_category'), ''),
    sh_business_potential = nullif(btrim(p->>'business_potential'), ''),
    sh_decision           = v_dec,
    sh_force_director     = v_forced,
    sh_remarks            = v_remark,
    sh_decided_date       = coalesce(nullif(btrim(p->>'decided_date'), '')::date, current_date),
    sh_decided_at         = coalesce(sh_decided_at, now()),
    sh_decided_by         = coalesce(sh_decided_by, v_uid)
  where id = p_req;

  if v_dec = 'approve' then
    v_bythresh := public.fms_customer_director_required(p_req);
    v_needs    := v_bythresh or v_forced;
    select coalesce((c.value->>'director_threshold')::numeric, 0) into v_thresh
    from public.fms_customer_config c where c.key = 'approval';

    update public.fms_customer_requests set
      dir_required              = v_needs,
      dir_required_reason       = case when not v_needs then null
                                       when v_bythresh then 'threshold' else 'forced' end,
      dir_threshold_at_decision = case when v_needs then v_thresh else null end,
      status       = case when v_needs then 'pending_director' else 'pending_tally' end,
      current_step = case when v_needs then 'director_approval' else 'tally_creation' end
    where id = p_req;

    if v_needs then
      perform public.fms_customer_announce('request', p_req, 'awaiting_director',
        coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') needs your approval.',
        public.fms_customer_step_owner_ids('director_approval'),
        jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
    else
      perform public.fms_customer_announce('request', p_req, 'approved',
        coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') is approved — create the Tally ledger.',
        public.fms_customer_step_owner_ids('tally_creation'),
        jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
    end if;

  elsif v_dec = 'reject' then
    update public.fms_customer_requests
       set status = 'rejected', current_step = 'sales_head_approval',
           rejected_at = now(), reject_stage = 'sales_head', reject_reason = v_remark
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rejected',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') was rejected: ' || v_remark,
      array[r.raised_by, r.acc_verified_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));

  else
    update public.fms_customer_requests
       set status = 'rework', current_step = 'submission',
           rework_at = now(), rework_stage = 'sales_head', rework_reason = v_remark,
           rework_count = rework_count + 1
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rework',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') needs changes: ' || v_remark,
      array[r.raised_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
  end if;
end $$;
grant execute on function public.fms_customer_decide_sales_head(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — STEP 8c, director. p = { decision, remarks, decided_date }
-- ===========================================================================
create or replace function public.fms_customer_decide_director(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.fms_customer_requests%rowtype;
  v_uid    uuid := auth.uid();
  v_dec    text := coalesce(nullif(btrim(p->>'decision'), ''), 'approve');
  v_remark text := nullif(btrim(p->>'remarks'), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending_director' then
    raise exception 'This request is not awaiting director approval (status %)', r.status;
  end if;
  if not public.fms_customer_can_act('director_approval', p_req, v_uid) then
    raise exception 'Not authorized for director approval';
  end if;
  if v_dec not in ('approve','reject','rework') then
    raise exception 'Unknown director decision: %', v_dec;
  end if;
  if v_dec <> 'approve' and v_remark is null then
    raise exception 'A reason is required to % this request', v_dec;
  end if;

  update public.fms_customer_requests set
    dir_decision     = v_dec,
    dir_remarks      = v_remark,
    dir_decided_date = coalesce(nullif(btrim(p->>'decided_date'), '')::date, current_date),
    dir_decided_at   = coalesce(dir_decided_at, now()),
    dir_decided_by   = coalesce(dir_decided_by, v_uid)
  where id = p_req;

  if v_dec = 'approve' then
    update public.fms_customer_requests
       set status = 'pending_tally', current_step = 'tally_creation'
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'approved',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') is approved — create the Tally ledger.',
      public.fms_customer_step_owner_ids('tally_creation'),
      jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));

  elsif v_dec = 'reject' then
    update public.fms_customer_requests
       set status = 'rejected', current_step = 'director_approval',
           rejected_at = now(), reject_stage = 'director', reject_reason = v_remark
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rejected',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') was rejected by the director: ' || v_remark,
      array[r.raised_by, r.sh_decided_by, r.acc_verified_by],
      jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));

  else
    update public.fms_customer_requests
       set status = 'rework', current_step = 'submission',
           rework_at = now(), rework_stage = 'director', rework_reason = v_remark,
           rework_count = rework_count + 1
     where id = p_req;
    perform public.fms_customer_announce('request', p_req, 'rework',
      coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') needs changes: ' || v_remark,
      array[r.raised_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
  end if;
end $$;
grant execute on function public.fms_customer_decide_director(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — STEP 9, record the Tally ledger. Closes the request.
--   p = { customer_code, tally_ledger_created, tally_ledger_name,
--         assigned_sales_exec_id, assigned_sales_exec_name,
--         customer_status: active|hold|rejected, tally_date }
--
-- ⚠ THIS IS THE END OF THE LINE. It does NOT write to fms_dispatch_customers or
--   anything else downstream — Order-to-Dispatch sources its customers
--   elsewhere. Teams that need this data take the Excel export.
-- ===========================================================================
create or replace function public.fms_customer_record_tally(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.fms_customer_requests%rowtype;
  v_uid  uuid := auth.uid();
  v_code text := nullif(btrim(p->>'customer_code'), '');
  v_cs   text := nullif(btrim(p->>'customer_status'), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending_tally' then
    raise exception 'This request is not awaiting Tally creation (status %)', r.status;
  end if;
  if not public.fms_customer_can_act('tally_creation', p_req, v_uid) then
    raise exception 'Not authorized to record the Tally ledger';
  end if;
  if v_code is null then raise exception 'Enter the customer code created in Tally'; end if;
  if v_cs is null or v_cs not in ('active','hold','rejected') then
    raise exception 'Choose a customer status (Active, Hold or Rejected)';
  end if;

  update public.fms_customer_requests set
    customer_code        = v_code,
    tally_ledger_created = coalesce((p->>'tally_ledger_created')::boolean, false),
    tally_ledger_name    = nullif(btrim(p->>'tally_ledger_name'), ''),
    customer_status      = v_cs,
    assigned_sales_exec_id   = coalesce(nullif(btrim(p->>'assigned_sales_exec_id'), '')::uuid,
                                        assigned_sales_exec_id),
    assigned_sales_exec_name = coalesce(nullif(btrim(p->>'assigned_sales_exec_name'), ''),
                                        assigned_sales_exec_name),
    tally_date   = coalesce(nullif(btrim(p->>'tally_date'), '')::date, current_date),
    tally_at     = coalesce(tally_at, now()),
    tally_by     = coalesce(tally_by, v_uid),
    status       = 'completed',
    current_step = 'tally_creation'
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'completed',
    coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') is live — customer code ' || v_code || '.',
    array[r.raised_by, r.sh_decided_by, r.acc_verified_by,
          coalesce(nullif(btrim(p->>'assigned_sales_exec_id'), '')::uuid, r.assigned_sales_exec_id)],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name, 'customer_code', v_code));
end $$;
grant execute on function public.fms_customer_record_tally(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — attach / replace / clear one KYC document.
-- Kept OUT of the form save so a routine save can never blank an upload.
-- Pass empty path+name to clear a slot.
-- ===========================================================================
create or replace function public.fms_customer_set_document(
  p_req uuid, p_slot text, p_path text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.fms_customer_requests%rowtype;
  v_path text := nullif(btrim(p_path), '');
  v_name text := nullif(btrim(p_name), '');
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if p_slot not in ('gst','pan','cheque','msme') then
    raise exception 'Unknown document slot: %', p_slot;
  end if;
  if r.raised_by <> v_uid
     and not public.fms_customer_is_coordinator(v_uid)
     and not public.fms_customer_is_any_step_owner(v_uid) then
    raise exception 'Not authorized to change this request''s documents';
  end if;
  if r.status in ('completed','cancelled','rejected') then
    raise exception 'This request is closed (status %)', r.status;
  end if;

  update public.fms_customer_requests set
    gst_doc_path    = case when p_slot = 'gst'    then v_path else gst_doc_path    end,
    gst_doc_name    = case when p_slot = 'gst'    then v_name else gst_doc_name    end,
    pan_doc_path    = case when p_slot = 'pan'    then v_path else pan_doc_path    end,
    pan_doc_name    = case when p_slot = 'pan'    then v_name else pan_doc_name    end,
    cheque_doc_path = case when p_slot = 'cheque' then v_path else cheque_doc_path end,
    cheque_doc_name = case when p_slot = 'cheque' then v_name else cheque_doc_name end,
    msme_doc_path   = case when p_slot = 'msme'   then v_path else msme_doc_path   end,
    msme_doc_name   = case when p_slot = 'msme'   then v_name else msme_doc_name   end
  where id = p_req;
end $$;
grant execute on function public.fms_customer_set_document(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- RPC — set or change the assigned sales executive at ANY point, not only at
-- step 9. Both halves: p_user is the portal user (notifications + read access),
-- p_name is the Tally salesperson STRING the hub's dashboards key on.
-- ===========================================================================
create or replace function public.fms_customer_assign_sales_exec(p_req uuid, p_user uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r     public.fms_customer_requests%rowtype;
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not public.fms_customer_is_coordinator(v_uid)
     and not public.fms_customer_is_any_step_owner(v_uid)
     and r.raised_by <> v_uid then
    raise exception 'Not authorized to assign a sales executive';
  end if;

  update public.fms_customer_requests
     set assigned_sales_exec_id = p_user,
         assigned_sales_exec_name = nullif(btrim(p_name), '')
   where id = p_req;

  if p_user is not null and p_user <> coalesce(r.assigned_sales_exec_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    perform public.fms_customer_announce('request', p_req, 'assigned',
      'You are now the sales executive for ' || coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ').',
      array[p_user], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
  end if;
end $$;
grant execute on function public.fms_customer_assign_sales_exec(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- RPC — hold / resume. current_step is untouched, so resume_status() can always
-- derive where the request goes back to.
-- ===========================================================================
create or replace function public.fms_customer_hold_request(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
begin
  if not public.fms_customer_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can hold or resume a request';
  end if;
  select status into v_status from public.fms_customer_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if p_hold then
    if v_status in ('completed','cancelled','rejected','on_hold') then
      raise exception 'A % request cannot be put on hold', v_status;
    end if;
    if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to hold a request'; end if;
    update public.fms_customer_requests
       set status = 'on_hold', hold_at = now(), hold_reason = btrim(p_reason)
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This request is not on hold'; end if;
    update public.fms_customer_requests
       set status = public.fms_customer_resume_status(p_req), hold_at = null, hold_reason = null
     where id = p_req;
  end if;
end $$;
grant execute on function public.fms_customer_hold_request(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — cancel. Terminal. The raiser may withdraw their own; coordinators any.
-- ===========================================================================
create or replace function public.fms_customer_cancel_request(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r     public.fms_customer_requests%rowtype;
begin
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status in ('completed','cancelled') then
    raise exception 'This request is already % ', r.status;
  end if;
  if r.raised_by <> v_uid and not public.fms_customer_is_coordinator(v_uid) then
    raise exception 'Not authorized to cancel this request';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to cancel a request'; end if;

  update public.fms_customer_requests
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'cancelled',
    coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') was cancelled: ' || btrim(p_reason),
    array[r.raised_by, r.acc_verified_by, r.sh_decided_by],
    jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
end $$;
grant execute on function public.fms_customer_cancel_request(uuid, text) to authenticated;

-- ===========================================================================
-- RPC — reopen a rejected/cancelled request. The ONLY escape from a terminal
-- state, and admin/coordinator only, so a rejection cannot be quietly laundered
-- into an edit. The reason is recorded in the activity trail.
-- ===========================================================================
create or replace function public.fms_customer_reopen_request(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r     public.fms_customer_requests%rowtype;
  v_to  text;
begin
  if not public.fms_customer_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can reopen a request';
  end if;
  select * into r from public.fms_customer_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('rejected','cancelled') then
    raise exception 'Only a rejected or cancelled request can be reopened (status %)', r.status;
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reopen a request'; end if;

  v_to := public.fms_customer_resume_status(p_req);

  update public.fms_customer_requests set
    status = v_to,
    rejected_at = null, reject_stage = null, reject_reason = null,
    cancelled_at = null, cancel_reason = null
  where id = p_req;

  perform public.fms_customer_announce('request', p_req, 'reopened',
    coalesce(r.legal_name, '') || ' (' || coalesce(r.req_no, '') || ') was reopened: ' || btrim(p_reason),
    array[r.raised_by], jsonb_build_object('req_no', r.req_no, 'legal_name', r.legal_name));
end $$;
grant execute on function public.fms_customer_reopen_request(uuid, text) to authenticated;

-- ===========================================================================
-- RLS — the request table.
--
-- Reads only. Every write goes through the RPCs above, which re-check
-- authorization, validate the transition and stamp the step. The admin
-- all-policy is the break-glass path.
--
-- ⚠ Structure matters as much as content: the query-CONSTANT predicates are
--   inlined as InitPlans (evaluated once) and only column comparisons are left
--   per-row. Do not "tidy" this into can_read_request(id, auth.uid()) — that
--   takes a per-row column and would run once per row.
-- ===========================================================================
alter table public.fms_customer_requests enable row level security;

drop policy if exists fms_customer_requests_select on public.fms_customer_requests;
create policy fms_customer_requests_select on public.fms_customer_requests
  for select to authenticated
  using (
    -- A draft belongs to its author alone. Approvers must not see half-typed
    -- customers, and a rep must not see another rep's unfinished work.
    (status <> 'draft'
       or raised_by = (select auth.uid())
       or (select public.is_admin((select auth.uid()))))
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_customer_is_coordinator((select auth.uid())))
      or (select public.fms_customer_is_any_step_owner((select auth.uid())))
      or raised_by              = (select auth.uid())
      or assigned_sales_exec_id = (select auth.uid())
    )
  );

drop policy if exists fms_customer_requests_write_admin on public.fms_customer_requests;
create policy fms_customer_requests_write_admin on public.fms_customer_requests
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ===========================================================================
-- RLS — the activity trail. Deferred from the foundations migration because it
-- references fms_customer_requests, which did not exist yet.
--
-- Constants first, so a back-office user short-circuits before the per-row
-- EXISTS is ever reached.
-- ===========================================================================
drop policy if exists fms_customer_activity_select on public.fms_customer_activity;
create policy fms_customer_activity_select on public.fms_customer_activity
  for select to authenticated
  using (
       (select public.is_admin((select auth.uid())))
    or (select public.fms_customer_is_coordinator((select auth.uid())))
    or (select public.fms_customer_is_any_step_owner((select auth.uid())))
    or exists (
         select 1 from public.fms_customer_requests r
         where r.id = entity_id
           and (r.raised_by = (select auth.uid())
             or r.assigned_sales_exec_id = (select auth.uid()))
       )
  );

-- ===========================================================================
-- STORAGE — fms-customer-docs policies.
--
-- Key convention: <requestId>/<slot>/<epoch>-<sanitised-name>.
--
-- ⚠ NOT a blanket bucket_id grant. The sampling precedent (20260724120000)
--   gives every authenticated user SELECT on its whole bucket; these files are
--   PAN cards and cancelled cheques, so the equivalent here would expose every
--   customer's banking documents to anyone with a portal login. Keep this
--   scoped.
--
-- ⚠ THE REGEX GUARD IS LOAD-BEARING. A bare ::uuid cast on a path whose first
--   segment is not a uuid RAISES, and an error inside a storage policy surfaces
--   as a 500, not a denial. Test the shape before casting.
-- ===========================================================================
drop policy if exists "fms customer docs read"   on storage.objects;
drop policy if exists "fms customer docs insert" on storage.objects;
drop policy if exists "fms customer docs update" on storage.objects;
drop policy if exists "fms customer docs delete" on storage.objects;

create policy "fms customer docs read" on storage.objects
  for select to authenticated using (
    bucket_id = 'fms-customer-docs'
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_customer_is_coordinator((select auth.uid())))
      or (select public.fms_customer_is_any_step_owner((select auth.uid())))
      or (split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and exists (select 1 from public.fms_customer_requests r
                      where r.id = split_part(name, '/', 1)::uuid
                        and (r.raised_by = (select auth.uid())
                          or r.assigned_sales_exec_id = (select auth.uid()))))
    )
  );

create policy "fms customer docs insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'fms-customer-docs'
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_customer_is_coordinator((select auth.uid())))
      or (select public.fms_customer_is_any_step_owner((select auth.uid())))
      or (split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and exists (select 1 from public.fms_customer_requests r
                      where r.id = split_part(name, '/', 1)::uuid
                        and r.raised_by = (select auth.uid())))
    )
  );

create policy "fms customer docs update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-customer-docs'
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_customer_is_coordinator((select auth.uid())))
      or (split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and exists (select 1 from public.fms_customer_requests r
                      where r.id = split_part(name, '/', 1)::uuid
                        and r.raised_by = (select auth.uid())))
    )
  )
  with check (bucket_id = 'fms-customer-docs');

create policy "fms customer docs delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'fms-customer-docs'
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_customer_is_coordinator((select auth.uid())))
      or (split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and exists (select 1 from public.fms_customer_requests r
                      where r.id = split_part(name, '/', 1)::uuid
                        and r.raised_by = (select auth.uid())))
    )
  );
