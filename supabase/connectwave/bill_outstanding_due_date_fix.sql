-- Bill due dates — Tally's BILLCREDITPERIOD is EITHER a day count OR an explicit due date.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (tenant acct_orange), NOT the Orange One identity
--    project. The repo's `supabase/migrations/` + `supabase db push` target the identity project —
--    run this one in the ConnectWave SQL editor (or via a psql/service connection to ConnectWave).
--    No frontend deploy is needed: nothing in the React app parses a credit period.
--
-- THE BUG (found 2026-08-06 on KALAHANSH FASHIONS LLP -MACHINE, Colorix):
--   Tally's `BILLCREDITPERIOD` holds one of two things, depending on what the user typed into
--   Bill-wise Details:
--       "45 Days"    -> a credit PERIOD, days to add to the bill date
--       "5-May-26"   -> an explicit DUE DATE
--   Every bill_outstanding* object assumed the first form and stripped all non-digits:
--
--       to_date(bill_date,'YYYYMMDD') + regexp_replace(credit_period,'\D','','g')::int
--
--   So "5-May-26" became "526" and the due date landed 526 days after the bill date:
--   13-Sep-2025 + 526 = 21-Feb-2027. Every ...-26 bill collapsed onto 21-02-2027 and every
--   ...-27 bill onto 22-02-2027, and overdue_days fell to 0 for all of them. The bug therefore
--   UNDERSTATES overdue — it never overstates it.
--
-- SCOPE (verified by an exhaustive sweep of every function/view/matview in `public`):
--   Exactly four objects carry the bad expression —
--       bill_outstanding_tally_by_id   (this file; the Ledger Outstandings screen)
--       bill_outstanding_by_id         (stage 2; feeds every rpt_* rebuild + collection_refresh)
--       bill_outstanding               (stage 2; the by-name twin)
--       v_bill_outstanding             (stage 2; SQL-level duplicate, currently unused)
--   `collection_refresh`, `rpt_receivables_rebuild` and `rpt_payables_rebuild` also strip
--   non-digits, but only off the LEDGER-MASTER credit period, which never holds a date form
--   (it holds "N Days", bare numbers, ADVANCE, IMMEDIATE). They are correct as-is — do not touch.
--
-- WHY THE PARSE IS SAFE (checked against all 61,410 stored values):
--   - Exactly TWO shapes exist: `^\d{1,3} Days$` (52,068) and `^\d{1,2}-[A-Z][a-z]{2}-\d{2}$`
--     (9,342). Zero values match neither. No "Month", no DD-MM-YYYY, no 4-digit year, no
--     lowercase month names.
--   - All 994 distinct date-form values round-trip through 'DD-Mon-YY' exactly; all 12 month
--     tokens are valid; the range is 2020-2028, so Postgres's YY pivot is unambiguous.
--   - Zero bills carry two conflicting date-form credit periods, so the existing `max()` over
--     text cannot pick a wrong one (it would be lexicographic: '5-May-26' > '5-Jun-26').
--   - Zero opening bills lack a bill date, so the fix never invents a due date where the old
--     code suppressed one.
--
-- BEHAVIOUR PRESERVED DELIBERATELY:
--   - `overdue_days` stays NULL when no due date can be resolved. Note GREATEST() *ignores*
--     NULLs in Postgres — `greatest(0, null)` is 0, not null — so the null is guarded by an
--     explicit `case when due_d is not null`, NOT left to GREATEST.
--   - This function takes `p_as_on` from the UI and has NO ledger-master fallback for the
--     credit period (`coalesce(d.credit_period,'')`). Its two siblings use `current_date` and
--     DO fall back to `led.cp`. Keep that difference.
--   - Signature, STABLE, SECURITY DEFINER, search_path and grants are unchanged; only the final
--     SELECT block differs from the previous definition.
--
-- ROLLBACK: the exact pre-change definitions of all four objects are stored in
--   public.fn_backup_duedate_fix_20260806 (obj_name, definition), captured by pg_get_functiondef
--   itself on 2026-08-06. To revert, execute the stored `definition` text for the object.

create or replace function public.bill_outstanding_tally_by_id(
  p_tenant      text,
  p_ledger_guid text,
  p_as_on       date default current_date
)
returns table(
  bill_ref       text,
  bill_date      text,
  bill_amount    numeric,
  pending_amount numeric,
  credit_period  text,
  due_date       text,
  overdue_days   integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select l.voucher_guid                          as guid,
           public.jtext(v.raw_payload->'DATE')     as vch_date,
           l.allocs
    from public.tally_voucher_line l
    join public.tally_object v
      on v.tenant_id    = l.tenant_id
     and v.guid         = l.voucher_guid
     and v.object_type  = 'Voucher'
     and not v.is_deleted
    where l.tenant_id   = p_tenant
      and l.ledger_guid = p_ledger_guid
      and not l.is_cancelled
      and not l.is_optional
  ),
  allocs as (
    select m.guid, m.vch_date,
           nullif(public.jtext(b->'NAME'),'')             as bill_ref,
           public.jtext(b->'BILLTYPE')                    as bill_type,
           public.amt(public.jtext(b->'AMOUNT'))          as amount_raw,
           nullif(public.jtext(b->'BILLCREDITPERIOD'),'') as credit_period
    from mine m
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(m.allocs)
        when 'array'  then m.allocs
        when 'object' then jsonb_build_array(m.allocs)
        else '[]'::jsonb
      end) as b
  ),
  dedup as (
    select distinct on (guid, coalesce(bill_ref,'§'), coalesce(bill_type,''), amount_raw)
           guid, vch_date, bill_ref, bill_type, amount_raw, credit_period
    from allocs
  ),
  vbills as (
    select bill_ref,
           sum((-1)*amount_raw)                                                      as pending,
           max(vch_date) filter (where bill_type ilike 'New Ref%'
                                    or bill_type ilike 'Advance%')                   as origin_date,
           max(credit_period) filter (where bill_type ilike 'New Ref%')              as credit_period,
           sum(case when bill_type ilike 'New Ref%' or bill_type ilike 'Advance%'
                    then (-1)*amount_raw else 0 end)                                 as origin_amount
    from dedup
    where bill_ref is not null
    group by bill_ref
  ),
  obills as (
    select distinct on (bill_ref) bill_ref, pending, origin_date, credit_period
    from (
      select nullif(public.jtext(b->'NAME'),'')                 as bill_ref,
             (-1)*public.amt(public.jtext(b->'OPENINGBALANCE')) as pending,
             public.jtext(b->'BILLDATE')                        as origin_date,
             nullif(public.jtext(b->'BILLCREDITPERIOD'),'')     as credit_period
      from public.tally_object o
      cross join lateral jsonb_array_elements(
        case jsonb_typeof(o.raw_payload->'BILLALLOCATIONS.LIST')
          when 'array'  then o.raw_payload->'BILLALLOCATIONS.LIST'
          when 'object' then jsonb_build_array(o.raw_payload->'BILLALLOCATIONS.LIST')
          else '[]'::jsonb
        end) as b
      where o.object_type = 'Ledger' and not o.is_deleted
        and o.tenant_id = p_tenant and o.guid = p_ledger_guid
        and nullif(public.jtext(b->'NAME'),'') is not null
    ) ob
    order by bill_ref, pending, origin_date
  ),
  merged as (
    select bill_ref, pending, origin_date, credit_period, origin_amount from vbills
    union all
    select bill_ref, pending, origin_date, credit_period, pending from obills
  ),
  agg as materialized (
    select bill_ref,
           sum(pending)       as pending_amount,
           max(origin_date)   as bill_date,
           max(credit_period) as credit_period,
           sum(origin_amount) as bill_amount
    from merged
    group by bill_ref
  ),
  led as (
    select (-1)*public.amt(public.jtext(raw_payload->'CLOSINGBALANCE'))  as closing
    from public.tally_object
    where object_type = 'Ledger' and not is_deleted
      and tenant_id = p_tenant and guid = p_ledger_guid
    limit 1
  ),
  disp as materialized (
    select * from agg where abs(pending_amount) > 0.005
  ),
  tot as (
    select (select closing from led) - coalesce(sum(pending_amount), 0) as on_account
    from disp
  )
  select
    d.bill_ref,
    d.bill_date,
    d.bill_amount,
    d.pending_amount,
    d.credit_period,
    to_char(x.due_d, 'YYYYMMDD')                                                 as due_date,
    -- NOT greatest(0, p_as_on - x.due_d) on its own: GREATEST ignores NULLs, which would turn
    -- an unresolvable due date into a spurious 0. Guard the null explicitly.
    case when x.due_d is not null then greatest(0, p_as_on - x.due_d) end        as overdue_days
  from disp d
  cross join lateral (
    select case
             -- an explicit due date typed into Bill-wise Details ("5-May-26")
             when d.credit_period ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'
               then to_date(btrim(d.credit_period), 'DD-Mon-YY')
             -- a credit period in days ("45 Days", or a bare number); empty -> due on bill date
             when d.bill_date ~ '^[0-9]{8}$'
               then to_date(d.bill_date,'YYYYMMDD')
                  + coalesce(nullif(regexp_replace(coalesce(d.credit_period,''),'\D','','g'),'')::int, 0)
           end as due_d
  ) x
  union all
  select null::text, null::text, null::numeric, (select on_account from tot),
         null::text, null::text, null::int
  where abs((select on_account from tot)) > 0.005;
$function$;


-- ============================================================================================
-- STAGE 2 — the remaining three objects, applied after Stage 1 was signed off.
--
-- Same expression, two differences from Stage 1: these use `current_date` (no p_as_on
-- parameter), and the credit period falls back to the LEDGER MASTER value when the bill
-- itself carries none — `coalesce(d.credit_period, led.cp)`. The ledger master never holds a
-- date form (it holds "N Days", bare numbers, ADVANCE, IMMEDIATE), so the date branch simply
-- never fires on the fallback and those values keep taking the digit path exactly as before.
--
-- MEASURED IMPACT (dry run before applying, largest tenant, 679 bills / ₹18.95 cr pending):
--   overdue ₹4.05 cr -> ₹7.71 cr. 107 bills (₹4.01 cr) become overdue; 5 bills (₹34.77 L)
--   STOP being overdue. Pending total unchanged to the paisa.
--
-- ⚠️ The bug runs in BOTH directions, which is easy to miss:
--     "5-May-26" -> "526" -> +526 days -> due date pushed into the FUTURE -> overdue hidden.
--     "1-Jun-27" -> "127" -> +127 days -> due date lands in the PAST   -> overdue INVENTED.
--   Bill H/25-26/5 48 (GOPI KRISHNA … UNIT-2-MACHINE) showed 285 days overdue on a bill that
--   is not due until 01-Jun-27. So "overdue must only increase" is NOT a valid check.
--
-- ⚠️ Nor is "due_date must be within 400 days of bill_date" — that was only ever a PRE-fix
--   proxy for corruption. After the fix, genuinely long-dated instalment bills legitimately
--   exceed it (KALAHANSH MC/25-26/1-15 is due 569 days after its bill date, and Tally agrees).
--   The only correct post-fix check is the one below.
--
-- CORRECT VERIFICATION:
--   select count(*) filter (where credit_period ~ '^\s*[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}\s*$'
--                             and due_date <> to_char(to_date(btrim(credit_period),'DD-Mon-YY'),'YYYYMMDD')) as date_form_wrong,
--          count(*) filter (where credit_period ~* '^[0-9]+\s*days?$'
--                             and due_date is distinct from to_char(to_date(bill_date,'YYYYMMDD')
--                                 + nullif(regexp_replace(credit_period,'\D','','g'),'')::int,'YYYYMMDD')) as n_days_wrong
--   -- both must be 0. Use `is distinct from`, not `<>`: three orphan bills carry no bill date
--   -- at all, so both sides are NULL and `<>` silently drops them from the count.
--
-- AFTER APPLYING, rebuild the derived tables (each deletes+reinserts per tenant):
--   select public.rpt_receivables_rebuild('<tenant>');   -- per tenant; the largest takes ~95s
--   call   public.rpt_payables_refresh_nightly();        -- ~36s all tenants
--   call   public.rpt_sales_bill_refresh_nightly();
--   call   public.rpt_purchase_refresh_nightly();
--   select public.collection_refresh();                  -- carries statement_timeout=0 itself
-- A client that times out mid-CALL rolls the whole procedure back and logs nothing — drive the
-- long ones from pg_cron (a one-shot `cron.schedule` at a specific minute) rather than a client.
-- ============================================================================================

create or replace function public.bill_outstanding_by_id(p_tenant text, p_ledger_guid text)
returns table(
  bill_ref text, bill_date text, bill_amount numeric, pending_amount numeric,
  credit_period text, due_date text, overdue_days integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- This ledger's own lines, found by GUID. Hits the (tenant_id, ledger_guid, vch_date) index;
  -- no GIN containment probing, no dependence on either LEDGERNAME shape or on the name being
  -- current. Replaces the old `vch` + `lines` CTE pair wholesale.
  with mine as (
    select l.voucher_guid                          as guid,
           public.jtext(v.raw_payload->'DATE')     as vch_date,
           l.allocs
    from public.tally_voucher_line l
    join public.tally_object v
      on v.tenant_id    = l.tenant_id
     and v.guid         = l.voucher_guid
     and v.object_type  = 'Voucher'
     and not v.is_deleted
    where l.tenant_id   = p_tenant
      and l.ledger_guid = p_ledger_guid
      and not l.is_cancelled
      and not l.is_optional
  ),
  allocs as (
    select m.guid, m.vch_date,
           nullif(public.jtext(b->'NAME'),'')             as bill_ref,
           public.jtext(b->'BILLTYPE')                    as bill_type,
           public.amt(public.jtext(b->'AMOUNT'))          as amount_raw,
           nullif(public.jtext(b->'BILLCREDITPERIOD'),'') as credit_period
    from mine m
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(m.allocs)
        when 'array'  then m.allocs
        when 'object' then jsonb_build_array(m.allocs)
        else '[]'::jsonb
      end) as b
  ),
  dedup as (
    select distinct on (guid, coalesce(bill_ref,'§'), coalesce(bill_type,''), amount_raw)
           guid, vch_date, bill_ref, bill_type, amount_raw, credit_period
    from allocs
  ),
  vbills as (
    select bill_ref,
           sum((-1)*amount_raw)                                                      as pending,
           max(vch_date) filter (where bill_type ilike 'New Ref%')                   as origin_date,
           max(credit_period) filter (where bill_type ilike 'New Ref%')              as credit_period,
           sum(case when bill_type ilike 'New Ref%' then (-1)*amount_raw else 0 end) as origin_amount
    from dedup
    where bill_ref is not null
    group by bill_ref
  ),
  -- Opening bills off the Ledger master. Keyed on guid now (was name). Safe either way today --
  -- the master always holds the CURRENT name -- but keeps the whole function on one key.
  obills as (
    select distinct on (bill_ref) bill_ref, pending, origin_date, credit_period
    from (
      select nullif(public.jtext(b->'NAME'),'')                 as bill_ref,
             (-1)*public.amt(public.jtext(b->'OPENINGBALANCE')) as pending,
             public.jtext(b->'BILLDATE')                        as origin_date,
             nullif(public.jtext(b->'BILLCREDITPERIOD'),'')     as credit_period
      from public.tally_object o
      cross join lateral jsonb_array_elements(
        case jsonb_typeof(o.raw_payload->'BILLALLOCATIONS.LIST')
          when 'array'  then o.raw_payload->'BILLALLOCATIONS.LIST'
          when 'object' then jsonb_build_array(o.raw_payload->'BILLALLOCATIONS.LIST')
          else '[]'::jsonb
        end) as b
      where o.object_type = 'Ledger' and not o.is_deleted
        and o.tenant_id = p_tenant and o.guid = p_ledger_guid
        and nullif(public.jtext(b->'NAME'),'') is not null
    ) ob
    order by bill_ref, pending, origin_date
  ),
  merged as (
    select bill_ref, pending, origin_date, credit_period, origin_amount from vbills
    union all
    select bill_ref, pending, origin_date, credit_period, pending from obills
  ),
  agg as materialized (
    select bill_ref,
           sum(pending)       as pending_amount,
           max(origin_date)   as bill_date,
           max(credit_period) as credit_period,
           sum(origin_amount) as bill_amount
    from merged
    group by bill_ref
  ),
  -- Closing balance anchor, by guid. object_type='Ledger' is MANDATORY (guid collisions).
  led as (
    select (-1)*public.amt(public.jtext(raw_payload->'CLOSINGBALANCE'))  as closing,
           nullif(public.jtext(raw_payload->'BILLCREDITPERIOD'),'')      as cp
    from public.tally_object
    where object_type = 'Ledger' and not is_deleted
      and tenant_id = p_tenant and guid = p_ledger_guid
    limit 1
  ),
  disp as materialized (
    select * from agg where abs(pending_amount) > 0.005
  ),
  tot as (
    select (select closing from led) - coalesce(sum(pending_amount), 0) as on_account
    from disp
  )
  select
    d.bill_ref,
    d.bill_date,
    d.bill_amount,
    d.pending_amount,
    c.cp                                                                         as credit_period,
    to_char(x.due_d, 'YYYYMMDD')                                                 as due_date,
    -- NOT greatest(0, current_date - x.due_d) alone: GREATEST ignores NULLs, so an unresolvable
    -- due date would report a spurious 0 instead of blank. Guard the null explicitly.
    case when x.due_d is not null then greatest(0, current_date - x.due_d) end   as overdue_days
  from disp d
  cross join lateral (select coalesce(d.credit_period, (select cp from led)) as cp) c
  cross join lateral (
    select case
             -- BILLCREDITPERIOD holding an explicit due date typed into Bill-wise Details
             when c.cp ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'
               then to_date(btrim(c.cp), 'DD-Mon-YY')
             -- a credit period in days ("45 Days" / bare number); empty -> due on the bill date
             when d.bill_date ~ '^[0-9]{8}$'
               then to_date(d.bill_date,'YYYYMMDD')
                  + coalesce(nullif(regexp_replace(coalesce(c.cp,''),'\D','','g'),'')::int, 0)
           end as due_d
  ) x
  union all
  select null::text, null::text, null::numeric, (select on_account from tot),
         null::text, null::text, null::int
  where abs((select on_account from tot)) > 0.005;
$function$;


-- The by-NAME twin. Identical final SELECT; differs only in how it finds the ledger's lines.
create or replace function public.bill_outstanding(p_tenant text, p_ledger text)
returns table(
  bill_ref text, bill_date text, bill_amount numeric, pending_amount numeric,
  credit_period text, due_date text, overdue_days integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with vch as (
    select o.guid, public.jtext(o.raw_payload->'DATE') as vch_date, o.raw_payload
    from public.tally_object o
    where o.object_type = 'Voucher' and not o.is_deleted and o.tenant_id = p_tenant
      -- ISCANCELLED / ISOPTIONAL arrive as a BARE STRING ("Yes"/"No"), not {"#text":...}
      and coalesce(public.jtext(o.raw_payload->'ISCANCELLED'),'No') = 'No'
      and coalesce(public.jtext(o.raw_payload->'ISOPTIONAL'), 'No') = 'No'
      and (
        o.raw_payload @> jsonb_build_object('ALLLEDGERENTRIES.LIST', jsonb_build_array(jsonb_build_object('LEDGERNAME', to_jsonb(p_ledger))))
        or o.raw_payload @> jsonb_build_object('ALLLEDGERENTRIES.LIST', jsonb_build_array(jsonb_build_object('LEDGERNAME', jsonb_build_object('#text', p_ledger))))
        or o.raw_payload @> jsonb_build_object('LEDGERENTRIES.LIST',    jsonb_build_array(jsonb_build_object('LEDGERNAME', to_jsonb(p_ledger))))
        or o.raw_payload @> jsonb_build_object('LEDGERENTRIES.LIST',    jsonb_build_array(jsonb_build_object('LEDGERNAME', jsonb_build_object('#text', p_ledger))))
      )
  ),
  lines as (
    select v.guid, v.vch_date, e
    from vch v
    cross join lateral (values ('ALLLEDGERENTRIES.LIST'),('LEDGERENTRIES.LIST')) as k(listkey)
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(v.raw_payload->k.listkey)
        when 'array'  then v.raw_payload->k.listkey
        when 'object' then jsonb_build_array(v.raw_payload->k.listkey)
        else '[]'::jsonb
      end) as e
    where public.jtext(e->'LEDGERNAME') = p_ledger
  ),
  allocs as (
    select l.guid, l.vch_date,
           nullif(public.jtext(b->'NAME'),'')             as bill_ref,
           public.jtext(b->'BILLTYPE')                    as bill_type,
           public.amt(public.jtext(b->'AMOUNT'))          as amount_raw,
           nullif(public.jtext(b->'BILLCREDITPERIOD'),'') as credit_period
    from lines l
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(l.e->'BILLALLOCATIONS.LIST')
        when 'array'  then l.e->'BILLALLOCATIONS.LIST'
        when 'object' then jsonb_build_array(l.e->'BILLALLOCATIONS.LIST')
        else '[]'::jsonb
      end) as b
  ),
  dedup as (
    select distinct on (guid, coalesce(bill_ref,'§'), coalesce(bill_type,''), amount_raw)
           guid, vch_date, bill_ref, bill_type, amount_raw, credit_period
    from allocs
  ),
  vbills as (
    select bill_ref,
           sum((-1)*amount_raw)                                                         as pending,
           max(vch_date) filter (where bill_type ilike 'New Ref%')                      as origin_date,
           max(credit_period) filter (where bill_type ilike 'New Ref%')                 as credit_period,
           sum(case when bill_type ilike 'New Ref%' then (-1)*amount_raw else 0 end)    as origin_amount
    from dedup
    where bill_ref is not null
    group by bill_ref
  ),
  obills as (
    select distinct on (bill_ref) bill_ref, pending, origin_date, credit_period
    from (
      select nullif(public.jtext(b->'NAME'),'')                 as bill_ref,
             (-1)*public.amt(public.jtext(b->'OPENINGBALANCE')) as pending,
             public.jtext(b->'BILLDATE')                        as origin_date,
             nullif(public.jtext(b->'BILLCREDITPERIOD'),'')     as credit_period
      from public.tally_object o
      cross join lateral jsonb_array_elements(
        case jsonb_typeof(o.raw_payload->'BILLALLOCATIONS.LIST')
          when 'array'  then o.raw_payload->'BILLALLOCATIONS.LIST'
          when 'object' then jsonb_build_array(o.raw_payload->'BILLALLOCATIONS.LIST')
          else '[]'::jsonb
        end) as b
      where o.object_type = 'Ledger' and not o.is_deleted
        and o.tenant_id = p_tenant and o.name = p_ledger
        and nullif(public.jtext(b->'NAME'),'') is not null
    ) ob
    order by bill_ref, pending, origin_date
  ),
  merged as (
    select bill_ref, pending, origin_date, credit_period, origin_amount from vbills
    union all
    select bill_ref, pending, origin_date, credit_period, pending from obills
  ),
  agg as materialized (
    select bill_ref,
           sum(pending)       as pending_amount,
           max(origin_date)   as bill_date,
           max(credit_period) as credit_period,
           sum(origin_amount) as bill_amount
    from merged
    group by bill_ref
  ),
  led as (
    select (-1)*public.amt(public.jtext(raw_payload->'CLOSINGBALANCE'))  as closing,
           nullif(public.jtext(raw_payload->'BILLCREDITPERIOD'),'')      as cp
    from public.tally_object
    where object_type = 'Ledger' and not is_deleted and tenant_id = p_tenant and name = p_ledger
    limit 1
  ),
  disp as materialized (
    select * from agg where abs(pending_amount) > 0.005
  ),
  tot as (
    select (select closing from led) - coalesce(sum(pending_amount), 0) as on_account
    from disp
  )
  select
    d.bill_ref,
    d.bill_date,
    d.bill_amount,
    d.pending_amount,
    c.cp                                                                         as credit_period,
    to_char(x.due_d, 'YYYYMMDD')                                                 as due_date,
    case when x.due_d is not null then greatest(0, current_date - x.due_d) end   as overdue_days
  from disp d
  cross join lateral (select coalesce(d.credit_period, (select cp from led)) as cp) c
  cross join lateral (
    select case
             when c.cp ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'
               then to_date(btrim(c.cp), 'DD-Mon-YY')
             when d.bill_date ~ '^[0-9]{8}$'
               then to_date(d.bill_date,'YYYYMMDD')
                  + coalesce(nullif(regexp_replace(coalesce(c.cp,''),'\D','','g'),'')::int, 0)
           end as due_d
  ) x
  union all
  select null::text, null::text, null::numeric, (select on_account from tot),
         null::text, null::text, null::int
  where abs((select on_account from tot)) > 0.005;
$function$;


-- SQL-level duplicate of bill_outstanding. Has no dependents in the database and is not read by
-- the frontend, but it is fixed rather than dropped so it can never become a second source of
-- truth that disagrees with the functions (Supabase changes here are additive-only).
create or replace view public.v_bill_outstanding as
  with contrib as (
    select a.tenant_id, a.ledger, a.bill_ref,
           (-1)::numeric * a.amount_raw                                              as pending,
           case when a.bill_type ilike 'New Ref%' then a.vch_date end                as origin_date,
           case when a.bill_type ilike 'New Ref%' then a.credit_period end           as credit_period,
           case when a.bill_type ilike 'New Ref%' then (-1)::numeric * a.amount_raw
                else 0::numeric end                                                  as origin_amount
    from public.v_bill_alloc a
    where a.bill_ref is not null
    union all
    select o.tenant_id, o.ledger, o.bill_ref, o.pending, o.bill_date, o.credit_period, o.pending
    from public.v_bill_opening o
    where o.bill_ref is not null
  ),
  agg as (
    select tenant_id, ledger, bill_ref,
           sum(pending)       as pending_amount,
           max(origin_date)   as bill_date,
           max(credit_period) as credit_period,
           sum(origin_amount) as bill_amount
    from contrib
    group by tenant_id, ledger, bill_ref
  ),
  ledcp as (
    select tenant_id, name as ledger,
           nullif(public.jtext(raw_payload->'BILLCREDITPERIOD'),'') as credit_period
    from public.tally_object
    where object_type = 'Ledger' and not is_deleted
  ),
  final as (
    select a.tenant_id, a.ledger, a.bill_ref, a.bill_date, a.bill_amount, a.pending_amount,
           coalesce(a.credit_period, l.credit_period) as credit_period
    from agg a
    left join ledcp l on l.tenant_id = a.tenant_id and l.ledger = a.ledger
  )
  select f.tenant_id, f.ledger, f.bill_ref, f.bill_date, f.bill_amount, f.pending_amount,
         f.credit_period,
         to_char(x.due_d, 'YYYYMMDD')                                                 as due_date,
         case when x.due_d is not null then greatest(0, current_date - x.due_d) end   as overdue_days
  from final f
  cross join lateral (
    select case
             when f.credit_period ~ '^\s*\d{1,2}-[A-Za-z]{3}-\d{2}\s*$'
               then to_date(btrim(f.credit_period), 'DD-Mon-YY')
             when f.bill_date ~ '^[0-9]{8}$'
               then to_date(f.bill_date,'YYYYMMDD')
                  + coalesce(nullif(regexp_replace(coalesce(f.credit_period,''),'\D','','g'),'')::int, 0)
           end as due_d
  ) x
  where abs(f.pending_amount) > 0.005;
