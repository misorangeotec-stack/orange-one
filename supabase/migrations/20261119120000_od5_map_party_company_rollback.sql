-- ===========================================================================
-- ROLLBACK of 20261119120000_od5_map_party_company.sql
--
-- Puts fms_dispatch_assert_customer_of_company back to company_id only - the
-- body that stood before OD-5, restored verbatim from pg_get_functiondef - and
-- drops fms_dispatch_map_party_company.
--
-- ⚠⚠ THIS IS A PAIRED REVERT. The frontend must go back in the same movement.
--   The Customer picker's create row calls fms_dispatch_map_party_company; drop
--   it alone and the modal fails with "function does not exist" at the moment
--   somebody is trying to rescue an order. Worse, `customersForCompany` would
--   keep OFFERING mapped customers while this guard refuses them - the user
--   picks, fills the whole order, and is thrown out at save. That asymmetry is
--   precisely what OD-5's build notes say must never ship.
--   Revert the frontend first, or at the same time. Never this file alone.
--
-- ⚠ THE MAPPING ROWS ARE NOT UNDONE, AND MUST NOT BE. They are rows in a
--   governed central master, indistinguishable from ones seeded by
--   mst_refresh_party_companies(), and an order may already have been raised
--   against one. Rolling back the CODE takes the shortcut away; it does not
--   un-decide which companies may bill a customer. Their `source` of 'portal'
--   is how you find them afterwards:
--
--       select p.name, c.name, pc.created_at, pc.created_by
--         from mst_party_companies pc
--         join mst_parties   p on p.id = pc.party_id
--         join mst_companies c on c.id = pc.company_id
--        where pc.source = 'portal' and pc.created_by is not null
--        order by pc.created_at desc;
--
--   Baseline for that query, before OD-5 shipped: 42 'portal' rows, all of them
--   on the 10 customers that are filed in no Tally book at all, all written by
--   the master-request resolver rather than by a person. Anything with a
--   created_by and a date after 11-09-2026 came from this feature.
--
-- ⚠ GOING BACK REOPENS THE ORIGINAL COMPLAINT, which is the point of reading
--   this before running it: a salesperson billing through Colorix cannot find a
--   firm whose ledger sits in O-tec's book, and the screen goes back to
--   offering them nothing at all. Orders raised on a mapped pair while OD-5 was
--   live will also stop being EDITABLE - fms_dispatch_update_order re-tests the
--   pair whenever either half changes, so opening one and touching the customer
--   or the company would refuse to save. The orders themselves are untouched
--   and still readable. Count them before you decide:
--
--       select count(*) from fms_dispatch_orders o
--         join mst_parties p on p.id = o.customer_id
--        where p.company_id is not null and p.company_id <> o.company_id;
--
-- Reversal of this reversal: re-apply 20261119120000_od5_map_party_company.sql,
-- and read ITS header first - this gate has now been widened, narrowed and
-- widened again, and every argument on both sides is on disk.
-- ===========================================================================

drop function if exists public.fms_dispatch_map_party_company(uuid, uuid[]);

-- Verbatim as it stood before OD-5, from pg_get_functiondef - including the
-- comment, which argues against the mapping arm. If you are restoring this, the
-- argument it makes is the one you are choosing to accept again.
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
declare v_party uuid; v_company uuid; v_ok boolean;
begin
  -- The mapping arm is gone: a cross-book pair carrying an active mapping must
  -- now be REFUSED again. Calls the real function rather than restating it.
  select pc.party_id, pc.company_id into v_party, v_company
    from public.mst_party_companies pc
    join public.mst_parties p on p.id = pc.party_id
   where pc.active and p.is_customer and p.active
     and p.company_id is not null and p.company_id <> pc.company_id
   limit 1;

  if v_party is not null then
    v_ok := false;
    begin
      perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'ROLLBACK CHECK FAILED: the mapping arm is still accepting (% / %)', v_party, v_company;
    end if;
  end if;

  -- And an ordinary in-book pair still passes, so the rollback has not simply
  -- broken the guard shut.
  select p.id, p.company_id into v_party, v_company
    from public.mst_parties p
   where p.is_customer and p.active and p.company_id is not null
   limit 1;
  if v_party is not null then
    perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);
  end if;
end $check$;
