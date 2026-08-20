-- ===========================================================================
-- REVERT: the billing-company gate goes back to mst_parties.company_id.
--
-- Undoes the widening in 20260921120000, applied the same day. That migration
-- stays on disk because it reached production and the history has to be
-- readable; this file is the one that describes the truth.
--
-- WHY THE WIDENING WAS WRONG
--   It made the gate accept an ACTIVE mst_party_companies row as permission for
--   a book to bill a party. That misreads what the table means.
--
--   Central masters keeps ONE PARTY ROW PER TALLY BOOK - the "one row per Tally
--   company" decision in CENTRAL-MASTERS.md. A firm we trade with from two
--   books is TWO ROWS, each with its own ledger guid and its own credit limit.
--   So "which book may bill THIS ROW" has exactly one answer, and it is
--   company_id.
--
--   mst_party_companies answers a DIFFERENT question: in which books does a
--   ledger of this NAME exist? It is built by matching normalised name or GSTIN
--   across books, which is how you find the SIBLING row - not permission to
--   bill this one.
--
--   Measured before reverting: of the 46 pairs the widening newly allowed, 44
--   have a ledger of the same firm sitting in the billing book already. For
--   those the correct action is to pick THAT row. Allowing the cross-book pair
--   would have legalised 44 mis-bookings of exactly the kind the widening
--   itself flagged as a data error (SPECTRUM DIGITAL) - and the wrong ledger
--   does not stop at the order: it flows into the sales bill and the Tally
--   posting.
--
-- ⚠ AND THE PROBLEM IT CLAIMED TO SOLVE DID NOT EXIST.
--   The premise was "the picker offers a flat list of every customer, so the
--   screen invites a pair the database refuses". That was read off the
--   `daily-reports` branch. On `master` - what is actually deployed - commit
--   550bd72 "Order to Dispatch: the company you bill under decides who you can
--   bill" already narrows the picker with `customersForCompany()`, on
--   company_id, matching this gate exactly. Screen and database already agreed.
--   CHECK WHICH BRANCH IS DEPLOYED BEFORE DIAGNOSING A UI/DB DISAGREEMENT:
--   master is checked out at the `oo-master` worktree, not here.
--
-- WHAT IS DELIBERATELY KEPT FROM 20260921120000
--   fms_dispatch_update_order keeps `v_company_before` and the widened guard,
--   so the customer/company pair is re-tested when EITHER half changes. That is
--   independent of the mapping question and closes a real hole: switching only
--   the billing company on an existing order used to skip the check entirely,
--   which is how a mismatched pair got created deliberately rather than
--   inherited. Not reverted.
--
-- Reversal of this reversal: see 20260921120000 - but read the paragraphs above
-- first, because re-applying it would be a mistake.
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
  -- ⚠ company_id, and ONLY company_id. See the migration header: a party row
  --   belongs to exactly one Tally book, so one book may bill it. Do not reach
  --   for the party-companies mapping here - it records where a ledger of the
  --   same NAME exists, which is how you find the sibling row, not permission
  --   to bill this one. A null company still means "no book yet", which every
  --   company may bill: that is the newly-approved-customer case.
  if exists (
    select 1 from public.mst_parties c
     where c.id = p_customer
       and c.is_customer
       and (c.company_id is null or c.company_id = p_company)
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
  'Raises unless the billing company may bill the customer: the party must be a customer, and either belong to no Tally book or to that company. One party row = one book, so the party-companies mapping is deliberately NOT consulted here.';

do $check$
declare v_now int;
begin
  -- Back to the original count of pairs this rule refuses.
  select count(*) into v_now
  from public.fms_dispatch_orders o
  join public.mst_parties p on p.id = o.customer_id
  where p.company_id is not null and p.company_id <> o.company_id;
  if v_now <> 67 then
    raise exception 'CHECK FAILED: expected the original 67 refused orders, found %', v_now;
  end if;
end $check$;
