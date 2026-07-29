-- ===========================================================================
-- ORDER TO DISPATCH FMS — RESHAPE, PART 4 of 4: ALERT CONTENT.
--
-- fms_dispatch_email_payload names four things migration 1 dropped
-- (promised_date, final_qty, final_unit_id, the lot_confirm step) and would keep
-- creating cleanly while failing at send time. It also has two content bugs the
-- reshape introduces:
--
--   • A credit HOLD leaves status='awaiting_credit_check', so the old code fell
--     through to the generic branch and mailed "SO-… is ready for Credit
--     Confirmation" — telling the reader to go and do the thing that was just
--     deliberately not done.
--   • A FORCE-CLOSED order has status='closed' with dc_status null, so it mailed
--     "Delivered - SO-…" and "confirmed the delivery" for an order nobody
--     delivered.
--
-- Both now have their own arms, reaching the subject, headline, action and CTA —
-- an eyebrow alone does not fix a wrong sentence.
--
-- fms_dispatch_announce itself references nothing that was dropped and is left
-- exactly as migration 20260801120400 issued it.
-- ===========================================================================

do $$
declare v_o bigint;
begin
  select count(*) into v_o from public.fms_dispatch_orders;
  if v_o > 0 then
    raise exception 'Order to Dispatch holds % order(s). Apply the reshape set only to the never-seeded module.', v_o;
  end if;
end $$;

drop function if exists public.fms_dispatch_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_dispatch_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b text := '/order-to-dispatch';
  r record;
  mr record;
  v_eyebrow text; v_headline text; v_action text; v_subject text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb; v_items jsonb;
  v_label text; v_name text;
  v_next_label text; v_next_queue text;
  v_round integer; v_held boolean; v_early boolean;
begin
  -- ---- master-data governance (unchanged) ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_dispatch_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := replace(coalesce(p_meta->>'master_type', mr.master_type), '_', ' ');
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open master requests', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- the sales order ----
  select o.*, c.name as customer_name, co.name as company_name
    into r
    from public.fms_dispatch_orders o
    left join public.fms_dispatch_customers c on c.id = o.customer_id
    left join public.fms_dispatch_companies co on co.id = o.company_id
   where o.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  -- ⚠ The announcing RPC captures round_no BEFORE it increments and passes it in
  --   the meta, because by the time this runs the row already says round N+1.
  --   Reading r.round_no here would head round 1's email "Round 2".
  v_round := coalesce(nullif(p_meta->>'round_no','')::integer, r.round_no);
  v_held  := (r.cc_status = 'credit_hold' and r.cc_at is null);
  v_early := (r.status = 'closed' and r.closed_reason is not null);

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Order no.','value', r.order_no),
    jsonb_build_object('label','Customer','value', coalesce(r.customer_name,'-')),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Type','value', initcap(r.dispatch_type)),
    jsonb_build_object('label','Order date','value', to_char(r.order_date, 'DD-MM-YYYY')),
    jsonb_build_object('label','Round','value', v_round::text)
  );

  -- The consignment: what is going out on the round in progress. Once a round is
  -- archived its ship_qty is cleared, so this falls back to the ordered quantity
  -- — which is the right thing to show on an order that is between rounds.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(it.name, 'Item'),
           'qty', trim(to_char(coalesce(li.ship_qty, li.quantity), 'FM999999990.###')) ||
                  case when coalesce(un.name,'') <> '' then ' ' || un.name else '' end
         ) order by li.line_no), '[]'::jsonb)
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
    left join public.fms_dispatch_units un on un.id = li.unit_id
   where li.order_id = r.id;

  v_next_label := case r.current_step
                    when 'credit_check'     then 'Credit Confirmation'
                    when 'material_status'  then 'Material Status Check'
                    when 'sales_bill'       then 'Sales Bill'
                    when 'gate_out'         then 'Gate Outward Entry'
                    when 'dispatch_confirm' then 'Dispatch Confirmation'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'credit_check'     then '/queues/credit-check'
                    when 'material_status'  then '/queues/material-status'
                    when 'sales_bill'       then '/queues/sales-bill'
                    when 'gate_out'         then '/queues/gate-out'
                    when 'dispatch_confirm' then '/queues/dispatch-confirm'
                    else '/orders/' || r.id::text end;

  v_eyebrow := case p_type
                 when 'raised'             then 'New sales order'
                 when 'credit_checked'     then 'Credit approved'
                 when 'credit_on_hold'     then 'Credit on hold'
                 when 'material_checked'   then 'Stock confirmed'
                 when 'material_pending'   then 'Nothing available yet'
                 when 'billed'             then 'Sales bill raised'
                 when 'gate_out'           then 'Out of the gate'
                 when 'dispatched'         then 'Delivered'
                 when 'dispatch_returned'  then 'Returned'
                 when 'round_amended'      then 'Round corrected'
                 when 'closed_early'       then 'Closed early'
                 when 'held'               then 'On hold'
                 when 'resumed'            then 'Resumed'
                 when 'cancelled'          then 'Cancelled'
                 else 'Order update' end;

  if v_held then
    -- The order sits at awaiting_credit_check but is deliberately NOT due.
    v_headline  := 'Order ' || r.order_no || ' is on hold at credit';
    v_action    := 'put an order on hold at the credit check';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Credit hold - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif v_early then
    v_headline  := 'Order ' || r.order_no || ' was closed with a balance outstanding';
    v_action    := 'closed an order early';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Closed early - ' || r.order_no;
  elsif r.status = 'closed' then
    v_headline  := 'Order ' || r.order_no || ' is closed';
    v_action    := 'confirmed the final delivery';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Delivered - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif r.status in ('on_hold','cancelled') then
    v_headline  := 'Order ' || r.order_no || ' is ' || replace(r.status, '_', ' ');
    v_action    := replace(r.status, '_', ' ') || ' an order';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := initcap(replace(r.status, '_', ' ')) || ' - ' || r.order_no;
  elsif p_type = 'dispatch_returned' then
    -- A returned round that looped: the order is back at the material check.
    v_headline  := 'Round ' || v_round || ' of ' || r.order_no || ' came back';
    v_action    := 'recorded a returned consignment';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Returned - ' || r.order_no || ' (round ' || v_round || ')';
  elsif p_type = 'material_pending' then
    v_headline  := r.order_no || ' has no stock available yet';
    v_action    := 'checked stock and found nothing available';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Awaiting stock - ' || r.order_no;
  else
    v_headline  := r.order_no || ' is ready for ' || v_next_label;
    v_action    := 'moved an order to ' || v_next_label;
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := v_next_label || ' due - ' || r.order_no ||
                   ' (' || coalesce(r.customer_name,'customer') || ')';
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', 'Order ' || r.order_no,
    'rows',     v_rows,
    'items',    v_items,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(p_text),'') <> ''
          then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
          else '{}'::jsonb end;
end $$;
grant execute on function public.fms_dispatch_email_payload(text, uuid, text, text, jsonb) to authenticated;
