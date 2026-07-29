-- ===========================================================================
-- GENERAL PURCHASE FMS — the email copy catches up with the rename.
--
-- WHY
--   The module shown as "Purchase Office Supplies" at /office-supplies is now
--   "General Purchase" at /general-purchase: it had outgrown its name, being
--   used for company purchases generally rather than office supplies alone.
--
--   The DISPLAY layer moved; the IDENTIFIERS did NOT, deliberately. The app id
--   'office-supplies', every fms_supplies_* table and RPC, the 'office-supplies_'
--   email_outbox kind prefix and the SUPPLY-2627-0001 document prefix are all
--   unchanged — renaming any of them revokes access, orphans rows or renumbers
--   live documents.
--
--   That leaves ONE place where the old wording is baked into the database:
--   fms_supplies_email_payload authors the whole email server-side (subject,
--   eyebrow, headline, action, ctaPath), so eleven strings and the base path
--   would keep saying "office supplies" long after every screen had stopped.
--
--   ⚠ ctaPath is frozen at ENQUEUE time, not built at render. Rows already
--     queued keep '/office-supplies/...' forever, which is why App.tsx redirects
--     the old base — that redirect is load-bearing, not a courtesy.
--
-- LIVE VERSION
--   20260726130000_add_fms_supplies_email.sql defines this function;
--   20260726150000_fms_notify_self_on_own_steps.sql re-issued only the announce
--   RPC around it and CALLS this one without redefining it. The body below is
--   that body VERBATIM — the lines marked CHANGED are the only difference.
--
-- GATE: email_module_settings('office-supplies') is still seeded false, so no
-- live mail changes today. This is here so it reads right on the day an admin
-- turns it on.
--
-- Additive: no table, column or row is touched. The signature is unchanged, so
-- `create or replace` alone — no drop (which would revoke the existing
-- `grant execute ... to authenticated`) and therefore no re-grant.
-- ===========================================================================

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
  b text := '/general-purchase';   -- CHANGED (was '/office-supplies')
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
    v_eyebrow := 'New request'; v_action := 'raised a general purchase request';   -- CHANGED
    if r.status = 'pending_handover' then
      v_headline  := 'A purchase request is ready to hand over';                   -- CHANGED
      v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    else
      v_headline  := 'A purchase request needs your approval';                     -- CHANGED
      v_cta_label := 'Open First-approval queue'; v_cta_path := b || '/queues/first-approval';
    end if;
    v_subject := 'New purchase request - ' || coalesce(nullif(btrim(r.item_name),''), v_cat);  -- CHANGED
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
    v_headline := 'Your purchase request was rejected';       -- CHANGED
    v_subject := 'Your purchase request was rejected';        -- CHANGED
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
    v_headline := 'Your purchase request was delivered';      -- CHANGED
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
    v_eyebrow := 'General Purchase'; v_action := 'updated a request';                    -- CHANGED
    v_headline := coalesce(nullif(btrim(p_text),''), 'General Purchase update');         -- CHANGED
    v_subject := 'General Purchase: ' || v_headline;                                     -- CHANGED
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
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'General Purchase update'));  -- CHANGED
end $$;
