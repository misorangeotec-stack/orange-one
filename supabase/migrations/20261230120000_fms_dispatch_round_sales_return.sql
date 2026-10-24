-- ===========================================================================
-- Order to Dispatch — a SALES RETURN AGAINST AN INVOICE THAT HAS ALREADY GONE OUT.
--
-- WHY
--   The Sales Return step (20260827120000) only ever opened one way: cancelling
--   an order whose bill was raised while the goods were STILL IN THE PLANT.
--   Everything past the gate was refused, so an invoice already on its way to
--   the customer, or delivered on a closed order — then sent back, short, or
--   billed at the wrong rate — had no route to Sales Return at all. The credit
--   note was raised in Tally with no record here, and nobody owned chasing it.
--
-- WHAT CHANGES
--   1. New table `fms_dispatch_round_returns`: one sales return against ONE
--      round's invoice. Round-scoped, because an order with three partial
--      dispatches has three invoices and the customer may return any of them.
--
--   2. EVERY INVOICE THAT HAS LEFT THE GATE QUALIFIES — the round in progress
--      (out of the gate, delivery not yet confirmed) as much as an archived one
--      on a closed order. That is why a return is keyed on (order_id, round_no),
--      which is unique across the live round and the archive (verified on live
--      30-09-2026), and NOT on fms_dispatch_rounds.id: the live round has no
--      archive row yet. `round_id` is filled in when the round is archived.
--
--      An invoice still IN THE PLANT is refused, with a pointer to Cancel order —
--      that route already reaches Sales Return and cancels the order with it.
--      Two routes to the same invoice would unwind it twice.
--
--   3. Two ways a row opens:
--        'requested'            — someone raises it by hand (the raiser, a
--                                 Sales Return owner, a coordinator or an
--                                 admin), with a reason and full / partial.
--                                 A PARTIAL return names the items and how much
--                                 of each comes back, capped at what the invoice
--                                 billed — the Sales Return owner needs exactly
--                                 that to punch the credit note.
--        'returned_consignment' — a round is recorded (or corrected) as
--                                 RETURNED at Dispatch Confirmation. The goods
--                                 came back, so the invoice they travelled on
--                                 has to be unwound; until now that silently
--                                 fell through. Opened by a trigger, so both
--                                 record_dispatch_confirm and amend_round are
--                                 covered without restating either.
--
--   4. The Sales Return owners record it exactly as they record the
--      cancellation kind: 'invoice_cancelled' or 'sales_return' (credit note
--      number + document mandatory). Same two outcomes, same judgement left to
--      the person — THERE IS STILL NO 24-HOUR RULE ANYWHERE.
--
-- ⚠ PAPERWORK ONLY. Recording one of these does NOT move the order: a closed
--   order stays closed, an order awaiting delivery confirmation still awaits it,
--   delivered quantities are not recalculated, nothing reopens. Whether goods
--   have to go out again is a separate decision with its own route — record or
--   correct the round as Returned, which reopens the balance and, through the
--   trigger below, attaches to the return already raised instead of opening a
--   second one.
--
-- ⚠ THE ORDER-LEVEL CANCELLATION FLOW IS UNTOUCHED. The sr_ columns on
--   fms_dispatch_orders, cancel_order, record_sales_return and withdraw keep
--   working exactly as before; the queue simply lists both kinds.
--
-- DEPLOY ORDER: either way round is safe. An old frontend never reads the new
--   table, so rows opened by the trigger just wait for the new screens.
--
-- ADDITIVE ONLY: one table, one trigger, new functions, and an arm injected
--   into the LIVE mail body (section 7) rather than a restated copy of it.
--   Safe to re-run.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_dispatch_round_returns (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.fms_dispatch_orders(id) on delete cascade,
  round_no        integer not null,
  -- Null while the round is still in progress; set when it is archived.
  round_id        uuid references public.fms_dispatch_rounds(id) on delete set null,

  -- Snapshot of the invoice at the moment the return opened, so a later
  -- correction to the round cannot change which bill this was about.
  invoice_no      text,
  invoice_date    date,
  eway_expected   boolean not null default false,

  origin          text not null check (origin in ('requested','returned_consignment')),
  scope           text not null default 'full' check (scope in ('full','partial')),
  -- WHAT comes back, one element per invoice line:
  --   {order_item_id, item_id, item_name, unit, lot_no, billed_qty, return_qty}
  -- A snapshot, like the invoice no. above. Full scope = every billed line at its
  -- billed quantity; partial = only the lines named, at the quantity named.
  lines           jsonb not null default '[]'::jsonb,
  reason          text not null,
  requested_at    timestamptz not null default now(),
  requested_by    uuid references auth.users on delete set null,

  status          text not null default 'pending' check (status in ('pending','recorded','withdrawn')),

  sr_mode         text check (sr_mode is null or sr_mode in ('invoice_cancelled','sales_return')),
  reference_no    text,
  actual_date     date,
  remarks         text,
  attachment_path text,
  attachment_name text,
  recorded_at     timestamptz,
  recorded_by     uuid references auth.users on delete set null,
  edited_at       timestamptz,
  edited_by       uuid references auth.users on delete set null,

  withdrawn_at    timestamptz,
  withdrawn_by    uuid references auth.users on delete set null,
  withdraw_reason text,

  constraint fms_dispatch_round_returns_recorded_ck
    check ((status = 'recorded') = (recorded_at is not null and sr_mode is not null))
);

comment on table public.fms_dispatch_round_returns is
  'A sales return / invoice cancellation against ONE round''s invoice, once it has left the gate (20261230120000). Keyed on (order_id, round_no); round_id is filled in when the round archives. Paperwork only: recording it never moves the order. Written only through the fms_dispatch_*_round_return RPCs and the rounds trigger.';

-- ONE LIVE RETURN PER INVOICE. A withdrawn one does not count, so a mistaken
-- request can be withdrawn and raised again properly.
create unique index if not exists fms_dispatch_round_returns_one_live
  on public.fms_dispatch_round_returns (order_id, round_no) where status <> 'withdrawn';

-- Reads follow the order's own visibility, the same shape as fms_dispatch_rounds.
-- No write policy at all: every write goes through a SECURITY DEFINER function.
alter table public.fms_dispatch_round_returns enable row level security;
drop policy if exists fms_dispatch_round_returns_select on public.fms_dispatch_round_returns;
create policy fms_dispatch_round_returns_select on public.fms_dispatch_round_returns
  for select to authenticated
  using (exists (select 1 from public.fms_dispatch_orders o
                  where o.id = fms_dispatch_round_returns.order_id));
revoke all on public.fms_dispatch_round_returns from anon;
revoke insert, update, delete on public.fms_dispatch_round_returns from authenticated;
grant select on public.fms_dispatch_round_returns to authenticated;

-- ---------------------------------------------------------------------------
-- 2a. What one invoice billed, line by line.
--
-- Off the archive (fms_dispatch_round_items, names frozen there) when the round
-- is archived, else off the live order lines with the name from mst_items.
-- `billed_qty` is bill_qty, falling back to ship_qty on rows that predate the
-- column — the client's billedQtyOf, exactly. Lines billed at 0 are not on the
-- invoice and are left out.
--
-- ⚠ INTERNAL, like the opener below.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_invoice_lines(p_order uuid, p_round_no integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.line_no), '[]'::jsonb)
    from (
      select ri.line_no,
             jsonb_build_object('order_item_id', ri.order_item_id, 'item_id', ri.item_id,
                                'item_name', ri.item_name, 'unit', ri.unit_name, 'lot_no', ri.lot_no,
                                'billed_qty', coalesce(ri.bill_qty, ri.ship_qty)) as j
        from public.fms_dispatch_round_items ri
        join public.fms_dispatch_rounds r on r.id = ri.round_id
       where r.order_id = p_order and r.round_no = p_round_no
         and coalesce(ri.bill_qty, ri.ship_qty, 0) > 0
      union all
      select li.line_no,
             jsonb_build_object('order_item_id', li.id, 'item_id', li.item_id,
                                'item_name', it.name, 'unit', li.unit, 'lot_no', li.lot_no,
                                'billed_qty', coalesce(li.bill_qty, li.ship_qty))
        from public.fms_dispatch_order_items li
        join public.fms_dispatch_orders o on o.id = li.order_id
        left join public.mst_items it on it.id = li.item_id
       where li.order_id = p_order and o.round_no = p_round_no
         and not exists (select 1 from public.fms_dispatch_rounds r
                          where r.order_id = p_order and r.round_no = p_round_no)
         and coalesce(li.bill_qty, li.ship_qty, 0) > 0
    ) x;
$$;
revoke all on function public.fms_dispatch_invoice_lines(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. Open one — the single place a row is born, for both origins.
--
-- ⚠ INTERNAL. Not granted to anyone: it does no authorization of its own. The
--   request RPC checks the caller first; the trigger needs none.
--
-- The invoice is read off the ARCHIVE if the round is there, else off the order
-- header if it is the round in progress.
--
-- `p_lines` null means the whole invoice: every billed line at its billed qty.
--
-- Returns null, and does nothing, if the invoice already has a live return —
-- so the trigger is idempotent, and a round recorded as Returned after someone
-- already raised a return by hand does not open a second.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_open_round_return(
  p_order uuid, p_round_no integer, p_origin text, p_scope text, p_reason text,
  p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_no text; v_round_id uuid; v_inv text; v_inv_date date; v_eway boolean;
  v_id uuid;
begin
  select o.order_no into v_no from public.fms_dispatch_orders o where o.id = p_order;
  if v_no is null then return null; end if;

  select r.id, r.sb_invoice_no, r.sb_actual_date, r.sb_eway_path is not null
    into v_round_id, v_inv, v_inv_date, v_eway
    from public.fms_dispatch_rounds r
   where r.order_id = p_order and r.round_no = p_round_no;
  if v_round_id is null then
    select o.sb_invoice_no, o.sb_actual_date, o.sb_eway_path is not null
      into v_inv, v_inv_date, v_eway
      from public.fms_dispatch_orders o
     where o.id = p_order and o.round_no = p_round_no;
  end if;
  if coalesce(btrim(v_inv), '') = '' then return null; end if;

  if exists (select 1 from public.fms_dispatch_round_returns
              where order_id = p_order and round_no = p_round_no and status <> 'withdrawn') then
    return null;
  end if;

  insert into public.fms_dispatch_round_returns (
    order_id, round_no, round_id, invoice_no, invoice_date, eway_expected,
    origin, scope, lines, reason, requested_by)
  values (
    p_order, p_round_no, v_round_id, v_inv, v_inv_date, coalesce(v_eway, false),
    p_origin, p_scope,
    coalesce(p_lines,
             (select coalesce(jsonb_agg(l || jsonb_build_object('return_qty', l->'billed_qty')), '[]'::jsonb)
                from jsonb_array_elements(public.fms_dispatch_invoice_lines(p_order, p_round_no)) l)),
    p_reason, auth.uid())
  returning id into v_id;

  perform public.fms_dispatch_announce('order', p_order, 'round_return_requested',
    case when p_origin = 'returned_consignment'
         then 'Round ' || p_round_no || ' of order ' || v_no || ' came back - sales bill '
              || v_inv || ' has to be cancelled in Tally, or a sales return punched against it.'
         else 'A sales return was raised against sales bill ' || v_inv || ' on order '
              || v_no || ' (' || p_scope || '): ' || p_reason end
    || case when v_eway then ' It carried an e-way bill - check the portal too.' else '' end,
    -- The step's own owners, with coordinators copied so an unassigned step can
    -- never swallow it — the same recipients the cancellation kind uses.
    public.fms_dispatch_step_owner_ids('sales_return') || public.fms_dispatch_coordinator_ids(),
    jsonb_build_object('order_no', v_no, 'invoice_no', v_inv, 'invoice_date', v_inv_date,
                       'round_no', p_round_no, 'origin', p_origin, 'scope', p_scope,
                       'reason', p_reason));
  return v_id;
end $$;
revoke all on function public.fms_dispatch_open_round_return(uuid, integer, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The rounds trigger: link on archive, and a RETURNED round opens a return.
--
-- ⚠ AFTER, AND IT SWALLOWS ITS OWN ERRORS. This fires inside
--   record_dispatch_confirm and amend_round. A failure here must never stop a
--   delivery being recorded — the worst case is a missing link or queue row,
--   which a person can fix by hand; a refused dispatch confirmation is far worse.
--
-- Fires on the INSERT fms_dispatch_archive_round does (the dc_ block is copied
-- off the order header), and on an UPDATE that turns a round into Returned
-- (amend_round). Not on a round that was already Returned.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_round_returned_opens_return()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    -- A return raised while this round was still in progress now has its archive row.
    if tg_op = 'INSERT' then
      update public.fms_dispatch_round_returns
         set round_id = new.id
       where order_id = new.order_id and round_no = new.round_no and round_id is null;
    end if;

    if new.dc_status = 'returned'
       and coalesce(btrim(new.sb_invoice_no), '') <> ''
       and (tg_op = 'INSERT' or old.dc_status is distinct from 'returned') then
      perform public.fms_dispatch_open_round_return(
        new.order_id, new.round_no, 'returned_consignment', 'full',
        coalesce(
          case when tg_op = 'UPDATE' then nullif(btrim(new.amend_reason), '') end,
          nullif(btrim(new.dc_remarks), ''),
          'The consignment came back'));
    end if;
  exception when others then
    raise warning 'fms_dispatch_round_returned_opens_return: round % - %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.fms_dispatch_round_returned_opens_return() from public, anon, authenticated;

drop trigger if exists trg_dispatch_rounds_returned_opens_return on public.fms_dispatch_rounds;
create trigger trg_dispatch_rounds_returned_opens_return
  after insert or update of dc_status on public.fms_dispatch_rounds
  for each row execute function public.fms_dispatch_round_returned_opens_return();

-- ===========================================================================
-- 4. REQUEST — raise a sales return against an invoice by hand.
--
-- Qualifies: any round of an Order to Dispatch order whose invoice has LEFT THE
-- GATE — archived (delivered or returned, on an open or closed order) or the
-- round in progress past gate-out. Refused: no invoice yet; still in the plant
-- (use Cancel order); already being unwound by a cancellation.
-- ===========================================================================
create or replace function public.fms_dispatch_request_round_return(
  p_order uuid, p_round_no integer, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_raiser uuid; v_status text; v_live_round integer; v_live_inv text; v_live_gone timestamptz;
  v_inv text; v_archived text; v_found boolean := false; v_state text;
  v_src jsonb; v_src_line jsonb; v_lines jsonb := null; l jsonb; v_qty numeric;
  v_scope  text := coalesce(nullif(trim(p->>'scope'), ''), 'full');
  v_reason text := nullif(trim(p->>'reason'), '');
begin
  -- Locks the ORDER, so two people pressing the button at once queue up here
  -- and the second one gets the friendly refusal below, not a unique violation.
  select o.raised_by, o.status, o.round_no, o.sb_invoice_no, o.go_at
    into v_raiser, v_status, v_live_round, v_live_inv, v_live_gone
    from public.fms_dispatch_orders o
   where o.id = p_order
     for update;
  if v_status is null then raise exception 'Sales order not found'; end if;

  -- The same people who may cancel an order (its raiser, a coordinator, an
  -- admin), plus the Sales Return owners themselves — accounts is often the
  -- first to hear that a customer has sent goods back.
  if not (public.module_can_edit(v_uid, 'order-to-dispatch')
          and (public.is_admin(v_uid)
               or public.fms_dispatch_is_coordinator(v_uid)
               or v_raiser = v_uid
               or public.fms_dispatch_can_act('sales_return', p_order, v_uid))) then
    raise exception 'Only the person who raised this order, a Sales Return owner, a coordinator or an admin can raise a sales return';
  end if;

  select true, r.sb_invoice_no, r.archived_reason into v_found, v_inv, v_archived
    from public.fms_dispatch_rounds r
   where r.order_id = p_order and r.round_no = p_round_no;

  if coalesce(v_found, false) then
    -- A round archived by a cancellation was unwound by the order-level flow.
    if v_archived = 'cancelled' then
      raise exception 'This invoice was already dealt with when the order was cancelled';
    end if;
  elsif p_round_no = v_live_round then
    v_inv := v_live_inv;
    if v_status = 'awaiting_sales_return' then
      raise exception 'This order is already being cancelled - its invoice is in Sales Return already';
    end if;
    if coalesce(btrim(v_inv), '') <> '' and v_live_gone is null then
      raise exception 'Sales bill % is still in the plant - use Cancel order instead, which sends it to Sales Return', v_inv;
    end if;
  else
    raise exception 'That round was not found on this order';
  end if;

  if coalesce(btrim(v_inv), '') = '' then
    raise exception 'This round has no sales bill to return';
  end if;
  if v_scope not in ('full','partial') then
    raise exception 'Say whether the whole invoice or part of it is coming back';
  end if;
  if v_reason is null then raise exception 'A reason is required'; end if;

  -- A PARTIAL return names its lines; each must be on this invoice and may not
  -- exceed what it billed. Zero / blank rows are simply not coming back.
  if v_scope = 'partial' then
    v_src := public.fms_dispatch_invoice_lines(p_order, p_round_no);
    v_lines := '[]'::jsonb;
    for l in select * from jsonb_array_elements(
               case when jsonb_typeof(p->'lines') = 'array' then p->'lines' else '[]'::jsonb end) loop
      v_qty := nullif(trim(l->>'return_qty'), '')::numeric;
      if v_qty is null or v_qty = 0 then continue; end if;
      if v_qty < 0 then raise exception 'A return quantity cannot be negative'; end if;
      select x into v_src_line from jsonb_array_elements(v_src) x
       where x->>'order_item_id' = l->>'order_item_id';
      if v_src_line is null then
        raise exception 'That item is not on sales bill %', v_inv;
      end if;
      if v_lines @> jsonb_build_array(jsonb_build_object('order_item_id', v_src_line->'order_item_id')) then
        raise exception '% is listed twice', v_src_line->>'item_name';
      end if;
      if v_qty > (v_src_line->>'billed_qty')::numeric then
        raise exception 'Only % % of % was billed on %',
          v_src_line->>'billed_qty', coalesce(v_src_line->>'unit', ''), v_src_line->>'item_name', v_inv;
      end if;
      v_lines := v_lines || jsonb_build_array(v_src_line || jsonb_build_object('return_qty', v_qty));
    end loop;
    if jsonb_array_length(v_lines) = 0 then
      raise exception 'Enter how much is coming back on at least one item';
    end if;
  end if;

  select status into v_state from public.fms_dispatch_round_returns
   where order_id = p_order and round_no = p_round_no and status <> 'withdrawn';
  if v_state = 'pending' then
    raise exception 'A sales return is already waiting on sales bill %', v_inv;
  elsif v_state = 'recorded' then
    raise exception 'A sales return was already recorded against sales bill %', v_inv;
  end if;

  return public.fms_dispatch_open_round_return(p_order, p_round_no, 'requested', v_scope, v_reason, v_lines);
end $$;

-- ===========================================================================
-- 5. RECORD — what the Sales Return owner did in Tally.
--    Validation is the order-level record_sales_return's, rule for rule.
-- ===========================================================================
create or replace function public.fms_dispatch_record_round_return(p_return uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order uuid; v_state text; v_inv text; v_by uuid; v_no text; v_raiser uuid;
  v_mode text := nullif(trim(p->>'sr_mode'), '');
  v_ref  text := nullif(trim(p->>'sr_reference_no'), '');
  v_path text := nullif(trim(p->>'sr_attachment_path'), '');
begin
  select x.order_id, x.status, x.invoice_no, x.requested_by, o.order_no, o.raised_by
    into v_order, v_state, v_inv, v_by, v_no, v_raiser
    from public.fms_dispatch_round_returns x
    join public.fms_dispatch_orders o on o.id = x.order_id
   where x.id = p_return
     for update of x;
  if v_order is null then raise exception 'That sales return was not found'; end if;
  if v_state <> 'pending' then raise exception 'This sales return is not waiting to be recorded'; end if;
  if not public.fms_dispatch_can_act('sales_return', v_order, v_uid) then
    raise exception 'Only an owner of the Sales Return step can record this';
  end if;

  if v_mode is null or v_mode not in ('invoice_cancelled','sales_return') then
    raise exception 'Choose whether the invoice was cancelled or a sales return was raised';
  end if;
  if v_mode = 'sales_return' and v_ref is null then
    raise exception 'Enter the sales return / credit note number';
  end if;
  if v_mode = 'sales_return' and v_path is null then
    raise exception 'Attach the sales return / credit note';
  end if;

  update public.fms_dispatch_round_returns set
    status          = 'recorded',
    sr_mode         = v_mode,
    reference_no    = v_ref,
    actual_date     = coalesce(nullif(p->>'sr_actual_date','')::date, current_date),
    remarks         = nullif(trim(p->>'sr_remarks'), ''),
    attachment_path = v_path,
    attachment_name = nullif(trim(p->>'sr_attachment_name'), ''),
    recorded_at     = now(),
    recorded_by     = v_uid
  where id = p_return;

  perform public.fms_dispatch_announce('order', v_order, 'round_return_recorded',
    'Sales bill ' || coalesce(v_inv,'') || ' on order ' || coalesce(v_no,'') || ' was '
    || case when v_mode = 'sales_return'
            then 'reversed with sales return ' || coalesce(v_ref,'') || '.'
            else 'cancelled in Tally.' end,
    array_remove(array[v_by, v_raiser], null) || public.fms_dispatch_coordinator_ids(),
    jsonb_build_object('order_no', v_no, 'invoice_no', v_inv,
                       'sr_mode', v_mode, 'reference_no', v_ref));
end $$;

-- ===========================================================================
-- 6. CORRECT a recorded one, and WITHDRAW a pending one.
--
-- ⚠ The correction never touches sr_mode — same rule, and same reason, as
--   fms_dispatch_update_sales_return: the Tally entry is already made.
-- ===========================================================================
create or replace function public.fms_dispatch_update_round_return(p_return uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order uuid; v_state text; v_mode text; v_inv text; v_no text; v_path text;
begin
  select x.order_id, x.status, x.sr_mode, x.invoice_no, o.order_no
    into v_order, v_state, v_mode, v_inv, v_no
    from public.fms_dispatch_round_returns x
    join public.fms_dispatch_orders o on o.id = x.order_id
   where x.id = p_return
     for update of x;
  if v_order is null then raise exception 'That sales return was not found'; end if;
  if v_state <> 'recorded' then raise exception 'This sales return has not been recorded yet'; end if;
  if not public.fms_dispatch_can_act('sales_return', v_order, v_uid) then
    raise exception 'Only an owner of the Sales Return step can edit this';
  end if;

  if p ? 'sr_reference_no' and v_mode = 'sales_return'
     and coalesce(trim(p->>'sr_reference_no'), '') = '' then
    raise exception 'Enter the sales return / credit note number';
  end if;
  -- Omitted key keeps the stored file, '' clears it — probe what the row WOULD
  -- hold so a mandatory document cannot be cleared by an edit.
  select case when p ? 'sr_attachment_path' then nullif(p->>'sr_attachment_path','') else x.attachment_path end
    into v_path from public.fms_dispatch_round_returns x where x.id = p_return;
  if v_mode = 'sales_return' and coalesce(trim(v_path), '') = '' then
    raise exception 'Attach the sales return / credit note before saving';
  end if;

  update public.fms_dispatch_round_returns set
    reference_no    = coalesce(nullif(trim(p->>'sr_reference_no'), ''), reference_no),
    actual_date     = coalesce(nullif(p->>'sr_actual_date','')::date, actual_date),
    remarks         = nullif(trim(p->>'sr_remarks'), ''),
    attachment_path = case when p ? 'sr_attachment_path' then nullif(p->>'sr_attachment_path','') else attachment_path end,
    attachment_name = case when p ? 'sr_attachment_name' then nullif(p->>'sr_attachment_name','') else attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_return;

  -- ⚠ Must end in `edited`: announce sends no mail for those.
  perform public.fms_dispatch_announce('order', v_order, 'round_return_edited',
    'The sales return recorded against sales bill ' || coalesce(v_inv,'') || ' on order '
    || coalesce(v_no,'') || ' was corrected.',
    '{}'::uuid[], jsonb_build_object('order_no', v_no, 'invoice_no', v_inv));
end $$;

create or replace function public.fms_dispatch_withdraw_round_return(p_return uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order uuid; v_state text; v_inv text; v_by uuid; v_no text; v_raiser uuid;
begin
  select x.order_id, x.status, x.invoice_no, x.requested_by, o.order_no, o.raised_by
    into v_order, v_state, v_inv, v_by, v_no, v_raiser
    from public.fms_dispatch_round_returns x
    join public.fms_dispatch_orders o on o.id = x.order_id
   where x.id = p_return
     for update of x;
  if v_order is null then raise exception 'That sales return was not found'; end if;
  if v_state <> 'pending' then
    raise exception 'Only a sales return that is still waiting can be withdrawn';
  end if;
  if not (public.module_can_edit(v_uid, 'order-to-dispatch')
          and (public.is_admin(v_uid)
               or public.fms_dispatch_is_coordinator(v_uid)
               or v_by = v_uid
               or v_raiser = v_uid
               or public.fms_dispatch_can_act('sales_return', v_order, v_uid))) then
    raise exception 'Only whoever raised it, a Sales Return owner, a coordinator or an admin can withdraw this';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is being withdrawn'; end if;

  update public.fms_dispatch_round_returns set
    status = 'withdrawn', withdrawn_at = now(), withdrawn_by = v_uid,
    withdraw_reason = trim(p_reason)
  where id = p_return;

  perform public.fms_dispatch_announce('order', v_order, 'round_return_withdrawn',
    'The sales return against sales bill ' || coalesce(v_inv,'') || ' on order ' || coalesce(v_no,'')
    || ' was withdrawn - nothing to do in Tally. ' || trim(p_reason),
    public.fms_dispatch_step_owner_ids('sales_return')
      || array_remove(array[v_by], null) || public.fms_dispatch_coordinator_ids(),
    jsonb_build_object('order_no', v_no, 'invoice_no', v_inv, 'reason', trim(p_reason)));
end $$;

-- ⚠ PUBLIC IS NOT THE ONLY GRANT TO TAKE AWAY. Postgres grants EXECUTE to PUBLIC
--   (20260827120000 §13b), and this project's default privileges ALSO grant it
--   to anon and authenticated by name — verified while testing this file, when
--   the "from public" revoke on the internal opener above left it callable.
--   So: revoke from public and anon here, and from authenticated as well on the
--   two internal functions.
revoke all on function public.fms_dispatch_request_round_return(uuid, integer, jsonb) from public, anon;
revoke all on function public.fms_dispatch_record_round_return(uuid, jsonb) from public, anon;
revoke all on function public.fms_dispatch_update_round_return(uuid, jsonb) from public, anon;
revoke all on function public.fms_dispatch_withdraw_round_return(uuid, text) from public, anon;
grant execute on function public.fms_dispatch_request_round_return(uuid, integer, jsonb)  to authenticated;
grant execute on function public.fms_dispatch_record_round_return(uuid, jsonb)   to authenticated;
grant execute on function public.fms_dispatch_update_round_return(uuid, jsonb)   to authenticated;
grant execute on function public.fms_dispatch_withdraw_round_return(uuid, text)  to authenticated;

-- ===========================================================================
-- 7. THE MAIL — an arm for the three new announcement types.
--
-- ⚠ INJECTED INTO THE LIVE BODY, NOT RESTATED FROM THE REPO. The repo's last
--   copy (20260827120000 §13) has already drifted from the database — live
--   reads mst_parties / mst_companies / mst_items, the repo copy the retired
--   fms_dispatch_* masters — so restating it would silently revert that. This
--   reads whatever is live, inserts one block ahead of the round-number
--   comment (just after the order row is loaded), and re-creates it.
--
-- Without it, a return on a CLOSED order falls into the `r.status = 'closed'`
-- arm and mails the Sales Return owner "Delivered - <order>". Mail is off for
-- this module today, so this is for the day it is switched on.
-- ===========================================================================
do $mail$
declare
  src    text := pg_get_functiondef('public.fms_dispatch_email_payload(text,uuid,text,text,jsonb)'::regprocedure);
  anchor text := '  -- ⚠ The announcing RPC captures round_no';
  arm    text;
begin
  if position('round_return_requested' in src) > 0 then
    return;  -- already injected: re-running this file is a no-op
  end if;
  if position(anchor in src) = 0 then
    raise exception 'fms_dispatch_email_payload has changed shape - the anchor for the sales-return arm is gone; add the arm by hand';
  end if;

  arm := $arm$
  -- ---- Sales return against a finished round's invoice (20261230120000). ----
  -- ⚠ ABOVE THE STATUS LADDER: the order is usually CLOSED, and the closed arm
  --   below would head this "Delivered".
  if p_type in ('round_return_requested','round_return_recorded','round_return_withdrawn') then
    return jsonb_build_object(
      'subject', case p_type
                   when 'round_return_requested' then 'Sales return due - bill '
                   when 'round_return_recorded'  then 'Sales return recorded - bill '
                   else 'Sales return withdrawn - bill ' end
                 || coalesce(p_meta->>'invoice_no','') || ' - ' || r.order_no
                 || ' (' || coalesce(r.customer_name,'customer') || ')',
      'eyebrow', case p_type
                   when 'round_return_requested' then 'Sales return due'
                   when 'round_return_recorded'  then 'Sales return recorded'
                   else 'Sales return withdrawn' end,
      'headline', case p_type
                   when 'round_return_requested' then 'Sales bill ' || coalesce(p_meta->>'invoice_no','') || ' must be unwound'
                   when 'round_return_recorded'  then 'Sales bill ' || coalesce(p_meta->>'invoice_no','') || ' was unwound'
                   else 'No sales return is needed on bill ' || coalesce(p_meta->>'invoice_no','') end,
      'action', case p_type
                   when 'round_return_requested' then 'raised a sales return'
                   when 'round_return_recorded'  then 'recorded a sales return'
                   else 'withdrew a sales return' end,
      'docLabel', 'Order ' || r.order_no,
      'rows', jsonb_build_array(
                jsonb_build_object('label','Order no.','value', r.order_no),
                jsonb_build_object('label','Customer','value', coalesce(r.customer_name,'-')),
                jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
                jsonb_build_object('label','Invoice no.','value', coalesce(p_meta->>'invoice_no','-')),
                jsonb_build_object('label','Round','value', coalesce(p_meta->>'round_no','-')))
              || case when coalesce(p_meta->>'reference_no','') <> ''
                      then jsonb_build_array(jsonb_build_object('label','Sales return no.','value', p_meta->>'reference_no'))
                      else '[]'::jsonb end,
      'ctaLabel', case when p_type = 'round_return_requested' then 'Open Sales Return' else 'Open the order' end,
      'ctaPath',  case when p_type = 'round_return_requested' then b || '/queues/sales-return'
                       else b || '/orders/' || r.id::text end)
    || case when coalesce(btrim(p_text),'') <> ''
            then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
            else '{}'::jsonb end;
  end if;

$arm$;

  src := replace(src, anchor, arm || anchor);
  execute src;
end $mail$;

-- ===========================================================================
-- 8. Assertions.
-- ===========================================================================
do $check$
declare src text;
begin
  -- The trigger must be there, or a Returned consignment still falls through.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.fms_dispatch_rounds'::regclass
                    and tgname  = 'trg_dispatch_rounds_returned_opens_return') then
    raise exception 'the returned-consignment trigger is missing';
  end if;
  -- …and must never be able to fail a dispatch confirmation.
  src := pg_get_functiondef('public.fms_dispatch_round_returned_opens_return()'::regprocedure);
  if position('exception when others' in src) = 0 then
    raise exception 'the returned-consignment trigger no longer swallows its own errors';
  end if;

  -- Paperwork only: none of the new functions may move the order.
  src := pg_get_functiondef('public.fms_dispatch_record_round_return(uuid,jsonb)'::regprocedure)
      || pg_get_functiondef('public.fms_dispatch_request_round_return(uuid,integer,jsonb)'::regprocedure)
      || pg_get_functiondef('public.fms_dispatch_withdraw_round_return(uuid,text)'::regprocedure)
      || pg_get_functiondef('public.fms_dispatch_update_round_return(uuid,jsonb)'::regprocedure);
  if src ~ 'update public\.fms_dispatch_orders' or src ~ 'fms_dispatch_recalc_dispatched' then
    raise exception 'a round-return function now changes the order - it must stay paperwork only';
  end if;
  if position('fms_dispatch_can_act' in pg_get_functiondef('public.fms_dispatch_record_round_return(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'fms_dispatch_record_round_return does not check authorization';
  end if;
  if pg_get_functiondef('public.fms_dispatch_update_round_return(uuid,jsonb)'::regprocedure) ~ 'sr_mode\s*=' then
    raise exception 'fms_dispatch_update_round_return rewrites sr_mode';
  end if;

  -- The internal opener must not be callable from the API.
  if has_function_privilege('authenticated', 'public.fms_dispatch_open_round_return(uuid,integer,text,text,text,jsonb)', 'execute') then
    raise exception 'fms_dispatch_open_round_return is callable by signed-in users - it does no authorization';
  end if;

  if has_function_privilege('authenticated', 'public.fms_dispatch_invoice_lines(uuid,integer)', 'execute') then
    raise exception 'fms_dispatch_invoice_lines is callable by signed-in users';
  end if;

  -- The mail arm must sit above the status ladder, or a closed order mails "Delivered".
  src := pg_get_functiondef('public.fms_dispatch_email_payload(text,uuid,text,text,jsonb)'::regprocedure);
  if position('round_return_requested' in src) = 0
     or position('round_return_requested' in src) > position('r.status = ''closed''' in src) then
    raise exception 'the round-return mail arm is missing or sits below the status ladder';
  end if;
end $check$;

commit;
