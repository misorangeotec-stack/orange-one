-- The gate outward number IS the gate pass number, and the series is per SITE.
--
-- TWO PROBLEMS, ONE CAUSE.
--
-- 1. `go_outward_no` was a required free-text box. Nothing generated it -- the RPC
--    stored verbatim whatever was typed ("The number is TYPED from the paper
--    register", 20260810120100:692). But the gate-out step's context panel has
--    shown "Gate pass no. ENT-2608-238" directly above that box since
--    20260822120000, so Surat simply copied it across by hand. Measured the day
--    this was written: of 401 Surat gate entries, 193 were exactly the gate pass,
--    183 were the gate pass with clipboard debris glued on -- 'Sr. No.: OTEC-2608-206',
--    ': ENT-2608-218', '.: ENT-2608-202' -- and 25 were something else. Noida never
--    copied it at all: all 38 of its entries read '123', 'PORTER', 'BY VEHICLE',
--    'BY BUS'. They are one number written twice, and the second copy was wrong
--    half the time.
--
--    So it stops being asked for. The gate outward number is now DERIVED from the
--    gate pass, server-side, and the client cannot set it.
--
-- 2. The gate pass series was keyed on the COMPANY alone, so Surat and Noida drew
--    from one pot and their numbers interleaved. The suffix below splits them:
--
--      OTEC-2608-001     Orange O Tec Pvt Ltd, Surat
--      OTEC-N-2608-001   Orange O Tec Pvt Ltd, Noida
--      ENT-2608-001      Orange O Tec Enterprise pvt Ltd, Surat
--      ENT-N-2608-001    Orange O Tec Enterprise pvt Ltd, Noida
--
--    Noida starting at 001 needs no seeding: 'gatepass:OTEC-N:2608' is simply a
--    scope that does not exist yet, and fms_dispatch_next_seq starts a new scope
--    at 1. It is the same mechanism that already restarts the counter each month.
--
-- ⚠ NOTHING ALREADY ISSUED IS RENUMBERED. Passes printed under the shared series
--   keep their numbers, and the ARCHIVE (fms_dispatch_rounds) is not touched at
--   all -- history stays as it was recorded. Only the still-open rounds on the
--   order header are corrected, at the bottom of this file.

begin;

/* ------------------------------------------------ the suffix is DATA, on the site -- */

-- ⚠ ON THE SITE, NOT ON THE (company, site) PAIR. mst_locations is the GLOBAL
--   site master -- three rows, company_id null, wired to companies through
--   mst_company_locations. That is the right grain: Noida is one physical place
--   whichever of the two firms is billing, and its gate register is one book.
alter table public.mst_locations add column if not exists gate_pass_suffix text;

comment on column public.mst_locations.gate_pass_suffix is
  'Gate pass series suffix for this site, e.g. N for Noida. Null = no suffix (the main series).';

-- Two sites sharing a suffix would silently share one counter -- which is the
-- exact problem this migration exists to fix. Same shape as the prefix rule in
-- 20260822120000: normalised, because 'n' and 'N' would otherwise be two scopes.
create unique index if not exists mst_locations_gp_suffix_uk
  on public.mst_locations (upper(trim(gate_pass_suffix)))
  where gate_pass_suffix is not null;

-- ⚠ A HYPHEN INSIDE A SUFFIX (OR A PREFIX) WOULD LET TWO DIFFERENT (company, site)
--   PAIRS COMPOSE TO ONE SCOPE KEY: prefix 'OTEC-N' with no suffix collides with
--   prefix 'OTEC' plus suffix 'N', and the two would quietly share a counter --
--   reintroducing the interleaving this file removes. Letters and digits only.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mst_locations_gp_suffix_chk') then
    alter table public.mst_locations
      add constraint mst_locations_gp_suffix_chk
      check (gate_pass_suffix is null or gate_pass_suffix ~ '^[A-Za-z0-9]+$');
  end if;
end $$;

update public.mst_locations set gate_pass_suffix = 'N' where name = 'NOIDA';

-- SURAT-HOJIWALA and SURAT-SACHIN deliberately stay null. Sachin has no orders
-- yet and shares the main Surat series until an admin gives it a suffix in the
-- Dispatch Locations master; a null suffix means "the main series", not "unset".

/* --------------------------------------------- the allocator learns the site -- */

-- fms_dispatch_record_sales_bill is the ONLY caller (verified against pg_proc),
-- so the signature can change outright. Dropping the 2-arg form rather than
-- leaving it beside the new one is the point: two allocators reachable from the
-- same schema is how the location silently stops being applied.
drop function if exists public.fms_dispatch_gate_pass_no(uuid, date);

create or replace function public.fms_dispatch_gate_pass_no(
  p_company uuid, p_location uuid, p_on date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_suffix text;
  v_series text;
  v_month  text := to_char(p_on, 'YYMM');
begin
  select upper(trim(coalesce(c.gate_pass_prefix, 'GP')))
    into v_prefix
    from public.mst_companies c
   where c.id = p_company;

  v_prefix := coalesce(nullif(v_prefix, ''), 'GP');

  -- ⚠ A NULL p_location MUST YIELD THE MAIN SERIES, NOT AN ERROR.
  --   fms_dispatch_orders.location_id is nullable (no null rows today, but the
  --   column permits them), and refusing to number a bill because a site was
  --   never chosen would stop the billing clerk over an admin's tidying job --
  --   the same reasoning as the 'GP' prefix fallback above.
  select upper(trim(l.gate_pass_suffix))
    into v_suffix
    from public.mst_locations l
   where l.id = p_location;

  v_series := v_prefix || coalesce('-' || nullif(v_suffix, ''), '');

  -- The month AND the site both live inside the counter's scope key, so the
  -- monthly restart and the per-site split both fall out for free. lpad pads and
  -- never truncates, so a site past 999 in one month grows to four digits rather
  -- than colliding.
  return v_series || '-' || v_month || '-' ||
         lpad(public.fms_dispatch_next_seq('gatepass:' || v_series || ':' || v_month)::text, 3, '0');
end $$;

comment on function public.fms_dispatch_gate_pass_no(uuid, uuid, date) is
  'Allocate the next gate pass number (PREFIX[-SUFFIX]-YYMM-NNN) for a company at a site. Burns a number on every call.';
grant execute on function public.fms_dispatch_gate_pass_no(uuid, uuid, date) to authenticated;


/* ------------------------------------ the sales bill passes the site along -- */

-- Rewritten from its LIVE body (pg_get_functiondef, not the migration files --
-- it has been patched repeatedly since 20260822120000 and now reads
-- mst_companies rather than fms_dispatch_companies). Two changes only:
-- location_id joins the SELECT, and it is handed to the allocator.
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_no       text;
  v_round    integer;
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_location uuid;
  v_gp       text;
  v_date     date;
begin
  select status, order_no, round_no, company_id, location_id, gp_no
    into v_status, v_no, v_round, v_company, v_location, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The Tally invoice number is required'; end if;
  if coalesce(trim(p->>'sb_attachment_path'), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;
  -- ⚠ THERE IS NO EQUIVALENT CHECK FOR THE E-WAY BILL, and adding one would stop
  --   every below-threshold consignment at the billing desk.

  -- Resolved here rather than read back out of the row: the number's month has
  -- to match the date this same statement is about to write, and depending on
  -- when a column becomes visible mid-update is how that quietly goes wrong.
  v_date := coalesce(nullif(p->>'sb_actual_date','')::date, current_date);

  -- `is null` guarded because the allocator burns a number on every call. In
  -- practice the status check above already makes a second pass impossible, but
  -- the guard is what makes that a belt AND braces rather than a coincidence.
  if v_gp is null then
    v_gp := public.fms_dispatch_gate_pass_no(v_company, v_location, v_date);
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = v_date,
    sb_invoice_no      = trim(p->>'sb_invoice_no'),
    sb_attachment_path = nullif(p->>'sb_attachment_path',''),
    sb_attachment_name = nullif(p->>'sb_attachment_name',''),
    sb_eway_path       = nullif(p->>'sb_eway_path',''),
    sb_eway_name       = nullif(p->>'sb_eway_name',''),
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
grant execute on function public.fms_dispatch_record_sales_bill(uuid, jsonb) to authenticated;

/* ------------------------- STEP 5 -- THE NUMBER IS DERIVED, NOT TYPED ------- */

-- ⚠ `p->>'go_outward_no'` IS NO LONGER READ, AND MUST NOT BE READ AGAIN. The
--   gate outward number IS the gate pass number; accepting a client value would
--   let the screen and the slip in the security guard's hand disagree, which is
--   the whole failure this migration removes. The payload key is ignored even
--   if an old build, a replayed request or a hand-made call still sends it.
--   The assertion block at the foot of this file enforces that.
create or replace function public.fms_dispatch_record_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid(); v_gp text;
begin
  select status, order_no, round_no, gp_no into v_status, v_no, v_round, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_gate_out' then raise exception 'This order is not awaiting the gate outward entry (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to record the gate outward entry'; end if;
  -- Unreachable in practice -- status 'awaiting_gate_out' is only ever set by
  -- record_sales_bill, which allocates gp_no in the same statement. Loud rather
  -- than silent, for the same reason the `is null` guard above is belt AND braces.
  if v_gp is null then
    raise exception 'This order has no gate pass number - the sales bill must be recorded first';
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, current_date),
    go_outward_no  = v_gp,
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    go_at = coalesce(go_at, now()), go_by = coalesce(go_by, v_uid),
    status = 'awaiting_dispatch_confirm', current_step = 'dispatch_confirm'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'gate_out',
    'Gate outward ' || v_gp || ' recorded for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting delivery confirmation.',
    public.fms_dispatch_step_owner_ids('dispatch_confirm'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'outward_no', v_gp)
  );
end $$;
grant execute on function public.fms_dispatch_record_gate_out(uuid, jsonb) to authenticated;

-- ⚠ THE NUMBER IS GONE FROM THE EDIT PATH ENTIRELY -- both the "is required"
--   guard and the assignment. The date and the remark stay editable; the number
--   is not something anyone edits any more, because changing it here would
--   desync the row from the pass already printed and handed over.
create or replace function public.fms_dispatch_update_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to edit the gate outward entry'; end if;
  if not public.fms_dispatch_go_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its gate outward entry can no longer be changed.'; end if;
    raise exception 'The gate outward entry can no longer be edited: the delivery has already been confirmed (status %).', v_status;
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, go_actual_date),
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'gate_out_edited',
    format('Gate outward entry on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_gate_out(uuid, jsonb) to authenticated;

/* ------------------------------------------- repair the OPEN rounds only ---- */

-- ⚠ THE ORDER HEADER ONLY. fms_dispatch_rounds -- the archive -- is deliberately
--   left alone: those rounds are finished, their passes were printed under the
--   numbers recorded, and rewriting them would edit history to match a rule that
--   did not exist when they were dispatched. 439 archived entries keep whatever
--   was typed, junk included.
--
-- The live rows are a different case: they are still in flight, still visible in
-- the Gate Outward queue and the register, and their gate pass IS the number
-- they should be carrying. Every one of them has a gp_no (status
-- 'awaiting_dispatch_confirm' guarantees it) and, when this was written, every
-- one had a null go_remarks -- so there was nothing to preserve. Written as a
-- plain corrective update rather than a coalesce so it is idempotent: re-running
-- it matches nothing.
update public.fms_dispatch_orders
   set go_outward_no = gp_no
 where go_outward_no is not null
   and gp_no is not null
   and go_outward_no is distinct from gp_no;

/* ---------------------------------------------------- hold the line -------- */

-- The pattern from 20260822120000, which asserts update_sales_bill never writes
-- gp_no. "Let the user correct the gate outward number" is an obvious-looking
-- edit that silently undoes this entire migration, so it fails the deploy
-- instead of shipping.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_gate_out';
  if v_src ~* 'go_outward_no' then
    raise exception 'fms_dispatch_update_gate_out mentions go_outward_no - editing a gate entry must NOT change its number';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_record_gate_out';
  if v_src ~* 'go_outward_no''' then
    raise exception 'fms_dispatch_record_gate_out reads go_outward_no from the payload - the number must be derived from gp_no';
  end if;
end $$;

commit;
