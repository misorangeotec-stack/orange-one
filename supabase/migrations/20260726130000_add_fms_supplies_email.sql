-- Email Alerts — Office Supplies FMS rollout (enqueue + server-side content).
--
-- WHY
--   Office Supplies fans every workflow transition through ONE RPC,
--   public.fms_supplies_announce (called both server-side for the raise/edits and
--   client-side for approvals/handover/master governance). This re-issues that RPC
--   to ALSO drop an email_outbox row per recipient — so email goes exactly where a
--   new Office Supplies bell goes, inheriting the self-skip + de-dup.
--
--   Because a request is a SINGLE entity and the most important alert (raise) is
--   server-side, the rich per-step content is authored HERE in SQL by
--   fms_supplies_email_payload(entity, type, ...) which reads the request (or
--   master-request) row. So there is NO frontend emailMeta / store wiring — the
--   payload is carried into email_outbox.payload and rendered by the send-email
--   function's shared FMS template. kind = 'office-supplies_' || p_type.
--
-- GATE: only fires when email_module_enabled('office-supplies'); seeded OFF below,
-- so nothing emails until an admin flips Office Supplies → Setup → Notifications.
-- Corrections (`%edited` types) stay bell-only, matching the other FMS apps.
--
-- Additive + reversible: re-apply 20260715160000_add_fms_supplies_foundations.sql
-- to restore the un-enqueuing body; delete the seeded row to remove the gate.

insert into public.email_module_settings (module_id, enabled)
values ('office-supplies', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-step email content, authored from the request / master-request row.
-- Returns a payload with the keys the send-email FMS renderer reads
-- (subject/eyebrow/headline/action/docLabel/rows/note/ctaLabel/ctaPath).
-- ---------------------------------------------------------------------------
drop function if exists public.fms_supplies_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_supplies_email_payload(
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
  b text := '/office-supplies';
  r record;
  mr record;
  v_cat text;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_supplies_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := case when coalesce(p_meta->>'masterType', mr.master_type) = 'service_type'
                    then 'service type' else 'item' end;
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
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- request workflow ----
  select req.*,
         c.name  as company_name,
         d.name  as dept_name,
         cat.name as category_name,
         st.name as service_name
    into r
    from public.fms_supplies_requests req
    left join public.fms_supplies_companies     c   on c.id  = req.company_id
    left join public.fms_supplies_departments   d   on d.id  = req.department_id
    left join public.fms_supplies_categories    cat on cat.id = req.category_id
    left join public.fms_supplies_service_types st  on st.id  = req.service_type_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_cat := coalesce(r.category_name, r.service_name, '-');
  v_doc := 'Request #' || r.req_no;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Item','value', coalesce(nullif(btrim(r.item_name),''), '-')),
    jsonb_build_object('label','Quantity','value', coalesce(r.quantity,'-')),
    jsonb_build_object('label', case when r.request_type = 'services_maintenance' then 'Service' else 'Category' end,
                       'value', v_cat),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Department','value', coalesce(r.dept_name,'-')),
    jsonb_build_object('label','Location','value', coalesce(r.location,'-')),
    jsonb_build_object('label','Requested for','value', coalesce(r.requested_for_name,'-'))
  );

  if p_type = 'raised' then
    v_eyebrow := 'New request'; v_action := 'raised an office-supplies request';
    if r.status = 'pending_handover' then
      v_headline  := 'A supplies request is ready to hand over';
      v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    else
      v_headline  := 'A supplies request needs your approval';
      v_cta_label := 'Open First-approval queue'; v_cta_path := b || '/queues/first-approval';
    end if;
    v_subject := 'New office-supplies request - ' || coalesce(nullif(btrim(r.item_name),''), v_cat);
    if coalesce(btrim(r.reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Reason','text', r.reason));
    end if;

  elsif p_type = 'first_approved' then
    v_eyebrow := 'First approval'; v_action := 'gave the first approval';
    v_headline := 'First approval done - ready for management approval';
    v_subject := 'Approved (1/2) - ready for management (' || v_doc || ')';
    v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    if coalesce(btrim(r.first_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','HOD remark','value', r.first_remarks));
    end if;

  elsif p_type = 'second_approved' then
    v_eyebrow := 'Second approval'; v_action := 'gave the second approval';
    v_headline := 'Approved - ready for handover';
    v_subject := 'Approved - ready for handover (' || v_doc || ')';
    v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    if coalesce(btrim(r.second_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Management remark','value', r.second_remarks));
    end if;

  elsif p_type in ('first_rejected','second_rejected') then
    v_eyebrow := 'Rejected'; v_action := 'rejected a request';
    v_headline := 'Your supplies request was rejected';
    v_subject := 'Your office-supplies request was rejected';
    v_cta_label := 'Open my request'; v_cta_path := b || '/requests/' || r.id::text;
    if coalesce(btrim(r.reject_reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object(
        'label', 'Reason' || case when r.reject_stage = 'first_approval' then ' (first approval)'
                                   when r.reject_stage = 'second_approval' then ' (second approval)'
                                   else '' end,
        'text', r.reject_reason));
    end if;

  elsif p_type = 'delivered' then
    v_eyebrow := 'Delivered'; v_action := 'handed over the items';
    v_headline := 'Your supplies request was delivered';
    v_subject := 'Delivered - ' || v_doc;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
    if r.actual_delivery_date is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Delivered on','value', to_char(r.actual_delivery_date,'DD-MM-YYYY')));
    end if;
    if coalesce(btrim(r.handover_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Handover note','text', r.handover_remarks));
    end if;

  else
    -- unknown / future type: a clean minimal email from the bell text
    v_eyebrow := 'Office Supplies'; v_action := 'updated a request';
    v_headline := coalesce(nullif(btrim(p_text),''), 'Office Supplies update');
    v_subject := 'Office Supplies: ' || v_headline;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  -- content is best-effort: never let a payload glitch break the announce
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'Office Supplies update'));
end $$;
grant execute on function public.fms_supplies_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue the announce RPC (body verbatim from foundations) + email enqueue.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_supplies_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_supplies_announce(
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
  v_email_on boolean := public.email_module_enabled('office-supplies');
  v_email text;
  v_payload jsonb;
begin
  insert into public.fms_supplies_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Build the rich email payload once (corrections stay bell-only).
  if v_email_on and p_type not like '%edited' then
    v_payload := public.fms_supplies_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_supplies_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- (new) email the same recipient, only when Office Supplies email is enabled.
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('office-supplies_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_supplies_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
