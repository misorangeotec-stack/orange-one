-- ===========================================================================
-- Complaint (RM/FG) FMS — EMAIL (Phase 9).
--
-- Re-issues fms_complaint_announce with the gated email_outbox enqueue. The body
-- above the email block is verbatim from 20261110120000.
--
-- ⚠ THE GATE IS email_module_enabled('complaint'), AND IT SHIPS OFF. The row was
--   seeded false in phase 2; this migration asserts it is still false. A module
--   that starts mailing the day it deploys tells people about a process they
--   have not been trained on.
--
-- ⚠ THE ENQUEUE IS ISOLATED IN ITS OWN exception BLOCK. A mail problem must
--   never roll back the work it is reporting — a failed outbox insert must not
--   undo somebody's resolution.
--
-- ⚠ CORRECTIONS ARE BELL-ONLY. `step_corrected` carries no new work for anyone,
--   so it is excluded from mail. It still lands on the audit trail.
--
-- ⚠ ctaPath IS FROZEN AT ENQUEUE TIME. A queued row already carrying
--   '/complaint/requests/<id>' cannot be rewritten if the module's base path
--   ever moves — App.tsx would have to redirect the old one.
--
-- ⚠ NON-SQL FOLLOW-UP, REQUIRED BEFORE MAIL RENDERS. Two literals in
--   supabase/functions/send-email/index.ts must learn this module:
--     1. add `|| row.kind.startsWith("complaint_")` to the startsWith chain;
--     2. add an isComplaint arm to the appLabel / basePath / tag ternaries
--        → "Complaint (RM/FG)" / "/complaint" / "Quality · Complaint".
--   Then: supabase functions deploy send-email --project-ref icutjkrqkbzwvmnfbzpr
--   Until that lands, a complaint_* row renders with no template and links
--   nowhere. This migration is safe to apply first because the gate is off.
--
-- Reversal: re-apply the fms_complaint_announce definition from 20261110120000.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The payload the shared FMS renderer expects. Kept as its own function so the
-- announce body stays readable and a template change is one edit.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r record;
  v_no    text := coalesce(p_meta->>'complaint_no', '');
  v_party text;
  v_rows  jsonb := '[]'::jsonb;
begin
  select * into r from public.fms_complaint_requests where id = p_entity_id;

  if r.id is not null then
    v_no    := coalesce(nullif(v_no, ''), r.complaint_no);
    v_party := coalesce(r.party_name, '—');

    -- The facts somebody needs to act WITHOUT opening the app. The party and the
    -- invoice re-label by type, exactly as the form does.
    v_rows := jsonb_build_array(
      jsonb_build_object('label', 'Complaint', 'value', coalesce(r.complaint_no, '—')),
      jsonb_build_object('label', 'Type',
        'value', case r.complaint_type when 'finished_good' then 'Finished Good' else 'Raw Material' end),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'Customer' else 'Vendor' end,
        'value', v_party),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'FG Lot No.' else 'RM Lot No.' end,
        'value', coalesce(r.lot_no, '—')),
      jsonb_build_object('label', 'Item', 'value', coalesce(r.item_name, '—')),
      jsonb_build_object('label',
        case r.complaint_type when 'finished_good' then 'Sales Invoice' else 'Purchase Invoice' end,
        'value', coalesce(r.invoice_no, '—')
                 || coalesce(' · ' || to_char(r.invoice_date, 'DD-MM-YYYY'), '')),
      jsonb_build_object('label', 'Severity',
        'value', coalesce(initcap(r.ack_severity), 'not set'))
    );
  end if;

  return jsonb_build_object(
    'subject',  case when v_no <> '' then v_no || ' — ' || coalesce(v_party, 'complaint') else 'Complaint update' end,
    'eyebrow',  'Quality · Complaint',
    'headline', coalesce(nullif(p_text, ''), 'A complaint was updated'),
    'rows',     v_rows,
    'note',     coalesce(r.problem_details, ''),
    'ctaPath',  '/complaint/requests/' || p_entity_id::text,
    'ctaLabel', 'Open the complaint'
  );
end $fn$;
grant execute on function public.fms_complaint_email_payload(text, uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- fms_complaint_announce, re-issued with the gated enqueue.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_announce(
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
  insert into public.fms_complaint_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('complaint') and p_type <> 'step_corrected';
  exception when others then v_email_on := false;
  end;

  -- Only a complaint has a payload to render; a master request is bell-only.
  if v_email_on and p_entity_type = 'request' then
    begin
      v_payload := public.fms_complaint_email_payload(
        p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  else
    v_payload := null;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_complaint_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      /* Email the same recipient, only when this module's gate is on. Isolated
         so a mail problem can never roll back the work it is reporting. */
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('complaint_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $fn$;

comment on function public.fms_complaint_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Complaint event: an activity row always, one notification per recipient, and — when email_module_enabled(''complaint'') — one email_outbox row per recipient. Pass an EMPTY recipient list for a correction; it belongs on the audit trail without paging anyone.';
grant execute on function public.fms_complaint_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;


do $mig$
declare v_on boolean;
begin
  select enabled into v_on from public.email_module_settings where module_id = 'complaint';
  if v_on is null then
    raise exception 'complaint has no email_module_settings row';
  end if;
  if v_on then
    raise exception 'complaint email is ON at install time — it must ship OFF';
  end if;
  raise notice 'Complaint email is installed and OFF.';
end $mig$;

commit;
