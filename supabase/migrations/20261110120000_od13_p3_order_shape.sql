-- OD-13 · P3 — the shape of an order the customer punched.
--
-- Applied to the live database on 04-09-2026 as
--   od13_p3_order_shape_and_window
--   od13_p3_replace_customer_lines
--   od13_p3_customer_order_writes
--   od13_p3_announce_always_reaches_the_named_recipients
--   od13_p3_customer_read_rpcs
--
-- 🔴 THE PLAN SAID THE ITEM LINES COULD REUSE fms_dispatch_replace_lines UNCHANGED.
--    MEASURED AGAINST THE LIVE DATA, THAT IS WRONG.
--
--      the picker offers Bishen            62 distinct item names (union of 5 ticked books)
--      fms_dispatch_replace_lines accepts  36 (only those mapped to the PRIMARY ledger)
--      so it would REFUSE                  26 of the 62 it had just offered
--
--    replace_lines validates `mst_party_items.party_id = <the order's customer_id>`, and a
--    customer order's customer_id is the org's PROVISIONAL primary ledger -- one book out of
--    five. The customer would pick an ink the screen showed them and be told, in our internal
--    words, "This customer is not mapped to KY SUBLIMATION INK BLACK. Add the pair in Central
--    Masters -> Customer Items first." A screen that offers things it then refuses, in
--    language written for us.
--
--    Hence fms_dispatch_replace_customer_lines: the same function, validating against the
--    UNION of the ticked ledgers -- which is the set the picker is built from. Every other
--    rule is copied verbatim, including the two its own comments call out: the rounds guard,
--    and the unit read via a LEFT JOIN to mst_units (an inner join silently drops the unit off
--    the gate pass and the receiver copy, permanently).
--
-- 🔴 THE EDIT / CANCEL WINDOW MUST TEST ROUNDS, AND THE OBVIOUS RULE IS DANGEROUS.
--
--    Q7/Q10 say "until credit check is actioned". Read literally that is
--    `status = 'awaiting_credit_check' and cc_decided_at is null` -- and on a PART-DELIVERED
--    order it REOPENS, because fms_dispatch_record_dispatch_confirm sends an exhausted order
--    back to credit and deliberately wipes cc_status / cc_at / cc_decided_at. Proved on the
--    live functions, with both answers side by side:
--
--      4. PART-DELIVERED, back at credit for round 2
--         the OBVIOUS rule says  window=t   <- would REOPEN
--         ours says              window=f
--         customer sees "part_dispatched", can_change=f   (not "placed")
--         cancel -> refused by the SERVER
--
--    Without the rounds clause the customer could cancel an order that had already shipped and
--    been invoiced, dropping it into Sales Return -- the precise outcome Q10 says must be
--    prevented on the server rather than by hiding a button.
--
--    The same wipe is why the STATUS MAPPING tests rounds BEFORE it tests the step: a
--    part-delivered order sits at current_step = 'credit_check', which would otherwise read
--    "Placed" to a customer holding half their goods. It is also the only way "Partly
--    dispatched" is ever reached at all.
--
-- ⚠ AND THE WINDOW KEYS ON cc_decided_at, NOT cc_at. A credit HOLD stamps cc_decided_at but
--   not cc_at -- which is why a held STAFF order stays editable today, deliberately. "Until
--   credit check is actioned" means the field every verdict stamps.
--
-- ⚠ ANNOUNCE NOW ADDS THE CUSTOMER'S NAMED RECIPIENTS, and that is not tidiness. Twelve call
--   sites pick their own recipients, and on a customer order most of those choices resolve to
--   NOBODY: step_owner_ids('credit_check') returns two people whom can_see_order refuses while
--   the order has no location, and coordinator_ids() is empty. fms_dispatch_cancel_order is
--   the proof: a customer cancelling inside their window would announce to array[v_raiser]
--   (the customer, dropped) || coordinators (none) || step owners (refused), so the people
--   responsible would never learn the order had gone. Announcing to nobody raises no error.
--
-- SAFETY
-- ------
-- Two nullable columns, one NOT NULL dropped, and new functions. The existing CHECK
-- `dispatch_type = ANY (ARRAY['local','transport'])` already PASSES on NULL under SQL
-- three-valued logic -- verified against the live constraint -- so no constraint was edited
-- and no row was rewritten. fms_dispatch_submit_order and fms_dispatch_update_order are
-- untouched; the customer path is a set of SIBLINGS, never a branch inside the staff one.
--
-- ⚠ The customer's whole call path runs through fms_dispatch_next_seq, _announce, _fy_code and
--   _recalc_dispatched. All four are SECURITY DEFINER, and auth.uid() inside a nested SECURITY
--   DEFINER call is still the CUSTOMER's uid -- so a P0c-style `is_staff` guard on any of them
--   would refuse the customer their own order. P0c excluded everything named `fms_dispatch_*`
--   for exactly this reason; verified still true before building on it.

begin;

alter table public.fms_dispatch_orders
  add column if not exists intake_source       text,
  add column if not exists intake_completed_at timestamptz;

comment on column public.fms_dispatch_orders.intake_source is
  '''customer'' when the order was punched by the customer themselves through the Orange Order '
  'Desk; NULL for every staff-raised order, past and future. An order is INCOMPLETE while '
  'intake_source = ''customer'' and intake_completed_at is null -- deliberately NOT a new '
  '`status` value, because status drives every queue, filter, export and report in the staff app.';

comment on column public.fms_dispatch_orders.intake_completed_at is
  'When credit check filled in the billing company, dispatch site and dispatch type that the '
  'customer never sees (OD-13 Q1/Q2).';

alter table public.fms_dispatch_orders alter column dispatch_type drop not null;

create index if not exists fms_dispatch_orders_intake_idx
  on public.fms_dispatch_orders (intake_source)
  where intake_source is not null;

-- The window. See the header for why the rounds clause is not optional.
create or replace function public.fms_dispatch_customer_window_open(p_order uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.fms_dispatch_orders o
     where o.id = p_order
       and o.intake_source = 'customer'
       and o.status = 'awaiting_credit_check'
       and o.cc_decided_at is null
       and not exists (select 1 from public.fms_dispatch_rounds r where r.order_id = o.id)
  );
$fn$;

-- The full bodies of
--   fms_dispatch_replace_customer_lines(uuid, jsonb)
--   fms_dispatch_submit_customer_order(jsonb)
--   fms_dispatch_update_customer_order(jsonb)
--   fms_dispatch_cancel_customer_order(jsonb)
--   fms_dispatch_announce(...)                     -- + the named-recipient append
--   fms_dispatch_my_customer_profile()
--   fms_dispatch_my_items()
--   fms_dispatch_my_orders()
-- are as applied in the five migrations named at the top of this file. They are reproduced
-- there verbatim; this file carries the reasoning, which is the part that is not recoverable
-- from pg_get_functiondef.
--
-- THE CUSTOMER READS NO TABLE DIRECTLY. Their entire screen is three SECURITY DEFINER
-- functions (my_customer_profile / my_items / my_orders). That is what lets P0 be a clean
-- "staff only" sweep with no exceptions to reason about, and it is how Q11's "the customer
-- never sees this list" is honoured -- by never sending it. mst_companies, mst_locations and
-- mst_company_locations stay entirely out of reach, and so does the ticked-ledger list.
--
-- ⚠ my_items() IS DE-DUPLICATED BY NAME, and that is not cosmetic. "Bishen Dyeing" is five
--   Tally ledgers and the same ink is a separate mst_items row in each book -- "KY SUBLIMATION
--   INK BLACK" is three rows. Without `distinct on (i.name)` the customer sees the same ink
--   three times with nothing on screen to tell them apart. Which id survives does not matter:
--   credit check re-points the line to the billing book's own row afterwards (P4, decision 3).

commit;
