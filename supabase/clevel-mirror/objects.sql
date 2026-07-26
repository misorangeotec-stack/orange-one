-- ============================================================================
-- C-Level Dashboard — Tally-mirror DB objects
-- Target project: ieeefdnyhzgrroifiqbb (ConnectWave / Tally mirror). Apply via Supabase MCP / SQL editor.
-- Additive-only. Owned by postgres (bypasses RLS on tally_object/tally_voucher_line), granted to anon.
-- See README.md. Reuses existing helpers: public.jtext(jsonb), public.amt(text), public.v_voucher_type_nature,
-- public.v_ledger_detail, public.v_fs_company, public.tally_object, public.tally_voucher_line.
-- ============================================================================

-- 1) Corrected voucher accounting-line extractor (documents the reconstruction; used for verification).
create or replace function public.clevel_entry_lines(p jsonb)
returns setof jsonb language sql immutable as $$
  select e from jsonb_array_elements(
    case when jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='array'  and jsonb_array_length(p->'ALLLEDGERENTRIES.LIST')>0 then p->'ALLLEDGERENTRIES.LIST'
         when jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='object' then jsonb_build_array(p->'ALLLEDGERENTRIES.LIST')
         else '[]'::jsonb end) e
  union all
  select e from jsonb_array_elements(
    case when (jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='array' and jsonb_array_length(p->'ALLLEDGERENTRIES.LIST')>0)
           or jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='object' then '[]'::jsonb
         when jsonb_typeof(p->'LEDGERENTRIES.LIST')='array'  then p->'LEDGERENTRIES.LIST'
         when jsonb_typeof(p->'LEDGERENTRIES.LIST')='object' then jsonb_build_array(p->'LEDGERENTRIES.LIST')
         else '[]'::jsonb end) e
  union all
  select aa
  from jsonb_array_elements(
         case when (jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='array' and jsonb_array_length(p->'ALLLEDGERENTRIES.LIST')>0)
                or jsonb_typeof(p->'ALLLEDGERENTRIES.LIST')='object' then '[]'::jsonb
              when jsonb_typeof(p->'ALLINVENTORYENTRIES.LIST')='array'  then p->'ALLINVENTORYENTRIES.LIST'
              when jsonb_typeof(p->'ALLINVENTORYENTRIES.LIST')='object' then jsonb_build_array(p->'ALLINVENTORYENTRIES.LIST')
              else '[]'::jsonb end) ie,
       jsonb_array_elements(
         case when jsonb_typeof(ie->'ACCOUNTINGALLOCATIONS.LIST')='array'  then ie->'ACCOUNTINGALLOCATIONS.LIST'
              when jsonb_typeof(ie->'ACCOUNTINGALLOCATIONS.LIST')='object' then jsonb_build_array(ie->'ACCOUNTINGALLOCATIONS.LIST')
              else '[]'::jsonb end) aa;
$$;
grant execute on function public.clevel_entry_lines(jsonb) to anon;

-- 2) Ledger lookup (one row per ledger). Refreshed CONCURRENTLY.
create materialized view public.mv_clevel_ledger as
  select tenant_id, guid, ledger, sub_group, grouping, group_chain,
         opening, closing, closing_dr_cr, credit_limit, credit_period, gstin
  from public.v_ledger_detail;
create unique index mv_clevel_ledger_pk on public.mv_clevel_ledger (tenant_id, guid);
create index mv_clevel_ledger_lookup on public.mv_clevel_ledger (tenant_id, ledger);
grant select on public.mv_clevel_ledger to anon;

-- 3) Monthly P&L spine (both FY), fast from tally_voucher_line.
create table if not exists public.clevel_pl_monthly (
  tenant_id text not null, company_guid text not null, fy text not null, ym text not null,
  sales numeric, purchase numeric, income numeric, expense numeric,
  primary key (tenant_id, fy, ym)
);
grant select on public.clevel_pl_monthly to anon;

create or replace function public.clevel_refresh_pl_monthly()
returns void language plpgsql as $$
begin
  truncate table public.clevel_pl_monthly;
  with nonacct as (
    select tenant_id, voucher_type from public.v_voucher_type_nature
    where chain && ARRAY['Sales Order','Purchase Order','Job Work In Order','Job Work Out Order','Delivery Note',
                        'Receipt Note','Rejections In','Rejections Out','Material In','Material Out','Stock Journal',
                        'Physical Stock','Memorandum','Reversing Journal','Attendance']
  ),
  vl as (
    select l.tenant_id, l.fy, substr(l.vch_date,1,6) as ym, l.voucher_guid, l.list_key, l.amount,
           d.grouping, d.sub_group
    from public.tally_voucher_line l
    left join public.mv_clevel_ledger d on d.tenant_id=l.tenant_id and d.guid=l.ledger_guid
    where not l.is_cancelled and not coalesce(l.is_optional,false)
      and l.tenant_id in (select tenant_id from public.v_fs_company)
      and l.vch_date is not null and l.vch_date <> ''
      and not exists (select 1 from nonacct n where n.tenant_id=l.tenant_id and n.voucher_type=l.voucher_type)
  ),
  full_part as (
    select tenant_id, fy, ym,
      coalesce(sum(amount) filter (where grouping='Sales Accounts'),0) as sales_full,
      coalesce(-sum(amount) filter (where grouping='Purchase Accounts'),0) as purch_full,
      coalesce(sum(amount) filter (where grouping in ('Sales Accounts','Direct Incomes','Indirect Incomes')),0) as income_full,
      coalesce(-sum(amount) filter (where grouping in ('Purchase Accounts','Direct Expenses','Indirect Expenses')),0) as expense_full
    from vl group by tenant_id, fy, ym
  ),
  short_v as (
    select tenant_id, fy, ym, voucher_guid,
      max((sub_group='Sundry Debtors')::int) as is_sales,
      max((sub_group='Sundry Creditors')::int) as is_purch,
      -sum(amount) as missing
    from vl where list_key='LEDGERENTRIES.LIST' group by tenant_id, fy, ym, voucher_guid
  ),
  short_agg as (
    select tenant_id, fy, ym,
      coalesce(sum(missing) filter (where is_sales=1 and is_purch=0),0) as sales_short,
      coalesce(sum(missing) filter (where is_purch=1 and is_sales=0),0) as purch_short
    from short_v group by tenant_id, fy, ym
  )
  insert into public.clevel_pl_monthly (tenant_id, company_guid, fy, ym, sales, purchase, income, expense)
  select coalesce(f.tenant_id,s.tenant_id), split_part(coalesce(f.tenant_id,s.tenant_id),'::',2),
         coalesce(f.fy,s.fy), coalesce(f.ym,s.ym),
         coalesce(f.sales_full,0)+coalesce(s.sales_short,0),
         coalesce(f.purch_full,0)+coalesce(s.purch_short,0),
         coalesce(f.income_full,0)+coalesce(s.sales_short,0),
         coalesce(f.expense_full,0)+coalesce(s.purch_short,0)
  from full_part f
  full join short_agg s on s.tenant_id=f.tenant_id and s.fy=f.fy and s.ym=f.ym;
end $$;

-- 4) Duties & Taxes.
create or replace view public.v_clevel_gst_summary as
  select tenant_id, split_part(tenant_id,'::',2) as company_guid, ledger as tax_name, sub_group,
         closing, closing_dr_cr,
         case when closing > 0 then closing else 0 end  as receivable,
         case when closing < 0 then -closing else 0 end as payable
  from public.mv_clevel_ledger
  where group_chain @> ARRAY['Duties & Taxes'] and abs(closing) > 0.005;
grant select on public.v_clevel_gst_summary to anon;

-- 5) Stock (value sign-flipped to match v_fs_stock).
create or replace view public.v_clevel_stock_group_summary as
  select o.tenant_id, split_part(o.tenant_id,'::',2) as company_guid,
         coalesce(nullif(public.jtext(o.raw_payload->'PARENT'),''),'(Ungrouped)') as stock_group,
         count(*) as item_count,
         sum(public.amt(split_part(public.jtext(o.raw_payload->'CLOSINGBALANCE'),' ',1))) as closing_qty,
         -sum(public.amt(public.jtext(o.raw_payload->'CLOSINGVALUE'))) as closing_value
  from public.tally_object o
  where o.object_type='StockItem' and not o.is_deleted
  group by o.tenant_id, coalesce(nullif(public.jtext(o.raw_payload->'PARENT'),''),'(Ungrouped)');
grant select on public.v_clevel_stock_group_summary to anon;

create or replace view public.v_clevel_stock_item as
  select o.tenant_id, split_part(o.tenant_id,'::',2) as company_guid, o.name as item,
         coalesce(nullif(public.jtext(o.raw_payload->'PARENT'),''),'(Ungrouped)') as stock_group,
         public.jtext(o.raw_payload->'BASEUNITS') as base_unit,
         public.amt(split_part(public.jtext(o.raw_payload->'OPENINGBALANCE'),' ',1)) as opening_qty,
         public.amt(split_part(public.jtext(o.raw_payload->'CLOSINGBALANCE'),' ',1)) as closing_qty,
         -public.amt(public.jtext(o.raw_payload->'CLOSINGVALUE')) as closing_value,
         public.amt(split_part(public.jtext(o.raw_payload->'OPENINGBALANCE'),' ',1))
           - public.amt(split_part(public.jtext(o.raw_payload->'CLOSINGBALANCE'),' ',1)) as movement_qty
  from public.tally_object o
  where o.object_type='StockItem' and not o.is_deleted and o.name is not null;
grant select on public.v_clevel_stock_item to anon;

-- 6) Refresh entry point + hourly pg_cron.
create or replace function public.clevel_refresh_all()
returns void language plpgsql as $$
begin
  refresh materialized view concurrently public.mv_clevel_ledger;
  perform public.clevel_refresh_pl_monthly();
end $$;
-- select cron.schedule('clevel_refresh_all', '25 * * * *', $$select public.clevel_refresh_all();$$);
