-- A gate pass per invoice, numbered by the database instead of by a paper pad.
--
-- The pass leaving the plant is a pre-printed leaf: someone writes the date, the
-- customer and the invoice number by hand and ticks MACHINE / SPARE PARTS /
-- HEAD / INK / OTHER. Its serial is whatever was printed on the leaf, so nothing
-- ties the slip in the security guard's hand to the order that actually left.
--
-- Every fact on that slip is already here. What was missing was the number.
--
-- ⚠ THE NUMBER BELONGS TO THE INVOICE, NOT TO THE PRINTER. One pass per invoice
--   is the rule, so it is allocated when the sales bill is recorded. Printing is
--   then a pure read: press it ten times, get one number ten times. A pass that
--   is never printed still consumes its number, because the invoice exists.
--
--     OTEC-2608-001   Orange O Tec Pvt Ltd
--     ENT-2608-001    Orange O Tec Enterprise pvt Ltd
--
--   2608 is YYMM. The month lives INSIDE the counter's scope key, so the restart
--   every month falls out for free -- September is simply a scope that does not
--   exist yet, and `fms_dispatch_next_seq` starts it at 1. There is no reset job
--   to run and no counter for an admin to remember to roll over.
--
-- Nothing to backfill: no invoice had ever been recorded when this shipped
-- (`sb_invoice_no` null on every order, zero archived rounds), so the series
-- genuinely starts at 001.

begin;

/* -------------------------------------------------- the prefix is DATA ----- */

-- Deriving the prefix from the company NAME in code would break the first time
-- somebody renames a company or adds a third one. It is an attribute of the
-- company, so it lives on the company.
alter table public.fms_dispatch_companies
  add column if not exists gate_pass_prefix text;

comment on column public.fms_dispatch_companies.gate_pass_prefix is
  'Gate pass series prefix, e.g. OTEC / ENT. Null falls back to GP. Case-insensitively unique.';

-- Two companies sharing a prefix would silently share one counter, interleaving
-- their series. Normalised because 'otec' and 'OTEC' would otherwise be two
-- different scopes -- one company, two independent series, both starting at 001.
create unique index if not exists fms_dispatch_companies_gp_prefix_uk
  on public.fms_dispatch_companies (upper(trim(gate_pass_prefix)))
  where gate_pass_prefix is not null;

-- Enterprise first: it also matches the OTEC pattern, so the narrower rule has
-- to claim its row before the broader one runs.
update public.fms_dispatch_companies
   set gate_pass_prefix = 'ENT'
 where gate_pass_prefix is null and name ilike '%enterprise%';

update public.fms_dispatch_companies
   set gate_pass_prefix = 'OTEC'
 where gate_pass_prefix is null and name ilike '%orange%tec%';

/* ------------------------------------------------------- the number itself -- */

-- Live round on the header, finished rounds in the archive: the same split every
-- cc_* and sb_* field uses.
alter table public.fms_dispatch_orders add column if not exists gp_no text;
alter table public.fms_dispatch_rounds add column if not exists gp_no text;

comment on column public.fms_dispatch_orders.gp_no is
  'Gate pass number for the round in progress. Allocated with the sales bill, cleared when the round is archived.';
comment on column public.fms_dispatch_rounds.gp_no is
  'The gate pass number issued for THIS round''s invoice.';

-- A double allocation must fail loudly rather than put two consignments on one
-- number, which is precisely the failure the paper pad already has.
create unique index if not exists fms_dispatch_orders_gp_no_uk
  on public.fms_dispatch_orders (gp_no) where gp_no is not null;
create unique index if not exists fms_dispatch_rounds_gp_no_uk
  on public.fms_dispatch_rounds (gp_no) where gp_no is not null;

/**
 * Allocate the next gate pass number for a company, in the month of `p_on`.
 *
 * ⚠ NOT IDEMPOTENT -- it burns a number every call. Only ever call it behind an
 *   `is null` guard, or the same invoice ends up with two passes.
 *
 * The 'GP' fallback is deliberate: a company added later with no prefix set must
 * not make recording a sales bill fail. A missing prefix is an admin's tidying
 * job, not a reason to block the billing clerk.
 */
create or replace function public.fms_dispatch_gate_pass_no(p_company uuid, p_on date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_month  text := to_char(p_on, 'YYMM');
begin
  select upper(trim(coalesce(c.gate_pass_prefix, 'GP')))
    into v_prefix
    from public.fms_dispatch_companies c
   where c.id = p_company;

  v_prefix := coalesce(nullif(v_prefix, ''), 'GP');

  -- The month is part of the SCOPE, not just of the label: that is what makes
  -- the counter restart at 001 in September without anyone resetting anything.
  -- lpad pads and never truncates, so a month past 999 grows to four digits
  -- rather than colliding.
  return v_prefix || '-' || v_month || '-' ||
         lpad(public.fms_dispatch_next_seq('gatepass:' || v_prefix || ':' || v_month)::text, 3, '0');
end $$;

comment on function public.fms_dispatch_gate_pass_no(uuid, date) is
  'Allocate the next gate pass number (PREFIX-YYMM-NNN) for a company. Burns a number on every call.';
grant execute on function public.fms_dispatch_gate_pass_no(uuid, date) to authenticated;

/* ------------------------------------------- allocate it with the invoice --- */

-- Rewritten from its live body (20260801120100:686 as patched since). The only
-- changes: company_id + gp_no join the SELECT, the invoice date is resolved into
-- a variable BEFORE the update, and gp_no is allocated from that variable.
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_no      text;
  v_round   integer;
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_gp      text;
  v_date    date;
begin
  select status, order_no, round_no, company_id, gp_no
    into v_status, v_no, v_round, v_company, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The Tally invoice number is required'; end if;
  if coalesce(trim(p->>'sb_attachment_path'), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;

  -- Resolved here rather than read back out of the row: the number's month has
  -- to match the date this same statement is about to write, and depending on
  -- when a column becomes visible mid-update is how that quietly goes wrong.
  v_date := coalesce(nullif(p->>'sb_actual_date','')::date, current_date);

  -- `is null` guarded because the allocator burns a number on every call. In
  -- practice the status check above already makes a second pass impossible, but
  -- the guard is what makes that a belt AND braces rather than a coincidence.
  if v_gp is null then
    v_gp := public.fms_dispatch_gate_pass_no(v_company, v_date);
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = v_date,
    sb_invoice_no      = trim(p->>'sb_invoice_no'),
    sb_attachment_path = nullif(p->>'sb_attachment_path',''),
    sb_attachment_name = nullif(p->>'sb_attachment_name',''),
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    sb_at = coalesce(sb_at, now()), sb_by = coalesce(sb_by, v_uid),
    gp_no = coalesce(gp_no, v_gp),
    status = 'awaiting_gate_out', current_step = 'gate_out'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'billed',
    'Sales bill ' || trim(p->>'sb_invoice_no') || ' raised for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting the gate outward entry. Gate pass ' || v_gp || '.',
    public.fms_dispatch_step_owner_ids('gate_out'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round,
                       'invoice_no', trim(p->>'sb_invoice_no'), 'gate_pass_no', v_gp)
  );
end $$;

/* ---------------------------------------------- carry it into the archive --- */

-- Rewritten from its live body. The only changes: gp_no added to the insert
-- column list AND the select list at the matching position, and to the wipe.
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    gp_no,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id, o.location_id,
    -- ONLY the decision this round actually made. When credit approved enough to
    -- cover several rounds, the later ones inherit that decision and must archive
    -- NOTHING - otherwise one decision appears once per round it happened to
    -- cover, in the Completed tab and in the register.
    case when o.cc_round_no = o.round_no then o.cc_status       else null end,
    case when o.cc_round_no = o.round_no then o.cc_approved_qty else null end,
    case when o.cc_round_no = o.round_no then o.cc_remarks      else null end,
    case when o.cc_round_no = o.round_no then o.cc_at           else null end,
    case when o.cc_round_no = o.round_no then o.cc_by           else null end,
    o.ms_actual_date, o.ms_tempo_no, o.ms_porter, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name, o.sb_remarks, o.sb_at, o.sb_by,
    -- Travels with the sb_ block, because it was issued for that invoice.
    o.gp_no,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.fms_dispatch_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and the row-level security predicate all read them.
  --   The archive keeps its own copies above, which is what makes a historic
  --   round self-describing.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
  --
  -- ⚠ gp_no IS PRESENT, which is the opposite of the two fields above and easy to
  --   get wrong by proximity. A new round raises a NEW invoice, and one pass per
  --   invoice is the whole rule - carrying the old number forward would put two
  --   consignments on one pass.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_remarks = null, sb_at = null, sb_by = null,
    gp_no = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $$;

/* -------------------------------------------------------------- assertions -- */

do $$
declare v_src text;
begin
  -- fms_dispatch_update_sales_bill is deliberately NOT touched by this migration:
  -- correcting a Tally typo is the same invoice, so it must be the same pass.
  -- Assert that, because "just also update gp_no here" is an obvious-looking edit
  -- that would renumber a pass already in a security guard's hand.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_sales_bill';

  if v_src is null then
    raise exception 'fms_dispatch_update_sales_bill is missing';
  end if;
  if v_src ~* 'gp_no' then
    raise exception 'fms_dispatch_update_sales_bill now writes gp_no - editing an invoice must NOT renumber its gate pass';
  end if;

  -- The two seeded prefixes, which the whole series depends on.
  if (select count(*) from public.fms_dispatch_companies where gate_pass_prefix is not null) < 2 then
    raise exception 'expected both existing companies to carry a gate pass prefix';
  end if;
end $$;

commit;
