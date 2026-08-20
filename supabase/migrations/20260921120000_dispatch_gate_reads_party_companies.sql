-- ###########################################################################
-- ⚠⚠ SUPERSEDED THE SAME DAY BY 20260921130000_revert_dispatch_gate_to_company_id.
--
--   The widening below is WRONG and was reverted within the hour. Central
--   masters keeps ONE PARTY ROW PER TALLY BOOK, so "which book may bill THIS
--   row" has exactly one answer and it is company_id. mst_party_companies
--   records where a ledger of the same NAME exists - how you find the SIBLING
--   row, not permission to bill this one. Of the 46 pairs this newly allowed,
--   44 had a ledger of the same firm already sitting in the billing book.
--
--   Kept on disk because it was applied to production and the migration
--   history must be readable. Do not re-apply. Read the revert for the whole
--   story before touching this gate again.
-- ###########################################################################

-- ===========================================================================
-- THE BILLING-COMPANY GATE READS THE COMPANY-TO-CUSTOMER MAPPING.
--
-- WHY THIS EXISTS
--   A customer is a SEPARATE TALLY LEDGER IN EACH BOOK, and most customers are
--   billed by more than one book: of the 333 in Dispatch, 47 map to one book,
--   186 to two, 68 to three, 19 to four and 13 to all five.
--
--   fms_dispatch_assert_customer_of_company tested a SINGLE column -
--   mst_parties.company_id, the one book that ledger lives in - so every other
--   book was refused. Meanwhile the customer picker offers every active
--   customer whatever company is chosen (SalesOrderFields.tsx, the customer
--   Combobox is fed `s.activeOf(s.customers)` with no company filter). The
--   screen therefore invited a pair the database then rejected, and the person
--   only found out at Save.
--
--   mst_party_companies already answers this properly. It records every
--   (customer, book) pair Tally can justify - matched on normalised name or
--   GSTIN across all five books - and cron `mst-refresh-company-links` rebuilds
--   it four times an hour via mst_refresh_party_companies(). It was built,
--   seeded and scheduled, and then nothing was ever pointed at it: no function
--   and no frontend file referenced it before this migration.
--
-- ⚠ THE RULE ONLY EVER WIDENS. The old single-column test is KEPT as a floor
--   and the mapping is OR-ed onto it, for a concrete reason:
--   mst_refresh_party_companies() only considers parties that are active AND
--   ticked into order-to-dispatch, so a customer ticked between cron runs has
--   no mapping rows for up to 15 minutes. Falling back to company_id keeps that
--   window working instead of turning it into a refusal. No pair that saves
--   today can stop saving because of this migration.
--
-- ⚠ `active` IS TESTED ON THE MAPPING. mst_party_companies carries an `active`
--   column and mst_refresh_party_companies() never deletes - it updates
--   `source` and inserts `on conflict do nothing`. So deactivating a row is the
--   ONLY way to revoke a pair, and it survives the cron. Ignore `active` here
--   and that switch would do nothing at all.
--
-- MEASURED BEFORE WRITING THIS
--   67 existing orders hold a pair the old rule refuses, across 47 distinct
--   (customer, company) combinations. The mapping covers 46 of the 47. The one
--   exception is SPECTRUM DIGITAL, and it is a genuine mis-booking rather than
--   a gap in the rule: the firm is three ledgers (Colorix, Enterprise - Surat,
--   O-tec - Surat), the order points at the Enterprise - Surat row while being
--   billed by O-tec - Surat, and the row actually ticked into Dispatch is the
--   O-tec - Surat one. It stays refused ON PURPOSE. Repoint the order at the
--   right twin; do not loosen the gate to swallow it.
--
-- Reversal:
--   Restore the two bodies below verbatim -- both are `create or replace`, so
--   nothing is dropped and no data is touched.
--
--   create or replace function public.fms_dispatch_assert_customer_of_company(
--     p_customer uuid, p_company uuid) returns void
--   language plpgsql security definer set search_path to 'public' as $rb$
--   declare v_name text; v_co text;
--   begin
--     if p_customer is null or p_company is null then return; end if;
--     if exists (
--       select 1 from public.mst_parties c
--        where c.id = p_customer and c.is_customer
--          and (c.company_id is null or c.company_id = p_company)
--     ) then return; end if;
--     select name into v_name from public.mst_parties where id = p_customer;
--     select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
--       into v_co from public.mst_companies where id = p_company;
--     raise exception '% is not a customer of %. Pick a customer that company bills, or ask for the ledger to be opened in Tally.',
--       coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
--   end $rb$;
--
--   -- and in fms_dispatch_update_order, drop v_company_before from the declare
--   -- block and from the opening SELECT, and narrow the guard back to:
--   --   if v_cust is distinct from v_cust_before then
--   --     perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);
--   --   end if;
-- ===========================================================================

create or replace function public.fms_dispatch_assert_customer_of_company(
  p_customer uuid, p_company uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_name text; v_co text;
begin
  if p_customer is null or p_company is null then return; end if;

  -- Three ways to be legal, checked as one EXISTS so a party that satisfies any
  -- of them passes. Order is by cost: the two column tests are already on the
  -- row being read, the mapping lookup rides the UNIQUE (party_id, company_id)
  -- index.
  --
  --   1. company_id is null  - a portal customer belonging to no book, which
  --      every book may bill. This was the old early return; it is why the ten
  --      hand-added customers work under any company today.
  --   2. company_id matches  - the old rule, kept as the floor (see header).
  --   3. an ACTIVE mapping row - the real answer, and the new one.
  --
  -- is_customer still has to hold. A vendor-only ledger is not orderable no
  -- matter how many books it is mapped to.
  if exists (
    select 1 from public.mst_parties c
     where c.id = p_customer
       and c.is_customer
       and (
            c.company_id is null
         or c.company_id = p_company
         or exists (
              select 1 from public.mst_party_companies pc
               where pc.party_id = c.id
                 and pc.company_id = p_company
                 and pc.active
            )
       )
  ) then
    return;
  end if;

  -- Named, both halves. "Invalid customer" sends somebody hunting; the two
  -- names say which pair was refused and therefore what to change.
  select name into v_name from public.mst_parties where id = p_customer;
  select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
    into v_co from public.mst_companies where id = p_company;
  raise exception '% is not a customer of %. Pick a customer that company bills, or ask for the ledger to be opened in Tally.',
    coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
end $fn$;

comment on function public.fms_dispatch_assert_customer_of_company(uuid, uuid) is
  'Raises unless the billing company may bill the customer. Legal if the party has no company, or its own company_id matches, or an ACTIVE mst_party_companies row says so. is_customer must hold either way. The rule only widens what the old company_id-only test allowed.';


create or replace function public.fms_dispatch_update_order(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text; v_cc timestamptz; v_raiser uuid; v_no text;
  v_uid uuid := auth.uid();
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_location uuid; v_held boolean;
  v_cust_before uuid; v_company_before uuid;
begin
  select status, cc_at, raised_by, order_no, cc_status = 'credit_hold', customer_id, company_id
    into v_status, v_cc, v_raiser, v_no, v_held, v_cust_before, v_company_before
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_credit_check' or v_cc is not null then
    raise exception 'This order can no longer be edited - the credit check has already been recorded';
  end if;
  -- A partial credit approval sends an exhausted order back to this status, so
  -- the two tests above are no longer sufficient on their own.
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'This order has already dispatched - its details can no longer be edited';
  end if;
  if not (v_raiser = v_uid or public.fms_dispatch_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this order (or a coordinator) may edit it';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;

  v_cust := coalesce(nullif(p->>'customer_id','')::uuid, v_cust_before);

  -- ⚠ Ask what the ROW WOULD HOLD, not what the payload carries. An omitted key
  --   means "keep what is stored", so an older client that never learnt to send
  --   a company (or a location) does not fail with "choose the company".
  select case when p ? 'company_id'  then nullif(trim(p->>'company_id'),'')::uuid  else o.company_id  end,
         case when p ? 'location_id' then nullif(trim(p->>'location_id'),'')::uuid else o.location_id end
    into v_company, v_location
    from public.fms_dispatch_orders o where o.id = p_order;
  if v_company is null then
    raise exception 'Choose the company that bills this order';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- STILL DELIBERATELY CONDITIONAL, now on BOTH halves.
  --
  --   67 of the 437 orders raised so far hold a customer the billing company
  --   does not bill under the old rule, because the picker offered one flat
  --   list whatever company was chosen. (The comment here used to say the
  --   picker "narrowed" - it never did; that assumption is what hid this bug
  --   for so long. It narrows now.) Those orders are history: refusing to save
  --   them would mean an order that can be opened and corrected but never put
  --   back. So an UNCHANGED pair is always allowed through.
  --
  -- ⚠ THE COMPANY HALF USED TO BE UNGUARDED ENTIRELY. Testing only the customer
  --   meant you could leave the customer alone, switch the order to any other
  --   billing company, and save with no check at all - which is how a mismatched
  --   pair got created deliberately rather than inherited. Changing EITHER half
  --   now re-tests the pair against today's rule.
  if v_cust is distinct from v_cust_before
     or v_company is distinct from v_company_before then
    perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);
  end if;

  -- The same rule as intake, against whatever the row would end up holding: a
  -- location must belong to the company, and is compulsory once that company has
  -- any. Changing the company to one with different sites therefore forces a
  -- matching location rather than leaving a stale one pointing elsewhere.
  if v_location is not null then
    if not exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                    where l.id = v_location and l.company_id = v_company and l.active) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                 where l.company_id = v_company and l.active) then
    raise exception 'Choose the location this order dispatches from';
  end if;

  update public.fms_dispatch_orders set
    dispatch_type = v_type,
    company_id    = v_company,
    location_id   = v_location,
    customer_id   = v_cust,
    customer_location = case when p ? 'customer_location'
                             then nullif(trim(p->>'customer_location'),'') else customer_location end,
    customer_po_no    = case when p ? 'customer_po_no'
                             then nullif(trim(p->>'customer_po_no'),'') else customer_po_no end,
    order_date    = coalesce(nullif(p->>'order_date','')::date, order_date),
    order_remarks = nullif(trim(p->>'order_remarks'), ''),
    -- ⚠ Editing the goods CLEARS a credit hold. The hold and its written reason
    --   were a judgement about a specific set of items; silently carrying them
    --   over to a different set is how a hold gets bypassed by accident.
    cc_status     = case when v_held then null else cc_status end,
    cc_remarks    = case when v_held then null else cc_remarks end,
    cc_round_no   = case when v_held then null else cc_round_no end,
    cc_decided_at = case when v_held then null else cc_decided_at end,
    cc_decided_by = case when v_held then null else cc_decided_by end,
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  if p ? 'lines' then
    perform public.fms_dispatch_replace_lines(p_order, p->'lines');
  end if;

  perform public.fms_dispatch_announce(
    'order', p_order, 'order_edited',
    'Sales order ' || coalesce(v_no, '') || ' was edited.'
      || case when v_held then ' The credit hold on it was cleared and must be decided again.' else '' end,
    case when v_held then public.fms_dispatch_step_owner_ids('credit_check') else '{}'::uuid[] end,
    jsonb_build_object('order_no', v_no)
  );
end $fn$;


-- --------------------------------------------------------------------------
-- Self-assertions. Both are about the rule WIDENING and never narrowing.
-- --------------------------------------------------------------------------
do $check$
declare
  v_broken int;
  v_fixed  int;
begin
  -- 1. Nothing that saves today may stop saving. Every (customer, company) pair
  --    the OLD rule accepted must still be accepted by the new one.
  select count(*) into v_broken
  from public.mst_parties c
  cross join public.mst_companies co
  where c.is_customer
    and (c.company_id is null or c.company_id = co.id)          -- old rule said yes
    and not (                                                    -- new rule must too
      c.company_id is null
      or c.company_id = co.id
      or exists (select 1 from public.mst_party_companies pc
                  where pc.party_id = c.id and pc.company_id = co.id and pc.active)
    );
  if v_broken <> 0 then
    raise exception 'CHECK FAILED: the new rule refuses % pair(s) the old rule allowed', v_broken;
  end if;

  -- 2. It must actually have widened, or the migration achieved nothing.
  select count(*) into v_fixed
  from (
    select distinct o.customer_id, o.company_id
      from public.fms_dispatch_orders o
      join public.mst_parties p on p.id = o.customer_id
     where p.company_id is not null and p.company_id <> o.company_id
  ) m
  where exists (select 1 from public.mst_party_companies pc
                 where pc.party_id = m.customer_id and pc.company_id = m.company_id and pc.active);
  if v_fixed = 0 then
    raise exception 'CHECK FAILED: no previously-refused pair is now allowed - is mst_party_companies populated?';
  end if;
  raise notice 'billing-company gate: % previously-refused pair(s) now legal', v_fixed;
end $check$;
