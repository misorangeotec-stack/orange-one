-- =============================================================================
--  OD-5 · The customer picker can map the customer it is not showing
-- =============================================================================
--
--  A salesperson picks the billing company on a sales order, opens the Customer
--  picker, and the firm they want is not there - because the picker narrows on
--  mst_parties.company_id, the one Tally book that ledger is filed in. Today the
--  screen offers nothing at that point and the order is abandoned.
--
--  Two things here, and neither drops or rewrites any data:
--
--    1. fms_dispatch_map_party_company - the SECURITY DEFINER RPC that lets an
--       ordinary order-raiser record a (customer, company) pair;
--    2. fms_dispatch_assert_customer_of_company - the save guard now accepts an
--       active mst_party_companies row as well as company_id.
--
-- =============================================================================
--  ⚠⚠ THIS DELIBERATELY RE-WIDENS WHAT 20260921130000 NARROWED. READ THIS.
-- =============================================================================
--
--  20260921120000_dispatch_gate_reads_party_companies.sql widened this same
--  guard. 20260921130000_revert_dispatch_gate_to_company_id.sql undid it within
--  the hour, and its header is the best statement of the risk being accepted
--  here. Read it before touching this. Its argument was specific:
--
--      "of the 46 pairs the widening newly allowed, 44 have a ledger of the
--       same firm sitting in the billing book already. For those the correct
--       action is to pick THAT row."
--
--  That objection is correct, and it is NOT answered by asserting a decision
--  over it. It is answered by the screen that ships in the same change.
--
--  WHAT IS DIFFERENT THIS TIME, and it is the whole justification:
--    MapCustomerCompanyModal LEADS WITH THE SIBLING. When the typed name
--    matches a ledger in another book it says so first, and offers to switch
--    the billing company - one click, no mapping, and the correct answer for
--    those 44. Mapping is what is left when there is genuinely nothing there.
--    Measured 11-09-2026: 412 of 1,354 distinct customer names sit in more than
--    one book, so the sibling path carries most of the traffic. The 2026-09
--    attempt widened the database while the screen still said nothing, which is
--    exactly how a mis-booking gets legalised.
--
--  THE AUTHORITY IS THE DECISION OF 07-09-2026, recorded in WORKLIST.md under
--  OD-5, given in answer to the Tally-posting consequence stated plainly:
--
--      "We definitely want to proceed because, at the time of billing, if that
--       customer is not there in Tally, then the Tally team will open that. You
--       don't have to worry about that, but the entry should not be paused
--       because of this."
--
--  THE PROCESS REASON: the ledger is opened by people, at billing time, as a
--  matter of course. The software's job is to let the order be raised, not to
--  hold it until a master catches up.
--
--  ⚠ WHAT THIS ACCEPTS, so nobody rediscovers it as a surprise: an order can now
--    be raised for a company in whose Tally book the customer has no ledger, and
--    it is the Tally team's job to open one before the invoice is cut. If that
--    hand-off is missed the order reaches billing with nowhere to post - which
--    was OD-4's mechanism.
--
--  ⚠ THE GUARD HAS FIVE CALLERS. All five widen together, and that is intended:
--      fms_dispatch_submit_order              raising a sales order
--      fms_dispatch_update_order              editing one
--      fms_dispatch_map_customer_item         OD-9's item mapping
--      fms_dispatch_complete_customer_order   Order Desk (OD-14)
--      fms_dispatch_complete_customer_intake  Order Desk intake
--    The two Order Desk paths already constrain their company list server-side
--    from the customer's own ticked ledgers, so the widening is additive there
--    too. The third matters to OD-5 directly: map_customer_item calls this guard
--    before it writes, so the "map the company, then map their items" chain does
--    not merely coexist with this change - it DEPENDS on it.
--
--  ⚠ A STANDING CONTRADICTION IS RESOLVED, not created. mst_party_companies'
--    own table comment has always read "Which of our companies may bill this
--    party", while the reverted function comment said the table must not be
--    consulted for exactly that. After this change the table comment is the
--    true one, and the function comment below agrees with it.
--
--  ⚠ WHAT IS NOT CHANGED: mst_parties.company_id still means "the Tally book
--    this ledger is filed in", and mst_refresh_party_companies() still never
--    deletes. A hand-made pair survives every sync and is quietly promoted from
--    'portal' to 'tally' the day Tally opens the ledger.
--
--  Reversal: 20261119120000_od5_map_party_company_rollback.sql - and read its
--  header, because it is a PAIRED revert with the frontend.
-- =============================================================================


-- ==================================================== the mapping write ======
--
-- ⚠ WHY AN RPC AT ALL, rather than letting the browser insert the row.
--   mst_party_companies_write is
--       is_admin(uid) OR mst_is_master_manager('party_company', uid)
--   so a direct insert fails with a policy violation for EXACTLY the people
--   this feature exists for. A salesperson can READ the table (is_staff) and
--   cannot write it. This is the twin of fms_dispatch_map_customer_item.
--
-- ⚠ THE PERMISSION LINE IS COPIED VERBATIM FROM THAT TWIN, and that is now the
--   correct thing to do. WORKLIST.md warns in red against copying it, because
--   fms_dispatch_can_raise returns TRUE for an Order Desk customer. FIX-8 has
--   since fixed that at source: the live map_customer_item opens with
--   `can_raise(uid) AND customer_org_of(uid) IS NULL`, which is precisely the
--   predicate OD-5 asks for - our people, not our customers. Verified against
--   pg_proc on 11-09-2026. Bishen Dyeing must never map itself into a book.
create or replace function public.fms_dispatch_map_party_company(
  p_party uuid, p_companies uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_created     integer := 0;
  v_reactivated integer := 0;
  v_skipped     integer := 0;
  v_company     uuid;
  v_bad         text;
  v_existing    boolean;
begin
  if not (public.fms_dispatch_can_raise(auth.uid())
          and public.fms_dispatch_customer_org_of(auth.uid()) is null) then
    raise exception 'You do not have permission to map customers in Order to Dispatch.';
  end if;

  if p_party is null then
    raise exception 'A mapping needs a customer';
  end if;

  if p_companies is null or cardinality(p_companies) = 0 then
    return jsonb_build_object('created', 0, 'reactivated', 0, 'skipped', 0);
  end if;

  if not exists (
    select 1 from public.mst_parties p
     where p.id = p_party and p.is_customer and p.active
  ) then
    raise exception 'That customer no longer exists, or has been switched off. Reload and try again.';
  end if;

  -- Named, like the item RPC's refusal: "invalid company" sends somebody
  -- hunting, the name says which one to untick.
  select string_agg(coalesce(nullif(trim(c.alias), ''), c.name), ', ' order by c.name)
    into v_bad
    from public.mst_companies c
   where c.id = any(p_companies) and not c.active;

  if v_bad is not null then
    raise exception 'These companies are switched off: %', v_bad;
  end if;

  if (select count(*) from public.mst_companies c where c.id = any(p_companies))
     <> cardinality(p_companies) then
    raise exception 'One of those companies no longer exists. Reload and try again.';
  end if;

  foreach v_company in array p_companies loop
    select active into v_existing
      from public.mst_party_companies
     where party_id = p_party and company_id = v_company;

    if v_existing is null then
      -- 'portal' is a RECORD OF WHERE IT CAME FROM and gates nothing (decided
      -- 07-09-2026). mst_refresh_party_companies() flips it to 'tally' on its
      -- own the day Tally backs the pair.
      insert into public.mst_party_companies (party_id, company_id, source, created_by)
      values (p_party, v_company, 'portal', auth.uid());
      v_created := v_created + 1;
    elsif v_existing then
      v_skipped := v_skipped + 1;
    else
      -- Somebody had switched this pair OFF. Turning it back on silently would
      -- hide a decision, so it is counted and reported separately.
      update public.mst_party_companies
         set active = true, updated_at = now()
       where party_id = p_party and company_id = v_company;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $fn$;

revoke all on function public.fms_dispatch_map_party_company(uuid, uuid[]) from public;
grant execute on function public.fms_dispatch_map_party_company(uuid, uuid[]) to authenticated;

comment on function public.fms_dispatch_map_party_company(uuid, uuid[]) is
  'OD-5. Lets an order-raiser record which of our companies may bill a customer, with no approval step. Staff only: can_raise AND customer_org_of IS NULL, so an Order Desk customer cannot map itself into a book. Reactivates a pair that was switched off rather than failing the unique index, and reports which happened.';


-- ========================================================= the save guard ====
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

  -- The ledger's own Tally book. A null company still means "no book yet",
  -- which every company may bill: that is the newly-approved-customer case.
  if exists (
    select 1 from public.mst_parties c
     where c.id = p_customer
       and c.is_customer
       and (c.company_id is null or c.company_id = p_company)
  ) then
    return;
  end if;

  -- ⚠ AND AN ACTIVE mst_party_companies ROW, regardless of `source`. DECIDED
  --   07-09-2026 (WORKLIST.md, OD-5). This reverses what the comment here used
  --   to say - "do not reach for the party-companies mapping, it records where
  --   a ledger of the same NAME exists, which is how you find the sibling row,
  --   not permission to bill this one" - and the reversal is deliberate, not an
  --   oversight by somebody who had not read it.
  --
  --   WHY: the ledger is opened by the Tally team at billing time, as a matter
  --   of process. The order must not be paused waiting for a master. The pair
  --   being merely a "finder" was the right reading while nothing could act on
  --   it; now a person deliberately records the pair, and that IS the decision.
  --
  --   WHAT MAKES IT SAFE: the screen that writes these pairs leads with the
  --   sibling ledger and offers to switch the billing company instead, so the
  --   44-of-46 case the 2026-09 revert measured is routed to the right answer
  --   before a mapping is ever offered. Read the migration header before
  --   narrowing this again - it has been narrowed once already, and the reasons
  --   on both sides are all still on disk.
  if exists (
    select 1
      from public.mst_party_companies pc
      join public.mst_parties c on c.id = pc.party_id
     where pc.party_id = p_customer
       and pc.company_id = p_company
       and pc.active
       and c.is_customer
  ) then
    return;
  end if;

  -- Named, both halves. "Invalid customer" sends somebody hunting; the two
  -- names say which pair was refused and therefore what to change.
  select name into v_name from public.mst_parties where id = p_customer;
  select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
    into v_co from public.mst_companies where id = p_company;
  raise exception '% is not a customer of %. Pick a customer that company bills, or map them to it from the sales order.',
    coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
end $fn$;

comment on function public.fms_dispatch_assert_customer_of_company(uuid, uuid) is
  'Raises unless the billing company may bill the customer: the party must be a customer, and either belong to no Tally book, or to that company, or carry an active mst_party_companies row for it. The mapping arm was added by OD-5 (decided 07-09-2026) and deliberately reverses the narrowing of 20260921130000 - read that file and this one''s header together.';


-- ================================================================ checks ====
--
-- ⚠ THESE CALL THE REAL FUNCTION, not a restatement of its predicate. A check
--   that re-types the WHERE clause passes even when the deployed body is wrong,
--   which is the only failure worth catching here.
do $check$
declare
  v_party uuid; v_company uuid; v_ok boolean;
  v_own int; v_union int;
begin
  -- A · an ordinary in-book pair still passes. The positive control: if this
  --     breaks, every existing order stops saving.
  select p.id, p.company_id into v_party, v_company
    from public.mst_parties p
   where p.is_customer and p.active and p.company_id is not null
   limit 1;
  if v_party is not null then
    perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);
  end if;

  -- B · a cross-book pair carrying an active mapping now passes. This is the
  --     whole change; if it raises, the new arm did not land.
  v_party := null;
  select pc.party_id, pc.company_id into v_party, v_company
    from public.mst_party_companies pc
    join public.mst_parties p on p.id = pc.party_id
   where pc.active and p.is_customer and p.active
     and p.company_id is not null and p.company_id <> pc.company_id
   limit 1;
  if v_party is not null then
    perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);
  end if;

  -- C · and an unmapped cross-book pair is STILL refused. Without this the
  --     "widening" could simply be the guard falling open and nothing would say so.
  v_party := null;
  select p.id, c.id into v_party, v_company
    from public.mst_parties p
   cross join public.mst_companies c
   where p.is_customer and p.active
     and p.company_id is not null and p.company_id <> c.id
     and not exists (
       select 1 from public.mst_party_companies pc
        where pc.party_id = p.id and pc.company_id = c.id and pc.active)
   limit 1;
  if v_party is not null then
    v_ok := false;
    begin
      perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'CHECK FAILED: the guard accepted an unmapped cross-book pair (% / %) - it has fallen open, not widened',
        v_party, v_company;
    end if;
  end if;

  -- The census, for the record. Directional on purpose: the exact figure moves
  -- the moment anyone maps a pair, so asserting a literal would make this file
  -- fail for the wrong reason later. What must hold is that nothing was LOST.
  select count(*) into v_own
    from public.mst_parties p cross join public.mst_companies c
   where p.is_customer and p.active and c.active
     and (p.company_id is null or p.company_id = c.id);

  select count(*) into v_union
    from public.mst_parties p cross join public.mst_companies c
   where p.is_customer and p.active and c.active
     and (p.company_id is null or p.company_id = c.id
          or exists (select 1 from public.mst_party_companies pc
                      where pc.party_id = p.id and pc.company_id = c.id and pc.active));

  if v_union < v_own then
    raise exception 'CHECK FAILED: the permitted set SHRANK, % -> %. This must only ever add.', v_own, v_union;
  end if;

  raise notice 'OD-5: customer/company pairs permitted % -> % (+%). Measured 11-09-2026: 1957 -> 2358 (+401).',
    v_own, v_union, v_union - v_own;
end $check$;
