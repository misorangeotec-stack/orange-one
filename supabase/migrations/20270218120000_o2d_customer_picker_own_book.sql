-- =============================================================================
--  O2D customer picker: the billing company's OWN customers, plus the ones a
--  PERSON mapped to it. Links the cron derived by name no longer count.
-- =============================================================================
--
--  THE COMPLAINT (24-10-2026): New Sales Order, billing company O-tec - Surat,
--  Customer opens with "SHREEJI PRINTS PVT LTD" twice - 23 items and 94 items.
--  The 94 is O-tec's own ledger. The 23 is Enterprises - Surat's ledger, offered
--  under O-tec because mst_party_companies holds an active (party, O-tec) row.
--
--  NOBODY MADE THAT ROW. mst_refresh_party_companies() (cron
--  mst-refresh-company-links, four times an hour) links a ledger into EVERY
--  book that holds a ledger of the same name or GSTIN, with source 'tally' and
--  created_by NULL. OD-5 (20261119120000) taught the guard and the picker to
--  accept any active row "regardless of source", so every derived link became
--  billing permission. Measured on live 24-10-2026:
--    * 389 active rows link a ledger into a book that already has its OWN
--      ledger of the same name - each one a duplicate in the picker;
--    * 543 orders sit on the other book's ledger while the billing book has its
--      own (36 still open). The ledger flows into the bill and the Tally entry.
--
--  THE RULE NOW (user, 24-10-2026): pick the company, see that company's
--  customers. Mapping one in from another book stays possible and is a
--  person's call. So a link counts only when created_by is set:
--    * fms_dispatch_map_party_company (the Map button) writes auth.uid() - and
--      now also CLAIMS an existing derived row, which it used to skip, else
--      mapping a firm the cron had already linked would do nothing;
--    * Central Masters' company picker inserts through PostgREST with no
--      created_by - the trigger below stamps auth.uid() on 'portal' rows;
--    * the cron inserts 'tally' rows with auth.uid() NULL - never stamped, and
--      never written by the person who happens to run it (source is 'tally').
--
--  WHAT IS NOT TOUCHED: no row is deleted or switched off, and no order is
--  changed. update_order checks the customer only when the customer or company
--  is CHANGED on an edit, so the 36 open orders move on as they are. The Order
--  Desk paths pick the ledger by mst_parties.company_id and never reach the
--  second branch. mst_refresh_party_companies() is unchanged.
--
--  PAIRED WITH THE FRONTEND (store.tsx customersForCompany + the map modal),
--  same rule on both sides. Old frontend + this migration: the picker can
--  still offer a derived duplicate and the save refuses it with the usual
--  "is not a customer of" message - safe, just unfriendly, until the deploy.
--
--  Rollback: 20270218120000_o2d_customer_picker_own_book_rollback.sql
-- =============================================================================

begin;

-- ------------------------------------------- who made a hand-added link ------
create or replace function public.mst_party_companies_stamp_creator()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- 'portal' only: a 'tally' row is the cron's, whoever ran it.
  if new.created_by is null and new.source = 'portal' then
    new.created_by := auth.uid();
  end if;
  return new;
end $function$;

drop trigger if exists mst_party_companies_stamp_creator on public.mst_party_companies;
create trigger mst_party_companies_stamp_creator
  before insert on public.mst_party_companies
  for each row execute function public.mst_party_companies_stamp_creator();


-- ------------------------------------------------------------- the guard -----
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

  -- AND AN ACTIVE mst_party_companies ROW THAT A PERSON MADE (created_by set).
  --   OD-5 (07-09-2026) accepted any active row "regardless of source"; the
  --   rows mst_refresh_party_companies() derives by NAME then offered every
  --   other book's same-name ledger as billable - 389 duplicates, 543 orders
  --   on the wrong book's ledger (24-10-2026). Mapping in from another book
  --   stays possible; it has to be somebody's decision.
  --   Must match customersForCompany in the O2D store exactly.
  if exists (
    select 1
      from public.mst_party_companies pc
      join public.mst_parties c on c.id = pc.party_id
     where pc.party_id = p_customer
       and pc.company_id = p_company
       and pc.active
       and pc.created_by is not null
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


-- ------------------------------------------------------- the Map button ------
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
  v_mine        boolean;
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
    v_existing := null;
    select active, created_by is not null into v_existing, v_mine
      from public.mst_party_companies
     where party_id = p_party and company_id = v_company;

    if v_existing is null then
      insert into public.mst_party_companies (party_id, company_id, source, created_by)
      values (p_party, v_company, 'portal', auth.uid());
      v_created := v_created + 1;
    elsif v_existing and v_mine then
      v_skipped := v_skipped + 1;
    elsif v_existing then
      -- A row the cron derived: the guard ignores it until a person owns it,
      -- so claiming it IS the mapping. Counted as created - to the user it is.
      update public.mst_party_companies
         set created_by = auth.uid(), updated_at = now()
       where party_id = p_party and company_id = v_company;
      v_created := v_created + 1;
    else
      update public.mst_party_companies
         set active = true, created_by = coalesce(created_by, auth.uid()), updated_at = now()
       where party_id = p_party and company_id = v_company;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $function$;

commit;
