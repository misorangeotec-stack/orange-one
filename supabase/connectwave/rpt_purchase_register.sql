-- rpt_purchase_register — the purchase-side twin of rpt_sales_register.
--
-- NOT YET APPLIED TO CONNECTWAVE. Written on branch Bushra-Purchase-Register (2026-09-15). Until it is
-- run, localhost reads a local snapshot built by tools/build_purchase_register_snapshot.py, which
-- implements the SAME rules in Python — keep the two in step. Apply this file when the branch ships,
-- then drop VITE_PURCHASE_REGISTER_SOURCE=local from frontend/.env.local.
--
-- One row per voucher LINE, the same shape as the sales register: an item line when the voucher carries
-- stock items, otherwise one line per expense/purchase ledger (party, GST, round-off, TDS/TCS dropped).
--
-- WHICH VOUCHERS
--   Purchase          voucher type whose nature chain holds 'Purchase' or 'GST PURCHASE'
--                     (GST PURCHASE, GST PURCHASE-INK/-HEAD/-SPARE PARTS/-MACHINE/-PAPER…, GST-INWARD SERVICE)
--   Purchase Return   Debit Note nature AND 'PURCHASE' in the name, with RETURN    (PURCHASE RETURN, GST PURCHASE RETURN)
--   Purchase Debit Note  Debit Note nature AND 'PURCHASE' in the name, no RETURN   (PURCHASE DEBIT NOTE)
--   Purchase Credit Note Credit Note nature AND 'PURCHASE' in the name             (PURCHASE CREDIT NOTE)
-- The Debit/Credit Note half is the exact complement of rpt_sales_register_rebuild, which takes those
-- natures only when the name does NOT say PURCHASE — so GST DEBIT NOTE (a customer note) stays in the
-- sales register and never appears here. TCS / ISD / 194R debit notes carry no PURCHASE and stay out.
-- Purchase Orders, Receipt Notes and Rejections are not in either chain and never enter.
-- (rpt_purchase_line DOES count 5 GST DEBIT NOTE vouchers in Enterprise Surat FY 2025-26, because they
-- post to a Purchase Accounts ledger. Excluded here on purpose — finance treat GST DEBIT NOTE as sales.)
--
-- SIGN: Tally books a purchase as a debit (negative AMOUNT). `amount` is flipped so a purchase reads
-- positive and a return / debit note negative, matching rpt_purchase_line.
--
-- TYPE is built like the sales TYPE: the counterparty class (company_label, matched off the party name)
-- gives the BRANCH / RELATED prefix. A service bill (GST-INWARD SERVICE) is TYPE 'Purchase' like any
-- other — finance asked (2026-09-15) for goods vs service to show only in the report's Purchase-Type.

create table if not exists public.rpt_purchase_register (
  tenant_id     text        not null,
  company_guid  text        not null,
  fy            text        not null,
  vch_date      text        not null,           -- YYYYMMDD
  voucher_guid  text        not null,
  line_no       int         not null,
  kind          text        not null,           -- 'item' | 'ledger'
  location      text,
  company_label text,
  type          text        not null,
  date_display  text        not null,           -- DD-MM-YYYY
  party         text,
  particulars   text,
  voucher_type  text,
  voucher_no    text,
  gstin         text,
  quantity      numeric     not null default 0,
  rate          numeric     not null default 0,
  amount        numeric     not null default 0,
  built_at      timestamptz not null default now(),
  primary key (tenant_id, voucher_guid, line_no)
);

create index if not exists rpt_purchase_register_tenant_date
  on public.rpt_purchase_register (tenant_id, vch_date);

grant select on public.rpt_purchase_register to anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpt_purchase_register_rebuild(p_tenant text, p_from text DEFAULT '00000000'::text, p_to text DEFAULT '99999999'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  delete from public.rpt_purchase_register
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
            coalesce(vn.chain,'{}') && array['Purchase','GST PURCHASE']
         or ( coalesce(vn.chain,'{}') && array['Credit Note','Debit Note']
              and upper(o.raw_payload->>'VOUCHERTYPENAME') like '%PURCHASE%' )
         -- A voucher whose type MASTER this book no longer has (Enterprise Surat 2024-26 holds
         -- 'GST PURCHASE - INK' vouchers with no such type) is judged by the same name in any book.
         or ( vn.chain is null and exists (
                select 1 from public.v_voucher_type_nature x
                where x.voucher_type = o.raw_payload->>'VOUCHERTYPENAME'
                  and ( x.chain && array['Purchase','GST PURCHASE']
                     or ( x.chain && array['Credit Note','Debit Note']
                          and upper(x.voucher_type) like '%PURCHASE%' ) ) ) )
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
    where jsonb_typeof(ie.e) = 'object'
      and btrim(coalesce(ie.e->'STOCKITEMNAME'->>'#text', ie.e->>'STOCKITEMNAME','')) <> ''
  ),
  invcount as materialized (
    select guid from inv group by guid
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
    -- Tally's purchase AMOUNT is a debit (negative): flipped so a purchase reads positive.
    select v.guid, i.line_no, 'item'::text as kind, i.item as particulars,
           sign(-i.amount) * abs(i.qty) as quantity, abs(i.rate) as rate, -i.amount as amount,
           v.fy, v.vch_date, v.voucher_type, v.voucher_no, v.party, v.gstin
    from inv i join vch v on v.guid = i.guid
    union all
    select v.guid, l.line_no, 'ledger'::text as kind, l.ledger as particulars,
           0::numeric, 0::numeric, -l.amount as amount,
           v.fy, v.vch_date, v.voucher_type, v.voucher_no, v.party, v.gstin
    from led_kept l join vch v on v.guid = l.guid
  ),
  labeled as (
    select r.*, co.location,
      (case co.classifier
         when 'OOTPL'  then case when upper(r.party) like 'ORANGE O TEC P%' then 'ORANGE O TEC BRANCH'
                                 when upper(r.party) like 'ORANGE O TEC E%' then 'ORANGE O TEC RELATED'
                                 when upper(r.party) like 'COLORIX DIGITAL PRINTING SOLUTIONS%' then 'ORANGE O TEC RELATED'
                                 else 'ORANGE O TEC' end
         when 'OOTEPL' then case when upper(r.party) like 'ORANGE O TEC P%' then 'ORANGE ENT RELATED'
                                 when upper(r.party) like 'ORANGE O TEC E%' then 'ORANGE ENT BRANCH'
                                 when upper(r.party) like 'COLORIX DIGITAL PRINTING SOLUTIONS%' then 'ORANGE ENT RELATED'
                                 else 'ORANGE ENTERPRISE' end
         -- Colorix buys from both Orange companies; the sales rule only needed O TEC P.
         else               case when upper(r.party) like 'ORANGE O TEC P%' then 'COLORIX RELATED'
                                 when upper(r.party) like 'ORANGE O TEC E%' then 'COLORIX RELATED'
                                 else 'COLORIX' end
       end) as company_label
    from rws r cross join co
  )
  insert into public.rpt_purchase_register
    (tenant_id, company_guid, fy, vch_date, voucher_guid, line_no, kind,
     location, company_label, type, date_display, party, particulars,
     voucher_type, voucher_no, gstin, quantity, rate, amount)
  select p_tenant,
         split_part(split_part(p_tenant, '::', 2), '~', 1),
         lb.fy, lb.vch_date, lb.guid, lb.line_no, lb.kind,
         lb.location, lb.company_label,
         (case when upper(lb.company_label) like '%BRANCH%'  then 'Branch '
               when upper(lb.company_label) like '%RELATED%' then 'Related '
               else '' end)
         || case
              when upper(lb.voucher_type) like '%RETURN%'      then 'Purchase Return'
              when upper(lb.voucher_type) like '%DEBIT NOTE%'  then 'Purchase Debit Note'
              when upper(lb.voucher_type) like '%CREDIT NOTE%' then 'Purchase Credit Note'
              else 'Purchase'
            end,
         to_char(to_date(lb.vch_date, 'YYYYMMDD'), 'DD-MM-YYYY'),
         lb.party, lb.particulars, lb.voucher_type, lb.voucher_no, lb.gstin,
         lb.quantity, lb.rate, lb.amount
  from labeled lb
  on conflict (tenant_id, voucher_guid, line_no) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.rpt_purchase_register_rebuild(text, text, text) from public, anon, authenticated;

-- Rebuild every book rpt_sales_book knows (the generic winning-book resolver, over ALL vouchers).
CREATE OR REPLACE FUNCTION public.rpt_purchase_register_refresh_all()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; n int := 0;
begin
  for t in select distinct tenant_id from public.rpt_sales_book loop
    n := n + public.rpt_purchase_register_rebuild(t);
  end loop;
  return n;
end $function$;

revoke all on function public.rpt_purchase_register_refresh_all() from public, anon, authenticated;

-- When applying: run once, then schedule OFF the five-minute marks the other rebuilds use
-- (see CONNECTWAVE-READ-COST.md), e.g.
--   select public.rpt_purchase_register_refresh_all();
--   select cron.schedule('rpt-purchase-register-nightly', '25 15 * * *',   -- 20:55 IST
--                        $$select public.rpt_purchase_register_refresh_all()$$);
