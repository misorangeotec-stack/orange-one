-- ===========================================================================
-- OCPI · THE SALESPERSON IS A USER, NOT A TYPED STRING
--
-- WHY
--   The Salesperson box on the quotation form offered a list built by scanning
--   the deals table for distinct `salesperson_name` values, plus free text. So
--   the vocabulary was whatever had been typed before: 19 deals, 2 names, both
--   seeded test data. Worse, that list is RLS-scoped — `fms_ocpi_deals` select
--   is limited to admins, coordinators, module viewers, step owners and
--   `raised_by = auth.uid()` — so a plain salesperson saw roughly their own
--   name and nothing else.
--
--   The list now comes from the user directory: the departments named in the
--   new `salesperson_departments` config key, seeded to Sales.
--
-- ⚠ THE NAME IS STILL WHAT PRINTS, AND STILL WHAT EVERY GRID FILTERS ON.
--   Ten read sites take `salesperson_name` — the deal register, six queues,
--   the Control Center, the Excel export and quotationPdf.ts. None of them
--   changes. `salesperson_user_id` is added BESIDE the name to answer a
--   different question: whose deal is it. It is nullable and stays null for a
--   typed name, because free text is still legal.
--
-- ⚠ AUTH.USERS, NOT PROFILES. Every user column already on this table —
--   raised_by, qa_by, oc_by, oca_by, cs_by, ms_by, fh_by, fr_by, edited_by —
--   references auth.users(id) on delete set null. Matching that is what keeps
--   the delete behaviour uniform across the ten.
-- ===========================================================================

alter table public.fms_ocpi_deals
  add column if not exists salesperson_user_id uuid references auth.users(id) on delete set null;

-- "My deals" reads this per signed-in user; the partial index skips the typed
-- rows, which carry no id and are never looked up this way.
create index if not exists fms_ocpi_deals_salesperson_user_idx
  on public.fms_ocpi_deals (salesperson_user_id) where salesperson_user_id is not null;

comment on column public.fms_ocpi_deals.salesperson_user_id is
  'The portal user behind salesperson_name, when the name was picked from the roster. NULL for a typed name. The NAME is what prints and what every grid filters on; this answers "whose deal is it".';

-- ⚠ THE OLD COMMENT DESCRIBED A DESIGN THAT WAS NEVER BUILT. It said the value
--   was "Sourced from ext_ledger_tags via fetchSalespersonNames() and defaulted
--   from profiles.receivables_salespersons". fetchSalespersonNames is imported
--   nowhere in apps/ocpi, and the receivables default was a real defect: that
--   column is a Tally VISIBILITY SCOPE, not an identity, so it prefilled
--   "UMESH JI" for UMESHKUMAR SOLANKI and "NAKUL JI" for VIJAY of collections —
--   onto a customer's quotation.
comment on column public.fms_ocpi_deals.salesperson_name is
  'Who owns the deal, as printed on the quotation. Picked from the roster (see salesperson_user_id) or typed. Free text remains legal.';

-- ---------------------------------------------------------------------------
-- Which departments the roster is drawn from.
--
-- ⚠ CONFIG, NOT A CONSTANT IN THE CODE. Today it is Sales; an admin can widen
--   it to Management (both Directors carry a book) without a deploy. Same
--   {ids} shape as process_coordinators. fms_ocpi_config reads using (true)
--   and writes admin-only, so the form can read the rule and only an admin can
--   change it.
--
-- Resolved BY NAME rather than by pasting the uuid, so this is re-runnable on
-- any database. `on conflict do nothing` leaves a hand-set value alone.
-- ---------------------------------------------------------------------------
insert into public.fms_ocpi_config (key, value)
values ('salesperson_departments',
        jsonb_build_object('department_ids',
          coalesce(
            (select jsonb_agg(d.id) from public.departments d where d.name = 'Sales'),
            '[]'::jsonb)))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The org-wide people read, with the org unit attached.
--
-- ⚠ WHY NOT list_org_people(). That function returns department_id but no
--   sub_department_id, and the picker groups by sub-department. Adding an OUT
--   column needs drop+create, and list_org_people has four consumers (the task
--   @mention picker, asset-maintenance, useTaskNotifications and every FMS
--   StepOwnersSection). A new function is additive and breaks none of them.
--
-- ⚠ WHY A DEFINER FUNCTION AT ALL. `profiles` is RLS'd to self + downline +
--   same department, so a client-side read shows a Sales roster only to someone
--   already in Sales. The two non-admins holding OCPI access today are in
--   Accounting & Finance and Administration; both would see nobody.
--
-- Non-sensitive identity ONLY — no email and no phone, exactly as
-- list_org_people. Phone doubles as the initial login password.
-- ---------------------------------------------------------------------------
create or replace function public.list_org_people_detail()
returns table (
  id                  uuid,
  name                text,
  designation         text,
  department_id       uuid,
  department          text,
  sub_department_id   uuid,
  sub_department      text,
  sub_department_sort integer,
  employee_code       text,
  avatar_color        text,
  role                text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.designation,
    p.department_id,
    d.name,
    p.sub_department_id,
    sd.name,
    sd.sort_order,
    p.employee_code,
    p.avatar_color,
    coalesce(
      (
        select r.role::text
        from public.user_roles r
        where r.user_id = p.id
        order by case r.role
                   when 'admin'   then 4
                   when 'hod'     then 3
                   when 'sub_hod' then 2
                   else 1
                 end desc
        limit 1
      ),
      'employee'
    ) as role
  from public.profiles p
  left join public.departments     d  on d.id  = p.department_id
  left join public.sub_departments sd on sd.id = p.sub_department_id
  where auth.uid() is not null   -- authenticated callers only
  order by p.name;
$$;

comment on function public.list_org_people_detail() is
  'Org-wide people directory carrying department and sub-department names, for cross-department pickers. Same non-sensitive columns as list_org_people (no email, no phone) plus the org unit. SECURITY DEFINER because profiles is RLS-scoped to self + downline + same department.';

-- ---------------------------------------------------------------------------
-- fms_ocpi_write_quotation — re-issued with ONE added assignment.
--
-- ⚠ THE BODY BELOW IS THE LIVE ONE, DUMPED FROM pg_get_functiondef, NOT COPIED
--   FROM A MIGRATION FILE. Five migrations have defined this function and the
--   one in force is 20261024120000 (OCPI-7, the "a No may still carry a rate"
--   branch) — NOT the 20261019120100 that several file headers still point at.
--   Re-issuing an older body would silently revert OCPI-7's six inverted
--   guards, and nothing in the build would complain.
--
--   The only difference from that dump is the salesperson_user_id line.
--
-- ⚠ fms_ocpi_save_draft NEEDS NO CHANGE. Its 26-key `?|` sniff gates write_oc
--   alone; write_quotation is called unconditionally, so a payload carrying
--   only part-A keys still reaches this function.
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
  v_currency      text    := case when nullif(btrim(p->>'transport_terms'), '') = 'high_seas' then 'USD'
                                  else nullif(btrim(p->>'deal_value_currency'), '') end;
  v_amount        numeric := nullif(p->>'deal_value_amount', '')::numeric;
  v_fx            numeric := nullif(p->>'fx_rate', '')::numeric;
  v_machine       uuid    := nullif(p->>'machine_id', '')::uuid;
  v_needs_dryer   boolean;
  -- NEW (OCPI-7): the "not included, but offered at a subsidized rate" branch.
  -- These are the ONLY guards in this module that fire on FALSE rather than on
  -- TRUE, which is why they are declared together and commented here.
  v_ink_offer     boolean := (p->>'ink_offer_agreed')::boolean;
  v_ink_qty       numeric := nullif(p->>'ink_offer_qty', '')::numeric;
  v_ink_rate      numeric := nullif(p->>'ink_offer_rate', '')::numeric;
  v_head_offer    boolean := (p->>'head_offer_agreed')::boolean;
  v_head_qty      integer := nullif(p->>'head_offer_qty', '')::integer;
  v_head_rate     numeric := nullif(p->>'head_offer_rate', '')::numeric;
begin
  -- No machine, or a machine with the flag unset, means no dryer and therefore
  -- no dryer category. The machine is read from the PAYLOAD, not the row: this
  -- statement is what SETS machine_id, so the row still holds the previous one.
  select m.needs_dryer into v_needs_dryer
    from public.fms_ocpi_machines m where m.id = v_machine;

  update public.fms_ocpi_deals set
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),
    -- NEW: the portal user behind that name, when it was picked from the roster
    -- rather than typed. NULL is a legitimate answer and means "typed" — it is
    -- deliberately NOT part of fms_ocpi_complete_when_submitted, which still
    -- asks for the name alone.
    salesperson_user_id = nullif(p->>'salesperson_user_id', '')::uuid,
    customer_id        = nullif(p->>'customer_id', '')::uuid,
    customer_name      = nullif(btrim(p->>'customer_name'), ''),
    customer_address   = nullif(btrim(p->>'customer_address'), ''),
    customer_attn      = nullif(btrim(p->>'customer_attn'), ''),
    customer_email     = nullif(lower(btrim(p->>'customer_email')), ''),
    customer_mobile    = nullif(regexp_replace(
                           regexp_replace(coalesce(p->>'customer_mobile',''), '\D', '', 'g'),
                           '^(91|0)(?=[0-9]{10}$)', ''), ''),
    gst_available      = v_gst_available,
    gst_no             = case when v_gst_available is distinct from true then null
                              else nullif(upper(btrim(p->>'gst_no')), '') end,
    company_id         = nullif(p->>'company_id', '')::uuid,
    location_id        = nullif(p->>'location_id', '')::uuid,
    machine_count      = nullif(p->>'machine_count', '')::integer,
    machine_id         = v_machine,
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),
    incl_ink           = v_incl_ink,
    ink_qty_included   = case when v_incl_ink is distinct from true then null
                              else nullif(btrim(p->>'ink_qty_included'), '') end,
    -- NEW (OCPI-7) - THE INVERTED GUARD, and the first of its kind here. Every
    -- other branch in this function keeps a value when its owner is not
    -- distinct from TRUE; this one keeps it only when the owner is literally
    -- FALSE. "is distinct from false" is true for TRUE and for NULL alike -
    -- exactly the answers that must store nothing. It is also what stops a rate
    -- agreed while the answer was No from surviving a change to Yes and
    -- printing beside "Inclusive of Ink: Yes".
    ink_offer_agreed   = case when v_incl_ink is distinct from false then null
                              else v_ink_offer end,
    ink_offer_qty      = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_qty end,
    ink_offer_rate     = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_rate end,
    -- DERIVED here and never read from the payload. A browser-computed twin
    -- would be a second, different answer for one price on a contract - the
    -- mistake withGst was deleted for in stage E. It is NOT part of the deal
    -- value; see the column comment.
    ink_offer_subtotal = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true
                                or v_ink_qty is null or v_ink_rate is null then null
                              else round(v_ink_qty * v_ink_rate, 2) end,
    incl_spares        = v_incl_spares,
    spare_details      = case when v_incl_spares is distinct from true then null
                              else nullif(btrim(p->>'spare_details'), '') end,
    incl_head          = v_incl_head,
    heads_included     = case when v_incl_head is distinct from true then null
                              else nullif(p->>'heads_included', '')::integer end,
    -- NEW (OCPI-7) - the head's inverted guard. See the ink block above.
    head_offer_agreed   = case when v_incl_head is distinct from false then null
                               else v_head_offer end,
    head_offer_qty      = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_qty end,
    head_offer_rate     = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_rate end,
    head_offer_subtotal = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true
                                 or v_head_qty is null or v_head_rate is null then null
                               else round(v_head_qty * v_head_rate, 2) end,
    -- CHANGED (stage E): the dryer CATEGORY, kept only for a machine that takes
    -- a dryer. Was stored unconditionally as "Dryer required".
    dryer_type         = case when v_needs_dryer is distinct from true then null
                              else nullif(btrim(p->>'dryer_type'), '') end,
    deal_value_currency = v_currency,
    deal_value_amount   = v_amount,
    fx_rate            = case when v_currency = 'USD' then v_fx else null end,
    fx_rate_at         = case when v_currency = 'USD'
                              then nullif(p->>'fx_rate_at', '')::timestamptz else null end,
    fx_rate_source     = case when v_currency = 'USD'
                              then nullif(btrim(p->>'fx_rate_source'), '') else null end,
    fx_rate_overridden = case when v_currency = 'USD'
                              then (p->>'fx_rate_overridden')::boolean else null end,
    deal_value_inr     = case when v_currency = 'USD' and v_fx is not null and v_amount is not null
                              then round(v_amount * v_fx, 2) else null end,
    payment_type        = nullif(btrim(p->>'payment_type'), ''),
    payment_terms       = nullif(btrim(p->>'payment_terms'), ''),
    delivery_date       = nullif(p->>'delivery_date', '')::date,
    transport_terms     = v_transport,
    high_seas_via       = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_via'), '') end,
    high_seas_cost_by   = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_cost_by'), '') end,
    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,
    remarks              = nullif(btrim(p->>'remarks'), ''),
    dollar_clause_agreed = case when v_currency is distinct from 'USD' then null
                                else (p->>'dollar_clause_agreed')::boolean end
  where id = p_deal;
end $$;
