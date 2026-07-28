-- ===========================================================================
-- Email Alerts — Order to Dispatch FMS rollout (enqueue + server-side content
-- + the customer-facing planned-dispatch mail).
--
-- TWO DISTINCT PATHS, deliberately switched apart:
--
--  1. INTERNAL step alerts. Every workflow transition fans through ONE RPC,
--     public.fms_dispatch_announce. This re-issues it to ALSO drop an
--     email_outbox row per recipient, so email goes exactly where a new bell
--     goes. Content is authored HERE in SQL by fms_dispatch_email_payload()
--     (single entity, server-announced — the sampling / supplies / production
--     pattern), so there is no frontend emailMeta wiring at all.
--     kind = 'order-to-dispatch_' || p_type.
--     GATE: email_module_enabled('order-to-dispatch'), seeded OFF below.
--     Corrections (`%edited`) stay bell-only, matching the other FMS apps.
--
--  2. The CUSTOMER mail — the first outbound message this portal sends to
--     someone outside the company. Fired from the material-status step, and only
--     when the store keeper ticks the box. It needs BOTH the module gate above
--     AND its own `fms_dispatch_config.customer_mail.enabled` arm, because
--     "internal alerts on" must never imply "start mailing customers".
--     Requires 20260801120300 (email_outbox.to_user_id nullable).
--
-- Additive + reversible: re-apply 20260801120000_add_fms_dispatch_foundations.sql
-- to restore the un-enqueuing announce body; delete the seeded settings row to
-- remove the gate; drop the two mail functions.
-- ===========================================================================

insert into public.email_module_settings (module_id, enabled)
values ('order-to-dispatch', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-step INTERNAL email content, authored from the order / master-request row.
-- Keys off the row's current_step (which already points at the NEXT due step when
-- the alert fires) for the headline + CTA; status='closed' ends the line.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_dispatch_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_dispatch_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/order-to-dispatch';
  r record;
  mr record;
  v_eyebrow text; v_headline text; v_action text; v_subject text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb; v_items jsonb;
  v_label text; v_name text;
  v_next_label text; v_next_queue text;
begin
  -- ---- master-data governance ----
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

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Order no.','value', r.order_no),
    jsonb_build_object('label','Customer','value', coalesce(r.customer_name,'-')),
    jsonb_build_object('label','Type','value', initcap(r.dispatch_type)),
    jsonb_build_object('label','Order date','value', to_char(r.order_date, 'DD-MM-YYYY')),
    jsonb_build_object('label','Promised dispatch','value',
      case when r.promised_date is null then '-' else to_char(r.promised_date, 'DD-MM-YYYY') end)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(it.name, 'Item'),
           'qty', trim(to_char(coalesce(li.final_qty, li.quantity), 'FM999999990.###')) ||
                  case when coalesce(un.name,'') <> '' then ' ' || un.name else '' end
         ) order by li.line_no), '[]'::jsonb)
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
    left join public.fms_dispatch_units un on un.id = coalesce(li.final_unit_id, li.unit_id)
   where li.order_id = r.id;

  -- Map the row's next due step -> friendly label + queue path.
  v_next_label := case r.current_step
                    when 'credit_check'     then 'Credit Confirmation'
                    when 'material_status'  then 'Material Status Check'
                    when 'lot_confirm'      then 'LOT No. & Final Qty'
                    when 'sales_bill'       then 'Sales Bill'
                    when 'gate_out'         then 'Gate Out Entry'
                    when 'dispatch_confirm' then 'Dispatch Confirmation'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'credit_check'     then '/queues/credit-check'
                    when 'material_status'  then '/queues/material-status'
                    when 'lot_confirm'      then '/queues/lot-confirm'
                    when 'sales_bill'       then '/queues/sales-bill'
                    when 'gate_out'         then '/queues/gate-out'
                    when 'dispatch_confirm' then '/queues/dispatch-confirm'
                    else '/orders/' || r.id::text end;

  -- Eyebrow = what just happened (the step that was completed).
  v_eyebrow := case p_type
                 when 'raised'            then 'New sales order'
                 when 'credit_checked'    then 'Credit confirmed'
                 when 'material_checked'  then 'Material checked'
                 when 'lot_confirmed'     then 'LOT confirmed'
                 when 'billed'            then 'Sales bill raised'
                 when 'gate_out'          then 'Out of the gate'
                 when 'dispatched'        then 'Delivered'
                 when 'dispatch_returned' then 'Returned'
                 when 'held'              then 'On hold'
                 when 'resumed'           then 'Resumed'
                 when 'cancelled'         then 'Cancelled'
                 else 'Order update' end;

  if r.status = 'closed' then
    v_headline   := 'Order ' || r.order_no || ' is closed';
    v_action     := case when r.dc_status = 'returned' then 'recorded a returned consignment'
                         else 'confirmed the delivery' end;
    v_cta_label  := 'Open the order';
    v_cta_path   := b || '/orders/' || r.id::text;
    v_subject    := case when r.dc_status = 'returned'
                         then 'Returned - ' || r.order_no
                         else 'Delivered - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')' end;
  elsif r.status in ('on_hold','cancelled') then
    v_headline   := 'Order ' || r.order_no || ' is ' || replace(r.status, '_', ' ');
    v_action     := replace(r.status, '_', ' ') || ' an order';
    v_cta_label  := 'Open the order';
    v_cta_path   := b || '/orders/' || r.id::text;
    v_subject    := initcap(replace(r.status, '_', ' ')) || ' - ' || r.order_no;
  else
    v_headline   := r.order_no || ' is ready for ' || v_next_label;
    v_action     := 'moved an order to ' || v_next_label;
    v_cta_label  := 'Open ' || v_next_label;
    v_cta_path   := b || v_next_queue;
    v_subject    := v_next_label || ' due - ' || r.order_no ||
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

-- ---------------------------------------------------------------------------
-- Re-issue fms_dispatch_announce with the gated enqueue. Body is verbatim from
-- 20260801120000_add_fms_dispatch_foundations.sql plus the email block.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_dispatch_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_dispatch_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := false;
  v_payload jsonb;
  v_email text;
begin
  insert into public.fms_dispatch_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('order-to-dispatch') and p_type not like '%edited';
  exception when others then v_email_on := false;
  end;

  if v_email_on then
    begin
      v_payload := public.fms_dispatch_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_dispatch_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- Email the same recipient, only when this module's email gate is on.
      -- Isolated so a mail problem can never roll back the work.
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('order-to-dispatch_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_dispatch_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- THE CUSTOMER MAIL
-- ===========================================================================

-- Render a template's tokens against an order. The frontend's
-- lib/customerMail.ts renders an IDENTICAL preview so nobody sends blind —
-- keep the token list in step between the two.
create or replace function public.fms_dispatch_render_mail_template(p_template uuid, p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  r record;
  v_items text;
  v_subject text;
  v_body text;
  v_planned text;
begin
  select * into t from public.fms_dispatch_mail_templates where id = p_template;
  if not found then return null; end if;

  select o.*, c.name as customer_name into r
    from public.fms_dispatch_orders o
    left join public.fms_dispatch_customers c on c.id = o.customer_id
   where o.id = p_order;
  if not found then return null; end if;

  select coalesce(string_agg(
           '- ' || coalesce(it.name, 'Item') || ' - ' ||
           trim(to_char(coalesce(li.final_qty, li.quantity), 'FM999999990.###')) ||
           case when coalesce(un.name,'') <> '' then ' ' || un.name else '' end,
           chr(10) order by li.line_no), '-')
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
    left join public.fms_dispatch_units un on un.id = coalesce(li.final_unit_id, li.unit_id)
   where li.order_id = r.id;

  v_planned := to_char(coalesce(r.ms_planned_dispatch_date, r.promised_date, r.order_date), 'DD-MM-YYYY');

  -- Token substitution. Keep this list in step with the frontend preview in
  -- apps/order-to-dispatch/lib/customerMail.ts — a token one side does not know
  -- about would render literally in the mail the customer actually receives.
  v_subject := replace(replace(replace(replace(replace(replace(coalesce(t.subject, ''),
    '{{customer}}',              coalesce(r.customer_name, 'Customer')),
    '{{order_no}}',              r.order_no),
    '{{order_date}}',            to_char(r.order_date, 'DD-MM-YYYY')),
    '{{planned_dispatch_date}}', v_planned),
    '{{items}}',                 coalesce(v_items, '-')),
    '{{type}}',                  initcap(r.dispatch_type));

  v_body := replace(replace(replace(replace(replace(replace(coalesce(t.body, ''),
    '{{customer}}',              coalesce(r.customer_name, 'Customer')),
    '{{order_no}}',              r.order_no),
    '{{order_date}}',            to_char(r.order_date, 'DD-MM-YYYY')),
    '{{planned_dispatch_date}}', v_planned),
    '{{items}}',                 coalesce(v_items, '-')),
    '{{type}}',                  initcap(r.dispatch_type));

  return jsonb_build_object(
    'subject', v_subject,
    'body', v_body,
    'orderNo', r.order_no,
    'customer', coalesce(r.customer_name,'Customer'),
    'orderDate', to_char(r.order_date, 'DD-MM-YYYY'),
    'plannedDate', v_planned,
    'type', initcap(r.dispatch_type)
  );
end $$;
grant execute on function public.fms_dispatch_render_mail_template(uuid, uuid) to authenticated;

-- Queue the planned-dispatch mail to the CUSTOMER. Returns the outbox row id, or
-- null when nothing was queued (no address, no template, or the arm is off) —
-- in which case the reason is stamped on the order so the omission is visible.
create or replace function public.fms_dispatch_mail_customer(p_order uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_armed boolean := false;
  v_module boolean := false;
  v_code text;
  t record;
  r record;
  v_email text;
  v_rendered jsonb;
  v_items jsonb;
  v_outbox uuid;
begin
  select coalesce((value->>'enabled')::boolean, false), coalesce(value->>'template_code', 'dispatch_plan')
    into v_armed, v_code
    from public.fms_dispatch_config where key = 'customer_mail';

  begin
    v_module := public.email_module_enabled('order-to-dispatch');
  exception when others then v_module := false;
  end;

  if not coalesce(v_armed, false) then
    update public.fms_dispatch_orders set ms_mail_skipped_reason = 'Customer mail is switched off' where id = p_order;
    return null;
  end if;
  if not v_module then
    update public.fms_dispatch_orders set ms_mail_skipped_reason = 'Module email is switched off' where id = p_order;
    return null;
  end if;

  select o.*, c.name as customer_name, nullif(btrim(c.email), '') as customer_email into r
    from public.fms_dispatch_orders o
    left join public.fms_dispatch_customers c on c.id = o.customer_id
   where o.id = p_order;
  if not found then return null; end if;

  if r.customer_email is null then
    update public.fms_dispatch_orders
       set ms_mail_skipped_reason = 'No email on file for this customer'
     where id = p_order;
    return null;
  end if;

  select * into t from public.fms_dispatch_mail_templates where code = v_code and active;
  if not found then
    update public.fms_dispatch_orders set ms_mail_skipped_reason = 'No active mail template' where id = p_order;
    return null;
  end if;

  v_rendered := public.fms_dispatch_render_mail_template(t.id, p_order);
  if v_rendered is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(it.name, 'Item'),
           'qty', trim(to_char(coalesce(li.final_qty, li.quantity), 'FM999999990.###')) ||
                  case when coalesce(un.name,'') <> '' then ' ' || un.name else '' end
         ) order by li.line_no), '[]'::jsonb)
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
    left join public.fms_dispatch_units un on un.id = coalesce(li.final_unit_id, li.unit_id)
   where li.order_id = r.id;

  -- to_user_id is NULL — the recipient is external. See 20260801120300.
  insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, entity_id, payload)
  values (
    'order-to-dispatch_customer_dispatch_plan',
    null,
    r.customer_email,
    r.customer_name,
    auth.uid(),
    p_order,
    v_rendered || jsonb_build_object('items', v_items)
  )
  returning id into v_outbox;

  update public.fms_dispatch_orders
     set ms_mail_template_id  = t.id,
         ms_mail_to           = r.customer_email,
         ms_mail_subject      = v_rendered->>'subject',
         ms_mail_queued_at    = now(),
         ms_mail_outbox_id    = v_outbox,
         ms_mail_skipped_reason = null
   where id = p_order;

  return v_outbox;
end $$;
grant execute on function public.fms_dispatch_mail_customer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue the material-status RPCs to offer the customer mail. Bodies are
-- verbatim from 20260801120100 / 20260801120200 plus the one guarded call.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_record_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_ms text := nullif(trim(p->>'ms_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;
  if v_ms is null or v_ms not in ('available_for_dispatch','production_required') then
    raise exception 'Record the material status: Available for Dispatch or Production Required';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date           = coalesce(nullif(p->>'ms_actual_date','')::date, current_date),
    ms_status                = v_ms,
    ms_godown_id             = nullif(p->>'ms_godown_id','')::uuid,
    ms_planned_dispatch_date = nullif(p->>'ms_planned_dispatch_date','')::date,
    ms_remarks               = nullif(trim(p->>'ms_remarks'), ''),
    ms_at = coalesce(ms_at, now()), ms_by = coalesce(ms_by, v_uid),
    status = 'awaiting_lot_confirm', current_step = 'lot_confirm'
  where id = p_order;

  perform public.fms_dispatch_apply_ms_lines(p_order, p->'lines');

  -- The customer mail. Opt-in per save, and isolated so a mail failure can never
  -- roll back the step the store keeper just recorded.
  if coalesce(p->>'ms_notify_customer', 'false') = 'true' then
    begin
      perform public.fms_dispatch_mail_customer(p_order);
    exception when others then null;
    end;
  end if;

  perform public.fms_dispatch_announce(
    'order', p_order, 'material_checked',
    'Material status recorded on ' || coalesce(v_no,'an order') || ' - awaiting LOT no. and final quantity.',
    public.fms_dispatch_step_owner_ids('lot_confirm'),
    jsonb_build_object('order_no', v_no, 'ms_status', v_ms)
  );
end $$;
grant execute on function public.fms_dispatch_record_material_status(uuid, jsonb) to authenticated;

create or replace function public.fms_dispatch_update_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_ms text := nullif(trim(p->>'ms_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to edit the material status'; end if;
  if not public.fms_dispatch_ms_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its material status can no longer be changed.'; end if;
    raise exception 'The material status can no longer be edited: LOT confirmation has already been recorded (status %).', v_status;
  end if;
  if v_ms is not null and v_ms not in ('available_for_dispatch','production_required') then
    raise exception 'The material status must be Available for Dispatch or Production Required';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date           = coalesce(nullif(p->>'ms_actual_date','')::date, ms_actual_date),
    ms_status                = coalesce(v_ms, ms_status),
    ms_godown_id             = nullif(p->>'ms_godown_id','')::uuid,
    ms_planned_dispatch_date = nullif(p->>'ms_planned_dispatch_date','')::date,
    ms_remarks               = nullif(trim(p->>'ms_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_apply_ms_lines(p_order, p->'lines');

  -- A correction can send the mail if it was not sent the first time (e.g. the
  -- planned date changed, or the customer's address was only just added).
  if coalesce(p->>'ms_notify_customer', 'false') = 'true' then
    begin
      perform public.fms_dispatch_mail_customer(p_order);
    exception when others then null;
    end;
  end if;

  perform public.fms_dispatch_announce('order', p_order, 'material_checked_edited',
    format('Material status on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_material_status(uuid, jsonb) to authenticated;
