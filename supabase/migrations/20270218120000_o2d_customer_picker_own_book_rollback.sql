-- Rollback of 20270218120000_o2d_customer_picker_own_book.sql.
-- Restores both functions exactly as they were on live (pg_get_functiondef,
-- 24-10-2026) and drops the created_by stamp. Rows the new code wrote keep
-- their created_by - harmless: the old guard ignores the column.
-- PAIRED: roll the frontend back with it, or the picker hides derived links
-- the old guard would accept (unfriendly, never wrong).

begin;

drop trigger if exists mst_party_companies_stamp_creator on public.mst_party_companies;
drop function if exists public.mst_party_companies_stamp_creator();

CREATE OR REPLACE FUNCTION public.fms_dispatch_assert_customer_of_company(p_customer uuid, p_company uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- AND AN ACTIVE mst_party_companies ROW, regardless of `source`. DECIDED
  --   07-09-2026 (WORKLIST.md, OD-5). This reverses what the comment here used
  --   to say - "do not reach for the party-companies mapping, it records where
  --   a ledger of the same NAME exists, which is how you find the sibling row,
  --   not permission to bill this one" - and the reversal is deliberate, not an
  --   oversight by somebody who had not read it.
  --
  --   WHY: the ledger is opened by the Tally team at billing time, as a matter
  --   of process. The order must not be paused waiting for a master.
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

  select name into v_name from public.mst_parties where id = p_customer;
  select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
    into v_co from public.mst_companies where id = p_company;
  raise exception '% is not a customer of %. Pick a customer that company bills, or map them to it from the sales order.',
    coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
end $function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_map_party_company(p_party uuid, p_companies uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_created     integer := 0;
  v_reactivated integer := 0;
  v_skipped     integer := 0;
  v_company     uuid;
  v_bad         text;
  v_existing    boolean;
begin
  -- Copied verbatim from fms_dispatch_map_customer_item's FIX-8 guard: staff
  -- only. `can_raise` alone admits an Order Desk customer, who would then be
  -- mapping themselves into another company's book.
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
      insert into public.mst_party_companies (party_id, company_id, source, created_by)
      values (p_party, v_company, 'portal', auth.uid());
      v_created := v_created + 1;
    elsif v_existing then
      v_skipped := v_skipped + 1;
    else
      update public.mst_party_companies
         set active = true, updated_at = now()
       where party_id = p_party and company_id = v_company;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $function$;

commit;
