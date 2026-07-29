-- ===========================================================================
-- ORDER TO DISPATCH FMS — RESHAPE, PART 1 of 4: SCHEMA.
--
-- WHAT CHANGES, AND WHY
--   The module shipped as a strictly linear SEVEN-step chain that ran once. Real
--   dispatch is partial: 2 of 5 items go today, the rest next week, and each
--   consignment carries its own Tally invoice, gate outward number and receiver
--   copy. This migration turns the order into a chain of ROUNDS.
--
-- THE ONE RULE — LEARN IT BEFORE READING ANY FURTHER
--   The order row holds THE ROUND CURRENTLY IN PROGRESS, and nothing else.
--   The moment a round's delivery is confirmed it is copied into
--   fms_dispatch_rounds / _round_items and the order's ms_/sb_/go_/dc_ block is
--   WIPED — on every path, including the one that closes the order. So a closed
--   order has an empty step block and its entire history in the archive.
--   There is no exception. Do not "optimise" the final round into the header:
--   it would then exist in both places and every count in the app doubles.
--
-- THE SECOND RULE
--   `dispatched_qty` is NEVER incremented. It is RECALCULATED from the archive
--   (the sum of ship_qty over rounds marked 'delivered'). That is what makes an
--   edit safe, a correction safe, and drift impossible. See migration 2's
--   fms_dispatch_recalc_dispatched().
--
-- The step chain becomes SIX:
--   sales_order → credit_check → material_status → sales_bill → gate_out →
--   dispatch_confirm → (loop back to material_status, or closed)
-- `lot_confirm` is GONE; lot + quantity are now captured per line at
-- material_status, which is also where partial selection happens.
--
-- ⚠ THIS MIGRATION DROPS COLUMNS AND IS WRITTEN FOR THE NEVER-SEEDED MODULE.
--   The guard below refuses to run if any order exists. Apply with
--   `supabase db push` or the SQL editor (both wrap the file in a transaction).
--   If you use psql you MUST pass -v ON_ERROR_STOP=1 --single-transaction, or
--   the guard prints its error and every drop below runs anyway.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- GUARD. Repeated at the top of all four files in this set: migrations 2 and 4
-- only create functions, and PL/pgSQL bodies are NOT validated at create time —
-- so a half-applied set looks perfectly healthy and fails on the first click.
-- ---------------------------------------------------------------------------
do $$
declare v_o bigint; v_i bigint;
begin
  select count(*) into v_o from public.fms_dispatch_orders;
  select count(*) into v_i from public.fms_dispatch_order_items;
  if v_o > 0 or v_i > 0 then
    raise exception
      'Order to Dispatch holds % order(s) / % line(s). This migration DROPS columns and is written for the never-seeded module. Export and clear fms_dispatch_orders (it cascades to its items) before applying, or write a data migration first.',
      v_o, v_i;
  end if;
end $$;

-- ===========================================================================
-- 1. CONSTRAINTS OFF FIRST
-- ===========================================================================

-- The Local/Transport evidence rules. Both are plain (not DEFERRABLE) CHECKs
-- that were vacuous until dc_at was stamped. Delivery confirmation no longer
-- collects an LR number or a receiver name, so leaving these in place would make
-- it impossible for ANY order to close.
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_transport_lr_ck;
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_local_receiver_ck;

-- The three enum CHECKs were declared inline, so Postgres named them
-- <table>_<column>_check. There is no "re-issue" in DDL — drop by that exact
-- generated name, then add back.
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_status_check;
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_cc_status_check;
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_dc_status_check;

-- ===========================================================================
-- 2. THE ORDER — NEW COLUMNS
-- ===========================================================================
alter table public.fms_dispatch_orders
  -- Which round is in progress. Round 1 is the ordinary single-consignment case.
  add column if not exists round_no         integer     not null default 1,
  -- ⚠ THE SLA ANCHOR FOR material_status, and the reason this column exists.
  --   Anchoring round N's stock check on submitted_at would make every looped
  --   order permanently overdue from the moment it loops — red in the queue, in
  --   My Work and on the scoreboard, for ever. Re-stamped on every loop-back and
  --   by the "nothing available yet" action.
  add column if not exists round_started_at timestamptz not null default now(),

  -- Gate outward number, TYPED from the plant's paper register (the old
  -- auto-generated go_gate_pass_no is dropped below). Deliberately NOT unique:
  -- it is transcribed by hand, and a typo must be correctable rather than a 500
  -- naming a constraint.
  add column if not exists go_outward_no    text,

  -- Credit is decided ONCE PER ORDER and survives every loop-back, so it needs
  -- its own timestamps rather than borrowing the shared edited_at/by pair (which
  -- travels with the round and is wiped).
  --   cc_decided_at : when the outcome was last set — Approve OR On hold. Also
  --                   the SLA anchor for credit_check, so a legitimate multi-week
  --                   hold does not sit red in the queue the whole time.
  --   cc_at         : STEP COMPLETION. Stamped on Approve only. An on-hold order
  --                   has cc_decided_at set and cc_at still null, which is what
  --                   keeps it in the pending queue.
  add column if not exists cc_decided_at    timestamptz,
  add column if not exists cc_decided_by    uuid references auth.users on delete set null,
  add column if not exists cc_edited_at     timestamptz,
  add column if not exists cc_edited_by     uuid references auth.users on delete set null,

  -- Coordinator force-close of an order that will never be completed.
  add column if not exists closed_reason    text,
  add column if not exists closed_by        uuid references auth.users on delete set null;

-- ===========================================================================
-- 3. THE ORDER — DROPPED COLUMNS
--
-- ⚠ These drops are what RELEASE the foreign keys into the 13 master tables
--   that migration 3 deletes. They must land first. Every function that names
--   one of these columns is rewritten in migration 2 — Postgres records no
--   dependency from a function body to a column, so a missed one is a landmine
--   that fires weeks later, not a migration error.
-- ===========================================================================

-- intake: the sales order now asks for dispatch type, customer, date, remarks.
alter table public.fms_dispatch_orders
  drop column if exists ship_to_id,
  drop column if exists order_source_id,
  drop column if exists customer_ref,
  drop column if exists tat_days,
  drop column if exists promised_date;

-- credit: one decision, one remark.
alter table public.fms_dispatch_orders
  drop column if exists cc_actual_date,
  drop column if exists cc_payment_term_id,
  drop column if exists cc_credit_limit,
  drop column if exists cc_outstanding_amount,
  drop column if exists cc_payment_ref,
  drop column if exists cc_payment_amount;

-- material status: the substance is per line now. The customer auto-mail is
-- retired outright (migration 3 drops its functions and template master).
alter table public.fms_dispatch_orders
  drop column if exists ms_status,
  drop column if exists ms_godown_id,
  drop column if exists ms_planned_dispatch_date,
  drop column if exists ms_mail_template_id,
  drop column if exists ms_mail_to,
  drop column if exists ms_mail_subject,
  drop column if exists ms_mail_queued_at,
  drop column if exists ms_mail_outbox_id,
  drop column if exists ms_mail_skipped_reason;

-- the whole LOT-confirmation step.
alter table public.fms_dispatch_orders
  drop column if exists lc_actual_date,
  drop column if exists lc_status,
  drop column if exists lc_remarks,
  drop column if exists lc_at,
  drop column if exists lc_by;

-- sales bill: Tally invoice no. + attachment + remarks.
alter table public.fms_dispatch_orders
  drop column if exists sb_company_id,
  drop column if exists sb_invoice_series_id,
  drop column if exists sb_invoice_date,
  drop column if exists sb_invoice_value,
  drop column if exists sb_status;

-- gate outward: the typed number + remarks.
alter table public.fms_dispatch_orders
  drop column if exists go_gate_pass_no,
  drop column if exists go_gate_id,
  drop column if exists go_godown_id,
  drop column if exists go_vehicle_id,
  drop column if exists go_driver_id,
  drop column if exists go_out_at,
  drop column if exists go_status;

-- delivery confirmation: outcome + receiver copy + remarks.
alter table public.fms_dispatch_orders
  drop column if exists dc_receiver_name,
  drop column if exists dc_received_at,
  drop column if exists dc_driver_id,
  drop column if exists dc_transporter_id,
  drop column if exists dc_lr_no,
  drop column if exists dc_lr_date,
  drop column if exists dc_freight_amount;

-- ===========================================================================
-- 4. THE ORDER — CONSTRAINTS BACK ON
-- ===========================================================================
alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_status_check check (status in (
    'awaiting_credit_check','awaiting_material_status',
    'awaiting_sales_bill','awaiting_gate_out','awaiting_dispatch_confirm',
    'closed','on_hold','cancelled'));

-- 'credit_hold', NOT 'on_hold': the order-level status already owns that word,
-- and two different holds sharing one token is how the wrong one gets read.
alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_cc_status_check
    check (cc_status is null or cc_status in ('approved','credit_hold'));

alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_dc_status_check
    check (dc_status is null or dc_status in ('delivered','returned'));

comment on table public.fms_dispatch_orders is
  'One customer sales order. The step columns (ms_/sb_/go_/dc_) hold THE ROUND CURRENTLY IN PROGRESS and are wiped into fms_dispatch_rounds when each round''s delivery is confirmed; credit (cc_) is decided once per order and survives every round. Reads are open to every granted user; writes go through the RPCs.';

-- ===========================================================================
-- 5. THE ORDER LINES
-- ===========================================================================
alter table public.fms_dispatch_order_items
  -- How much of this line has actually been delivered, across all rounds.
  -- ⚠ RECALCULATED, never incremented. See the header.
  add column if not exists dispatched_qty numeric(14,3) not null default 0,
  -- This round's selection. Null / absent = this line is not going out this time.
  add column if not exists ship_qty       numeric(14,3),
  -- Typed by the store keeper. Free text on purpose — the LOT master is gone.
  add column if not exists lot_no         text;

alter table public.fms_dispatch_order_items
  drop constraint if exists fms_dispatch_order_items_dispatched_ck,
  drop constraint if exists fms_dispatch_order_items_ship_qty_ck;

alter table public.fms_dispatch_order_items
  add constraint fms_dispatch_order_items_ship_qty_ck
    check (ship_qty is null or ship_qty > 0),
  -- numeric is exact decimal, so a plain <= is safe here — no float fudge needed.
  add constraint fms_dispatch_order_items_dispatched_ck
    check (dispatched_qty >= 0 and dispatched_qty <= quantity);

alter table public.fms_dispatch_order_items
  drop column if exists ms_line_status,
  drop column if exists ms_available_qty,
  drop column if exists ms_shortfall_reason_id,
  drop column if exists lot_id,
  drop column if exists lot_no_snapshot,
  drop column if exists final_qty,
  drop column if exists final_unit_id,
  drop column if exists packing_type_id,
  drop column if exists packs,
  drop column if exists lc_shortfall_reason_id;

comment on table public.fms_dispatch_order_items is
  'One item line on a sales order. `quantity` is intake and never changes. `ship_qty` / `lot_no` are THIS ROUND''s selection and are cleared on every loop-back. `dispatched_qty` is the running delivered total, RECALCULATED from fms_dispatch_round_items — never incremented.';

-- ===========================================================================
-- 6. THE COMPANY ↔ CUSTOMER MAPPING
--
-- The sales order no longer asks which of our companies is selling: it is
-- resolved from the customer. Added HERE and not in migration 3 because
-- migration 2's fms_dispatch_submit_order reads it.
-- `on delete restrict`, not set null: companies are soft-deactivated in this app
-- (the `active` flag), so a hard delete that silently unmapped every customer
-- would be a bug wearing a feature's clothes.
-- ===========================================================================
alter table public.fms_dispatch_customers
  add column if not exists company_id uuid references public.fms_dispatch_companies on delete restrict;

create index if not exists fms_dispatch_customers_company_idx
  on public.fms_dispatch_customers (company_id);

-- ===========================================================================
-- 7. THE ARCHIVE — one row per completed round.
--
-- Deliberately a COLUMN-FOR-COLUMN MIRROR of the order's step block, so
-- archiving is a plain `insert … select` with no mapping that can drift.
-- ===========================================================================
create table if not exists public.fms_dispatch_rounds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.fms_dispatch_orders on delete cascade,
  round_no           integer not null check (round_no >= 1),

  -- The round's OWN clock start. Without this, a historic round's planned dates
  -- would be derived from the current round and every old row reports "0 days
  -- late" — the register's whole reason to exist, quietly wrong.
  round_started_at   timestamptz,
  -- The issuing entity for THIS round's invoice, snapshotted. The customer's
  -- company mapping can legitimately change between rounds.
  company_id         uuid references public.fms_dispatch_companies on delete restrict,

  ms_actual_date     date,
  ms_remarks         text,
  ms_at              timestamptz,
  ms_by              uuid references auth.users on delete set null,

  sb_actual_date     date,
  sb_invoice_no      text,
  sb_attachment_path text,
  sb_attachment_name text,
  sb_remarks         text,
  sb_at              timestamptz,
  sb_by              uuid references auth.users on delete set null,

  go_actual_date     date,
  go_outward_no      text,
  go_remarks         text,
  go_at              timestamptz,
  go_by              uuid references auth.users on delete set null,

  dc_actual_date     date,
  dc_status          text check (dc_status is null or dc_status in ('delivered','returned')),
  dc_attachment_path text,
  dc_attachment_name text,
  dc_remarks         text,
  dc_at              timestamptz,
  dc_by              uuid references auth.users on delete set null,

  -- The order carries ONE edited_at/by pair. It travels with the round and is
  -- wiped on loop-back, or round 2's Completed tab would show round 1's edit.
  edited_at          timestamptz,
  edited_by          uuid references auth.users on delete set null,

  -- A coordinator correcting a finished round: the outcome, or the quantities,
  -- or both. This is how a part-return is recorded (driver marks Returned, the
  -- coordinator corrects it to what the customer actually kept) and the only way
  -- back from a mis-tapped button.
  amended_at         timestamptz,
  amended_by         uuid references auth.users on delete set null,
  amend_reason       text,

  --   looped    : something was still owed, the order went round again
  --   closed    : nothing left owing, the order closed on this round
  --   cancelled : the order was cancelled with this round part-recorded
  --               (dc_at is null on such a row — it never reached delivery)
  archived_reason    text not null default 'looped'
                     check (archived_reason in ('looped','closed','cancelled')),
  archived_at        timestamptz not null default now(),
  unique (order_id, round_no)
);

comment on table public.fms_dispatch_rounds is
  'One completed dispatch round: the order''s step block frozen at the moment its delivery was confirmed. THE source of truth for history — the order row only ever holds the round in progress.';

create index if not exists fms_dispatch_rounds_order_idx  on public.fms_dispatch_rounds (order_id);
create index if not exists fms_dispatch_rounds_status_idx on public.fms_dispatch_rounds (dc_status);

create table if not exists public.fms_dispatch_round_items (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references public.fms_dispatch_rounds on delete cascade,
  -- set null, not cascade: deleting a line later must never erase the record of
  -- what physically shipped.
  order_item_id uuid references public.fms_dispatch_order_items on delete set null,
  line_no       integer not null,
  item_id       uuid references public.fms_dispatch_items on delete restrict,
  -- Snapshots, following this module's own lot-label precedent: a later rename
  -- of the item or unit master must not rewrite what was actually dispatched.
  item_name     text not null,
  unit_name     text,
  unit_id       uuid references public.fms_dispatch_units on delete restrict,
  ordered_qty   numeric(14,3) not null,
  ship_qty      numeric(14,3) not null check (ship_qty > 0),
  lot_no        text,
  created_at    timestamptz not null default now(),
  -- Keyed on the LINE, not on line_no: line numbers are reassigned from 1 every
  -- time the intake grid is saved, so they are not a stable identity.
  unique (round_id, order_item_id)
);

comment on table public.fms_dispatch_round_items is
  'What actually went out on one round. Only lines with a quantity appear. Summed over rounds with dc_status = ''delivered'' to recalculate fms_dispatch_order_items.dispatched_qty.';

create index if not exists fms_dispatch_round_items_round_idx on public.fms_dispatch_round_items (round_id);
create index if not exists fms_dispatch_round_items_line_idx  on public.fms_dispatch_round_items (order_item_id);
create index if not exists fms_dispatch_round_items_item_idx  on public.fms_dispatch_round_items (item_id);
create index if not exists fms_dispatch_round_items_unit_idx  on public.fms_dispatch_round_items (unit_id);

-- ---------------------------------------------------------------------------
-- RLS — mirrors fms_dispatch_orders exactly, written out in full.
-- ⚠ `to authenticated` is load-bearing on BOTH policies. A select policy with no
--   role clause defaults to PUBLIC, which includes `anon` — these rows carry
--   invoice numbers and customer-linked quantities.
-- ---------------------------------------------------------------------------
alter table public.fms_dispatch_rounds enable row level security;
drop policy if exists fms_dispatch_rounds_select on public.fms_dispatch_rounds;
create policy fms_dispatch_rounds_select on public.fms_dispatch_rounds
  for select to authenticated using (true);
drop policy if exists fms_dispatch_rounds_write_admin on public.fms_dispatch_rounds;
create policy fms_dispatch_rounds_write_admin on public.fms_dispatch_rounds
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_dispatch_round_items enable row level security;
drop policy if exists fms_dispatch_round_items_select on public.fms_dispatch_round_items;
create policy fms_dispatch_round_items_select on public.fms_dispatch_round_items
  for select to authenticated using (true);
drop policy if exists fms_dispatch_round_items_write_admin on public.fms_dispatch_round_items;
create policy fms_dispatch_round_items_write_admin on public.fms_dispatch_round_items
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- 8. HOUSEKEEPING — remove config that names things that no longer exist.
-- ===========================================================================

-- The LOT step's owner row and its due-date rule.
delete from public.fms_dispatch_step_owners where step_key = 'lot_confirm';
update public.fms_dispatch_config
   set value = value - 'lot_confirm', updated_at = now()
 where key = 'step_sla' and value ? 'lot_confirm';

-- The customer auto-mail switch (the feature is retired in migration 3).
delete from public.fms_dispatch_config where key = 'customer_mail';

-- The auto-generated gate-pass counters. The number is typed now.
delete from public.fms_dispatch_counters where scope like 'gatepass:%';

comment on table public.fms_dispatch_counters is
  'Per-scope sequence counters. Scope is order:<fy> — one series, since the gate outward number is typed from the plant register rather than generated.';
