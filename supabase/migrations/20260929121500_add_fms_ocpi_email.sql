-- ===========================================================================
-- Email Alerts — OCPI rollout (enqueue + server-side content).
--
-- Every OCPI event already fans through ONE RPC, public.fms_ocpi_announce. This
-- re-issues it to ALSO drop an email_outbox row per recipient, so email goes
-- exactly where a bell goes and nowhere else. The content is authored HERE in
-- SQL by fms_ocpi_email_payload() — the sampling / supplies / dispatch / asset
-- pattern — so there is no frontend emailMeta wiring at all.
--   kind = 'ocpi_' || p_type
--   GATE: email_module_enabled('ocpi'), seeded OFF by 20260929120300.
--
-- ⚠ THE GATE IS OFF AND STAYS OFF UNTIL SOMEBODY TURNS IT ON. OCPI mails
--   quotation and contract events to salespeople and management; switching it on
--   during a backlog import would mail the company about deals that were entered
--   for history. Settings → Email notifications is the switch, and it is
--   deliberately the last thing wired.
--
-- ⚠ CORRECTIONS ARE BELL-ONLY, and here that rule does real work: the one
--   correction this module has (`signed_doc_edited`) already announces with an
--   EMPTY recipient list, so it reaches nobody either way. The `%edited` guard
--   stays as the standing rule the other nine modules keep, so a future
--   correction cannot become mail by being added.
--
-- ⚠ NO AMOUNT IS PUT IN A SUBJECT LINE. Subjects are logged by mail servers,
--   shown on lock screens and quoted in replies; the deal value belongs in the
--   body, behind a login. Every other FMS does the same.
--
-- Requires supabase/functions/send-email/index.ts to list the 'ocpi_' prefix in
-- its generic FMS renderer, or these rows fall to the fallback and lose their
-- branding.
--
-- Reversal:
--   re-apply 20260929120000_add_fms_ocpi_foundations.sql (restores the
--   un-enqueuing announce body), then
--   drop function if exists public.fms_ocpi_email_payload(text, uuid, text, text, jsonb);
-- ===========================================================================

begin;

insert into public.email_module_settings (module_id, enabled)
values ('ocpi', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Email content, authored from the deal row.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_ocpi_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_ocpi_email_payload(
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
as $fn$
declare
  b text := '/ocpi';
  r record;
  v_ref       text;
  v_eyebrow   text;
  v_headline  text;
  v_action    text;
  v_subject   text;
  v_cta_label text;
  v_cta_path  text;
  v_rows      jsonb;
  v_value     text;
begin
  select d.*, m.name as machine_name
    into r
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  -- The human reference, same precedence the app uses: the OC number once one
  -- exists, else the quotation number, else the customer's name.
  v_ref := coalesce(r.oc_no, r.quotation_no, r.customer_name, 'Deal');

  v_value := case
               when r.deal_value_amount is null then '-'
               when r.deal_value_currency = 'USD'
                 then '$ ' || trim(to_char(r.deal_value_amount, 'FM99,99,99,990.00'))
               else 'Rs. ' || trim(to_char(r.deal_value_amount, 'FM99,99,99,990.00'))
             end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label', 'Customer',   'value', coalesce(r.customer_name, '-')),
    jsonb_build_object('label', 'Machine',    'value', coalesce(r.machine_name, '-')),
    jsonb_build_object('label', 'Deal value', 'value', v_value)
  );
  if coalesce(r.quotation_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Quotation', 'value', r.quotation_no));
  end if;
  if coalesce(r.oc_no, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Order confirmation', 'value', r.oc_no));
  end if;
  if coalesce(r.salesperson_name, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Salesperson', 'value', r.salesperson_name));
  end if;

  -- ⚠ ONE BRANCH PER EVENT, and each names the ACTION the reader has to take.
  --   "QT-M0024 was updated" tells somebody to go and find out what changed;
  --   "QT-M0024 is waiting for your approval" does not.
  if p_type = 'quotation_submitted' then
    v_eyebrow := 'Quotation';
    v_headline := v_ref || ' is waiting for your approval';
    v_action := 'sent a quotation for approval';
    v_subject := 'Approval needed - quotation ' || v_ref;
    v_cta_label := 'Review the quotation';
    v_cta_path := b || '/queues/approve-quotation';

  elsif p_type = 'quotation_approved' then
    v_eyebrow := 'Quotation approved';
    v_headline := v_ref || ' was approved - fill in the order confirmation';
    v_action := 'approved a quotation';
    v_subject := 'Approved - quotation ' || v_ref;
    v_cta_label := 'Open the order confirmation';
    v_cta_path := b || '/deals/' || r.id::text || '/order-confirmation';

  elsif p_type in ('quotation_rejected', 'quotation_returned') then
    v_eyebrow := case when p_type = 'quotation_rejected' then 'Quotation rejected' else 'Sent back' end;
    v_headline := v_ref || case when p_type = 'quotation_rejected'
                                then ' was rejected' else ' was sent back for changes' end;
    v_action := case when p_type = 'quotation_rejected' then 'rejected a quotation'
                     else 'sent a quotation back' end;
    v_subject := case when p_type = 'quotation_rejected'
                      then 'Rejected - quotation ' || v_ref
                      else 'Changes needed - quotation ' || v_ref end;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type = 'oc_submitted' then
    v_eyebrow := 'Order confirmation';
    v_headline := v_ref || ' is waiting to be confirmed';
    v_action := 'sent an order confirmation for approval';
    v_subject := 'Approval needed - order confirmation ' || v_ref;
    v_cta_label := 'Review the order confirmation';
    v_cta_path := b || '/queues/approve-oc';

  elsif p_type = 'oc_approved' then
    v_eyebrow := 'Confirmed';
    v_headline := v_ref || ' was confirmed - print it and get the customer to sign';
    v_action := 'confirmed an order confirmation';
    v_subject := 'Confirmed - print and get signed: ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type in ('oc_rejected', 'oc_returned') then
    v_eyebrow := case when p_type = 'oc_rejected' then 'Rejected' else 'Sent back' end;
    v_headline := v_ref || case when p_type = 'oc_rejected'
                                then ' was rejected' else ' was sent back for changes' end;
    v_action := case when p_type = 'oc_rejected' then 'rejected an order confirmation'
                     else 'sent an order confirmation back' end;
    v_subject := case when p_type = 'oc_rejected'
                      then 'Rejected - order confirmation ' || v_ref
                      else 'Changes needed - order confirmation ' || v_ref end;
    v_cta_label := 'Open the order confirmation';
    v_cta_path := b || '/deals/' || r.id::text || '/order-confirmation';

  elsif p_type = 'customer_signed' then
    v_eyebrow := 'Signed by the customer';
    v_headline := v_ref || ' has been signed and needs countersigning';
    v_action := 'filed a customer-signed order confirmation';
    v_subject := 'Countersignature needed - ' || v_ref;
    v_cta_label := 'Countersign it';
    v_cta_path := b || '/queues/management-signature';

  elsif p_type = 'signature_returned' then
    v_eyebrow := 'Sent back';
    v_headline := 'The signed copy of ' || v_ref || ' was sent back';
    v_action := 'sent a signed copy back';
    v_subject := 'Re-scan needed - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type = 'deal_closed' then
    v_eyebrow := 'Complete';
    v_headline := v_ref || ' has been countersigned - the deal is complete';
    v_action := 'countersigned an order confirmation';
    v_subject := 'Complete - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  elsif p_type in ('deal_held', 'deal_resumed', 'deal_cancelled') then
    v_eyebrow := case p_type when 'deal_held' then 'On hold'
                             when 'deal_resumed' then 'Resumed'
                             else 'Cancelled' end;
    v_headline := v_ref || case p_type when 'deal_held' then ' was put on hold'
                                       when 'deal_resumed' then ' is off hold'
                                       else ' was cancelled' end;
    v_action := case p_type when 'deal_held' then 'put a deal on hold'
                            when 'deal_resumed' then 'took a deal off hold'
                            else 'cancelled a deal' end;
    v_subject := v_eyebrow || ' - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;

  else
    -- Unknown type: still deliverable, still says which deal, never invents a
    -- next action it cannot vouch for.
    v_eyebrow := 'OCPI';
    v_headline := coalesce(nullif(btrim(coalesce(p_text, '')), ''), v_ref || ' was updated');
    v_action := 'updated a deal';
    v_subject := 'OCPI - ' || v_ref;
    v_cta_label := 'Open the deal';
    v_cta_path := b || '/deals/' || r.id::text;
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', v_ref,
    'rows',     v_rows,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(coalesce(p_text, '')), '') <> ''
          then jsonb_build_object('note', jsonb_build_object('label', 'Update', 'text', p_text))
          else '{}'::jsonb end;
end $fn$;

comment on function public.fms_ocpi_email_payload(text, uuid, text, text, jsonb) is
  'Email body for one OCPI event, authored from the deal row. Consumed by fms_ocpi_announce and rendered by the shared FMS renderer in send-email.';
grant execute on function public.fms_ocpi_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue fms_ocpi_announce with the gated enqueue. The body is verbatim from
-- 20260929120000_add_fms_ocpi_foundations.sql plus the email block.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_announce(
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
as $fn$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := false;
  v_payload jsonb;
  v_email text;
begin
  insert into public.fms_ocpi_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('ocpi') and p_type not like '%edited';
  exception when others then v_email_on := false;
  end;

  if v_email_on then
    begin
      v_payload := public.fms_ocpi_email_payload(
        p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_ocpi_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- Email the same recipient, only when this module's gate is on. Isolated
      -- so a mail problem can never roll back the work it is reporting: a failed
      -- outbox insert must not undo an approval.
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('ocpi_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $fn$;

comment on function public.fms_ocpi_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one OCPI event: an activity row always, one notification per recipient, and — when email_module_enabled(''ocpi'') — one email_outbox row per recipient. Pass an EMPTY recipient list for a correction.';
grant execute on function public.fms_ocpi_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------- assertions --
do $$
declare v_on boolean;
begin
  select enabled into v_on from public.email_module_settings where module_id = 'ocpi';
  if v_on is distinct from false then
    raise exception 'OCPI email must install switched OFF, and it is %', v_on;
  end if;
end $$;

commit;
