-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_batch_line_rebuild — the extractor. Line-for-line an extension of rpt_sales_item_rebuild
-- with ONE extra lateral (the batch level) and no sales-only voucher-type filter.
--
-- Incremental strategy is the house one: delete-and-reinsert of a DATE WINDOW per tenant, not
-- row-level diffing. Historical FYs stay frozen unless an explicit wide window is passed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.rpt_batch_line_rebuild(
  p_tenant text, p_from text, p_to text) returns integer
language plpgsql as $fn$
declare n integer;
begin
  delete from public.rpt_batch_line
   where tenant_id = p_tenant and vch_date between p_from and p_to;

  with vt as materialized (
    select voucher_type, chain from public.v_voucher_type_nature where tenant_id = p_tenant
  ),
  stock as materialized (
    select name, public.jtext(raw_payload->'PARENT') as grp
    from public.tally_object
    where tenant_id = p_tenant and object_type = 'StockItem'
  ),
  vch as materialized (
    select o.guid, o.fy, o.vch_date, o.raw_payload as p,
           o.raw_payload->>'VOUCHERTYPENAME' as voucher_type,
           public.jtext(o.raw_payload->'VOUCHERNUMBER') as voucher_no,
           public.jtext(o.raw_payload->'PARTYLEDGERNAME') as party,
           case
             when 'Sales'    = any(coalesce(vt.chain,'{}'))
               or 'Sales Accounts-HSS' = any(coalesce(vt.chain,'{}')) then 'sales'
             when 'Purchase' = any(coalesce(vt.chain,'{}'))
               or upper(coalesce(o.raw_payload->>'VOUCHERTYPENAME','')) like '%PURCHASE%'
                                                                        then 'purchase'
             else 'other'
           end as direction,
           (coalesce(o.raw_payload->>'VOUCHERTYPENAME','') !~* '(ORDER|PROFORMA)') as affects_stock
    from public.tally_object o
    left join vt on vt.voucher_type = o.raw_payload->>'VOUCHERTYPENAME'
    where o.tenant_id = p_tenant
      and o.object_type = 'Voucher'
      and o.vch_date between p_from and p_to
      and o.vch_date ~ '^[0-9]{8}$'
      and not o.is_deleted
      and coalesce(public.jtext(o.raw_payload->'ISCANCELLED'), 'No') = 'No'
      and coalesce(public.jtext(o.raw_payload->'ISOPTIONAL'),  'No') = 'No'
  ),
  -- ⚠ ALLINVENTORYENTRIES ONLY — see the header note on Stock Journal double-counting.
  lines as materialized (
    select v.*, ie.ord::int as line_no, ie.e as el,
           (public.jtext(ie.e->'ISDEEMEDPOSITIVE') = 'Yes') as inward,
           public.jtext(ie.e->'STOCKITEMNAME')              as stock_item
    from vch v
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(v.p->'ALLINVENTORYENTRIES.LIST')
        when 'array'  then v.p->'ALLINVENTORYENTRIES.LIST'
        when 'object' then jsonb_build_array(v.p->'ALLINVENTORYENTRIES.LIST')
        else '[]'::jsonb
      end) with ordinality as ie(e, ord)
  ),
  batches as materialized (
    select l.*, ba.ord::int as batch_no, ba.b
    from lines l
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(l.el->'BATCHALLOCATIONS.LIST')
        when 'array'  then l.el->'BATCHALLOCATIONS.LIST'
        when 'object' then jsonb_build_array(l.el->'BATCHALLOCATIONS.LIST')
        else '[]'::jsonb
      end) with ordinality as ba(b, ord)
    where jsonb_typeof(l.el->'BATCHALLOCATIONS.LIST') in ('array','object')
  ),
  norm as (
    select b.*,
           nullif(btrim(coalesce(public.jtext(b.b->'BATCHNAME'),'')),'')      as bname,
           nullif(btrim(coalesce(public.jtext(b.b->'GODOWNNAME'),'')),'')     as gname,
           nullif(btrim(coalesce(public.jtext(b.b->'ACTUALQTY'),'')),'')      as aqty,
           nullif(btrim(coalesce(public.jtext(b.b->'MFDON'),'')),'')          as mfd,
           nullif(btrim(coalesce(public.jtext(b.b->'EXPIRYPERIOD'),'')),'')   as expy
    from batches b
    where jsonb_typeof(b.b) = 'object'
  )
  insert into public.rpt_batch_line (
    tenant_id, company_guid, fy, vch_date, voucher_guid, line_no, batch_no,
    voucher_type, voucher_no, party, direction, movement, affects_stock,
    stock_item, stock_group, batch_name, is_real_lot, godown_name, destination_godown,
    qty, qty_text, uom, billed_qty, rate, amount, order_no, tracking_number,
    batch_mfd, batch_expiry, batch_expiry_raw, batch_date, batch_date_src, batch_udf)
  select
    p_tenant,
    split_part(split_part(p_tenant, '::', 2), '~', 1),
    x.fy, x.vch_date, x.guid, x.line_no, x.batch_no,
    x.voucher_type, x.voucher_no, x.party, x.direction,
    case when x.inward then 'in' else 'out' end,
    x.affects_stock,
    x.stock_item, s.grp,
    x.bname,
    (x.bname is not null and x.bname !~* '^\s*primar[ye]\s*batch\s*$'),
    -- 'PRIMARY BATCH' turns up as a GODOWN on 8 rows (batch/godown typed into swapped columns
    -- in Tally). Keep the value — do not silently repair someone's data entry — but it is why
    -- the godown domain check in verification exists.
    x.gname,
    nullif(btrim(coalesce(public.jtext(x.b->'DESTINATIONGODOWNNAME'),'')),''),
    public.amt(split_part(coalesce(x.aqty,''), ' ', 1)),
    x.aqty,
    nullif(btrim(substr(coalesce(x.aqty,''), coalesce(nullif(position(' ' in coalesce(x.aqty,'')),0), 999))),''),
    public.amt(split_part(coalesce(public.jtext(x.b->'BILLEDQTY'),''), ' ', 1)),
    -- BATCHRATE exists on the current-FY collection path but on only 2 of 10,488 closed-FY rows,
    -- so fall back to the PARENT inventory line's RATE, which is present on 98% of lines. Both are
    -- '<amount>/<unit>' (e.g. '690.00/KGS', '1.00/PCS'); take the amount side.
    coalesce(
      nullif(public.amt(split_part(coalesce(public.jtext(x.b ->'BATCHRATE'),''), '/', 1)), 0),
      nullif(public.amt(split_part(coalesce(public.jtext(x.el->'RATE'),      ''), '/', 1)), 0)),
    public.amt(coalesce(public.jtext(x.b->'AMOUNT'),'')),
    nullif(public.jtext(x.b->'ORDERNO'),        'Not Applicable'),
    nullif(public.jtext(x.b->'TRACKINGNUMBER'), 'Not Applicable'),
    -- Native Tally date fields. Both already arrive (empty) on the report path; Orange will use
    -- them, so these fill on their own once the connector fetch lands. Regex-guarded so a
    -- surprise format can never raise.
    -- ⚠ EVERY date coercion goes through rpt_try_date. Raw to_date() raises 22008 on the
    --   impossible dates Tally lot numbers encode ('24113100…' -> 31-Nov-2024), which aborts the
    --   whole window — and at the client that is indistinguishable from a timeout, so it silently
    --   poisons a chunked backfill. Ask me how I know.
    public.rpt_try_date(x.mfd),
    public.rpt_try_date(x.expy),
    x.expy,
    -- Resolved date. MFDON wins; the YYMMDD lot-name prefix is a LAST resort and only when it
    -- decodes to a date at or before the voucher date. ~31% of real lots encode one this way
    -- (26081306 -> 2026-08-13); the rest are supplier lot numbers in unrelated formats, so this
    -- must never be the only source and never part of a key.
    -- A NULL from rpt_try_date makes the <= comparison NULL, so the CASE simply falls through
    -- and the row keeps a NULL batch_date. An unparseable lot prefix can never raise.
    coalesce(
      public.rpt_try_date(x.mfd),
      case when public.rpt_try_date('20'||substr(x.bname,1,6))
                <= public.rpt_try_date(x.vch_date)
           then public.rpt_try_date('20'||substr(x.bname,1,6)) end),
    case when public.rpt_try_date(x.mfd) is not null then 'mfdon'
         when public.rpt_try_date('20'||substr(x.bname,1,6))
              <= public.rpt_try_date(x.vch_date) then 'lotname' end,
    -- Forward slot: any UDF-named sub-key, so a custom field cannot be lost while a decision is
    -- pending. Deliberately NOT every unknown key — the report path carries ~40 noise fields per
    -- row and storing them would bloat a 2.4 GB table on a 1 GB-RAM instance.
    (select jsonb_object_agg(k, v) from jsonb_each(x.b) as e(k, v) where k ilike '%UDF%')
  from norm x
  left join stock s on s.name = x.stock_item
  where x.stock_item is not null and btrim(x.stock_item) <> ''
  on conflict (tenant_id, voucher_guid, line_no, batch_no) do nothing;

  get diagnostics n = row_count;
  return n;
end $fn$;
