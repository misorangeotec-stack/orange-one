-- rpt_sales_register_rebuild — the function that builds the Sales Register's rows.
--
-- ⚠️ LIVE IN THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb), not the Orange One identity project.
--    Until 2026-09-10 this function existed only in the database. This file is the first
--    version-controlled copy, taken with pg_get_functiondef and then edited; apply it through the
--    ConnectWave SQL editor. Re-running it is safe (create or replace).
--
-- CHANGES ON 2026-09-10 (asked for by finance, against Tally's own Voucher Register):
--   1. COLORIX DIGITAL PRINTING SOLUTIONS LLP is a RELATED party. Its ledger in the O-tec book is
--      'COLORIX DIGITAL PRINTING SOLUTIONS LLP-SALES'; the match is on the company-name prefix so any
--      ledger for that company counts. It now classes as ORANGE O TEC RELATED in an O-tec book and
--      ORANGE ENT RELATED in an Enterprise book, so its SALE lines become RELATED SALE (and a
--      credit note, return or challan picks up its Related variant the same way). It was 3 lines
--      of SALE in FY 26-27 when this was written. Inside the Colorix book itself nothing changes.
--   2. DELIVERY CHALLAN TYPE is decided by the VOUCHER-TYPE NAME: a name containing 'APPROVAL' is
--      SOA; every other delivery challan is FOC SALE (or Branch FOC / Related FOC for those
--      parties). It used to be decided by `invcount.all_rate1` — every stock line at rate 1 meant
--      FOC, anything else meant SOA — which put challans like 'DELIVERY CHALLAN - SPARE PARTS' and
--      'DELIVERY CHALLAN - INK(MACHINE)' under SOA whenever one line carried a real rate.
--      An APPROVAL challan is SOA whoever the party is; the rule is about the voucher, not the party.
--   3. 'FOC Sale' is now spelt 'FOC SALE', matching SALE / BRANCH SALE / RELATED SALE beside it.
--
--   `invcount` stays: the `led` CTE still uses it to tell item vouchers from ledger-only ones. Its
--   `all_rate1` column is simply no longer read.
--
-- Nothing outside the Sales Register reads `type` or `company_label` (checked 2026-09-10:
-- masters-sync reads kind/company_guid/party/particulars/vch_date/quantity only).

CREATE OR REPLACE FUNCTION public.rpt_sales_register_rebuild(p_tenant text, p_from text DEFAULT '00000000'::text, p_to text DEFAULT '99999999'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5min'
AS $function$
declare n integer;
begin
  delete from public.rpt_sales_register
   where tenant_id = p_tenant and vch_date between p_from and p_to;

  with
  co as materialized (
    select case when vc.company_name ilike '%ENTERPRISE%' then 'OOTEPL'
                when vc.company_name ilike '%COLORIX%'    then 'COLORIX'
                else 'OOTPL' end as classifier,
           case when vc.company_name ilike '%NOIDA%' then 'NOIDA' else 'SURAT' end as location
    from public.v_company vc where vc.tenant_id = p_tenant
  ),
  vch as materialized (
    select o.guid, o.fy, o.vch_date, o.raw_payload p,
           o.raw_payload->>'VOUCHERTYPENAME' as voucher_type,
           o.raw_payload->>'VOUCHERNUMBER'  as voucher_no,
           coalesce(o.raw_payload->'PARTYLEDGERNAME'->>'#text', o.raw_payload->>'PARTYLEDGERNAME') as party,
           public.jtext(o.raw_payload->'PARTYGSTIN') as gstin
    from public.tally_object o
    left join public.v_voucher_type_nature vn
           on vn.tenant_id = o.tenant_id and vn.voucher_type = o.raw_payload->>'VOUCHERTYPENAME'
    where o.tenant_id = p_tenant
      and o.object_type = 'Voucher'
      and o.vch_date between p_from and p_to
      and not o.is_deleted
      and coalesce(public.jtext(o.raw_payload->'ISCANCELLED'), 'No') = 'No'
      and coalesce(public.jtext(o.raw_payload->'ISOPTIONAL'),  'No') = 'No'
      and (
            coalesce(vn.chain,'{}') && array['Sales','Sales Accounts-HSS']
         or coalesce(vn.chain,'{}') && array['Delivery Note']
         or upper(o.raw_payload->>'VOUCHERTYPENAME') like '%DELIVERY CHALLAN%'
         or ( coalesce(vn.chain,'{}') && array['Credit Note','Debit Note']
              and upper(o.raw_payload->>'VOUCHERTYPENAME') not like '%PURCHASE%' )
      )
  ),
  inv as materialized (
    select v.guid, ie.ord::int as line_no,
           coalesce(ie.e->'STOCKITEMNAME'->>'#text', ie.e->>'STOCKITEMNAME') as item,
           public.amt(coalesce(ie.e->'BILLEDQTY'->>'#text', ie.e->>'BILLEDQTY')) as qty,
           public.amt(coalesce(ie.e->'RATE'->>'#text', ie.e->>'RATE')) as rate,
           public.amt(coalesce(ie.e->'AMOUNT'->>'#text', ie.e->>'AMOUNT')) as amount
    from vch v
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(v.p->'ALLINVENTORYENTRIES.LIST')
        when 'array'  then v.p->'ALLINVENTORYENTRIES.LIST'
        when 'object' then jsonb_build_array(v.p->'ALLINVENTORYENTRIES.LIST')
        else '[]'::jsonb end
    ) with ordinality as ie(e, ord)
    where btrim(coalesce(ie.e->'STOCKITEMNAME'->>'#text', ie.e->>'STOCKITEMNAME','')) <> ''
  ),
  invcount as materialized (
    select guid, count(*) n_items, bool_and(abs(rate) = 1) all_rate1 from inv group by guid
  ),
  led as materialized (
    select v.guid, e.ord::int as line_no, v.party,
           coalesce(e.line->'LEDGERNAME'->>'#text', e.line->>'LEDGERNAME') as ledger,
           public.amt(coalesce(e.line->'AMOUNT'->>'#text', e.line->>'AMOUNT')) as amount
    from vch v
    cross join lateral public.entry_lines(v.p) with ordinality as e(line, ord)
    where not exists (select 1 from invcount ic where ic.guid = v.guid)
  ),
  led_kept as materialized (
    select l.guid, l.line_no, l.ledger, l.amount from led l
    where l.ledger is distinct from l.party
      and upper(l.ledger) !~ '(GST|ROUND|TDS|TCS|CESS|OUTPUT TAX|INPUT TAX)'
      and l.amount <> 0
  ),
  rws as (
    select v.guid, i.line_no, 'item'::text as kind, i.item as particulars,
           sign(i.amount) * abs(i.qty) as quantity, abs(i.rate) as rate, i.amount as revenue,
           v.fy, v.vch_date, v.voucher_type, v.voucher_no, v.party, v.gstin
    from inv i join vch v on v.guid = i.guid
    union all
    select v.guid, l.line_no, 'ledger'::text as kind, l.ledger as particulars,
           0::numeric, 0::numeric, l.amount as revenue,
           v.fy, v.vch_date, v.voucher_type, v.voucher_no, v.party, v.gstin
    from led_kept l join vch v on v.guid = l.guid
  ),
  labeled as (
    select r.*, co.location, ic.all_rate1,
      (case co.classifier
         when 'OOTPL'  then case when upper(r.party) like 'ORANGE O TEC P%' then 'ORANGE O TEC BRANCH'
                                 when upper(r.party) like 'ORANGE O TEC E%' then 'ORANGE O TEC RELATED'
                                 when upper(r.party) like 'COLORIX DIGITAL PRINTING SOLUTIONS%' then 'ORANGE O TEC RELATED'
                                 else 'ORANGE O TEC' end
         when 'OOTEPL' then case when upper(r.party) like 'ORANGE O TEC P%' then 'ORANGE ENT RELATED'
                                 when upper(r.party) like 'ORANGE O TEC E%' then 'ORANGE ENT BRANCH'
                                 when upper(r.party) like 'COLORIX DIGITAL PRINTING SOLUTIONS%' then 'ORANGE ENT RELATED'
                                 else 'ORANGE ENTERPRISE' end
         else               case when upper(r.party) like 'ORANGE O TEC P%' then 'COLORIX RELATED'
                                 else 'COLORIX' end
       end) as company_label
    from rws r cross join co
    left join invcount ic on ic.guid = r.guid
  )
  insert into public.rpt_sales_register
    (tenant_id, company_guid, fy, vch_date, voucher_guid, line_no, kind,
     location, company_label, type, date_display, party, particulars,
     voucher_type, voucher_no, gstin, quantity, rate, revenue)
  select p_tenant,
         split_part(split_part(p_tenant, '::', 2), '~', 1),
         lb.fy, lb.vch_date, lb.guid, lb.line_no, lb.kind,
         lb.location, lb.company_label,
         case
           when lower(lb.voucher_type) like '%delivery challan%' then
             case when lower(lb.voucher_type) like '%approval%'   then 'SOA'
                  when upper(lb.company_label) like '%BRANCH%'  then 'Branch FOC'
                  when upper(lb.company_label) like '%RELATED%' then 'Related FOC'
                  else 'FOC SALE' end
           when lower(lb.voucher_type) like '%credit note%' then
             case when upper(lb.company_label) like '%BRANCH%'  then 'Branch Credit Note'
                  when upper(lb.company_label) like '%RELATED%' then 'Related Credit Note'
                  else 'Credit Note' end
           when lower(lb.voucher_type) like '%debit note%' then
             case when upper(lb.company_label) like '%BRANCH%'  then 'Branch Debit Note'
                  when upper(lb.company_label) like '%RELATED%' then 'Related Debit Note'
                  else 'Debit Note' end
           when lower(lb.voucher_type) like '%sale return%'
             or lower(lb.voucher_type) like '%sales return%' then
             case when upper(lb.company_label) like '%BRANCH%'  then 'Branch Return'
                  when upper(lb.company_label) like '%RELATED%' then 'Related Return'
                  else 'Sales Return' end
           else
             case when upper(lb.company_label) like '%BRANCH%'  then 'BRANCH SALE'
                  when upper(lb.company_label) like '%RELATED%' then 'RELATED SALE'
                  else 'SALE' end
         end,
         to_char(to_date(lb.vch_date, 'YYYYMMDD'), 'DD-MM-YYYY'),
         lb.party, lb.particulars, lb.voucher_type, lb.voucher_no, lb.gstin,
         lb.quantity, lb.rate, lb.revenue
  from labeled lb
  on conflict (tenant_id, voucher_guid, line_no) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;
