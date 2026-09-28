-- OD-13 · P5 — my_orders must return the item_id, not only the item's NAME.
--
-- Applied to the live database on 04-09-2026 as `od13_p5_my_orders_carries_the_item_id`.
--
-- 🔴 WITHOUT THIS THE "CHANGE THIS ORDER" SCREEN IS DESTRUCTIVE, NOT MERELY WRONG.
--
--    fms_dispatch_my_orders returned each line as (line_no, name, quantity, unit,
--    line_remark) -- everything needed to DISPLAY an order and nothing needed to RE-OPEN
--    one. The edit form has to pre-select each line's item in the picker, and a picker is
--    keyed on the id. So the form would have opened with every quantity filled in and every
--    item blank, and saving it would have posted a payload with no items at all.
--
--    fms_dispatch_replace_customer_lines DELETES the existing lines before inserting the new
--    ones, so that save would have emptied the order rather than failing loudly. It happens
--    to raise "Add at least one item to your order" and roll back -- but only because the
--    customer had no OTHER valid line; on a two-line order where one item resolved and one
--    did not, the save succeeds and the order silently loses a line. The shape of the bug is
--    data loss, and it survived review because the display was complete.
--
-- ⚠ THE ALTERNATIVE WAS TO MATCH THE LINE BACK TO THE PICKER BY NAME, AND THAT IS A TRAP
--   THIS CODEBASE HAS ALREADY WRITTEN DOWN. receivables-hub/lib/scopeParties.ts says it in
--   as many words: join by id, never by name. It would even have appeared to work --
--   my_items() is de-duplicated by name and every line name comes from mst_items -- right up
--   to the first item renamed in Tally, at which point one line empties itself on the screen
--   whose whole purpose is to edit that line.
--
-- ADDITIVE: one more key inside a jsonb the browser already parses. Every existing reader
-- names the keys it wants, so nothing that reads `lines` today sees any change.

create or replace function public.fms_dispatch_my_orders()
returns table(id uuid, order_no text, order_date date, order_remarks text,
              status_key text, can_change boolean, placed_at timestamptz, lines jsonb)
language sql stable security definer set search_path to 'public'
as $fn$
  select o.id, o.order_no, o.order_date, o.order_remarks,
         case
           when o.status = 'cancelled'              then 'cancelled'
           when o.status = 'awaiting_sales_return'  then 'cancelling'
           when o.status = 'on_hold'                then 'paused'
           when exists (select 1 from public.fms_dispatch_rounds r where r.order_id = o.id)
                and o.status not in ('closed')      then 'part_dispatched'
           when o.current_step in ('sales_order','credit_check')   then 'placed'
           when o.current_step in ('material_status','sales_bill') then 'preparing'
           when o.current_step = 'gate_out'                        then 'dispatched'
           else 'delivered'
         end,
         public.fms_dispatch_customer_window_open(o.id),
         o.submitted_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'line_no', li.line_no, 'item_id', li.item_id, 'name', i.name,
                    'quantity', li.quantity, 'unit', li.unit, 'line_remark', li.line_remark)
                  order by li.line_no)
             from public.fms_dispatch_order_items li
             join public.mst_items i on i.id = li.item_id
            where li.order_id = o.id
         ), '[]'::jsonb)
    from public.fms_dispatch_orders o
   where public.fms_dispatch_customer_org_of(auth.uid()) is not null
     and public.fms_dispatch_customer_org_of_login(o.raised_by)
         = public.fms_dispatch_customer_org_of(auth.uid())
   order by o.submitted_at desc nulls last, o.order_no desc;
$fn$;
