-- ===========================================================================
-- Email alerts — Travel Desk rollout (enqueue + server-side content).
--
-- Every Travel Desk event already fans through ONE RPC, `fms_travel_announce`.
-- This re-issues it to ALSO drop an `email_outbox` row per recipient, so email
-- goes exactly where a bell goes and nowhere else. The content is authored HERE
-- in SQL by `fms_travel_email_payload()` — the sampling / supplies / dispatch /
-- asset / OCPI pattern — so there is no frontend `emailMeta` wiring at all.
--   kind = 'travel_' || p_type
--   GATE: email_module_enabled('travel-desk'), seeded OFF by 20261005120100.
--
-- ⚠ THE GATE IS OFF AND STAYS OFF UNTIL SOMEBODY TURNS IT ON. Settings → Email
--   notifications is the switch, and it is deliberately the last thing wired.
--
-- ⚠ NO AMOUNT IN A SUBJECT LINE. Subjects are logged by mail servers, shown on
--   lock screens and quoted in replies. A travel claim carries somebody's hotel
--   bill, their daily allowance and what they were advanced — all of it belongs
--   in the body, behind a login. Every other FMS does the same, and here the
--   reason is stronger: these are figures about a named individual's money.
--
-- ⚠ CORRECTIONS ARE BELL-ONLY. The `%edited` guard is the standing rule the
--   other ten modules keep, so a correction cannot become mail by being added
--   later.
--
-- ⚠ EVERY CTA POINTS AT A PLACE THE RECIPIENT CAN ACTUALLY OPEN. This is defect
--   (C) of 20260905120000 — a notification whose link lands on Access Denied is
--   worse than no notification, because the reader concludes the system is
--   broken rather than that they are not the actor. So an approval mail links to
--   the APPROVAL QUEUE (which only approvers can open, and they are the only
--   recipients), while everything sent to the traveller links to the TRIP, which
--   they can always see.
--
-- Requires supabase/functions/send-email/index.ts to list the 'travel_' prefix
-- in its generic FMS renderer, or these rows fall to the fallback and lose their
-- branding.
--
-- Reversal:
--   re-apply 20261005120000_add_fms_travel_foundations.sql (restores the
--   un-enqueuing announce body), then
--   drop function if exists public.fms_travel_email_payload(text, uuid, text, text, jsonb);
-- ===========================================================================
begin;

insert into public.email_module_settings (module_id, enabled)
values ('travel-desk', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Email content, authored from the trip row.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_travel_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_travel_email_payload(
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
  b text := '/travel-desk';
  r record;
  v_ref       text;
  v_eyebrow   text;
  v_headline  text;
  v_action    text;
  v_subject   text;
  v_cta_label text;
  v_cta_path  text;
  v_rows      jsonb;
  v_dates     text;
begin
  select t.*, c.name as city_name, p.name as purpose_name
    into r
    from public.fms_travel_trips t
    left join public.fms_travel_cities c on c.id = t.destination_city_id
    left join public.fms_travel_purposes p on p.id = t.purpose_id
   where t.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_ref := coalesce(r.trip_no, r.traveller_name, 'Trip');

  v_dates := case
    when r.actual_departure_date is not null and r.actual_return_date is not null
      then to_char(r.actual_departure_date, 'DD Mon') || ' to ' || to_char(r.actual_return_date, 'DD Mon YYYY')
    when r.planned_departure_date is not null and r.planned_return_date is not null
      then to_char(r.planned_departure_date, 'DD Mon') || ' to ' || to_char(r.planned_return_date, 'DD Mon YYYY')
    when r.planned_departure_date is not null
      then to_char(r.planned_departure_date, 'DD Mon YYYY')
    else '-' end;

  /*
    The rows a reader needs to decide WITHOUT opening the app. Deliberately not
    the whole trip: a mail that reprints the record is one nobody reads, and one
    that leaks a person's spend into an inbox thread.
  */
  v_rows := jsonb_build_array(
    jsonb_build_object('label', 'Traveller',   'value', coalesce(r.traveller_name, '-')),
    jsonb_build_object('label', 'Destination', 'value', coalesce(r.city_name, '-')),
    jsonb_build_object('label', 'Dates',       'value', v_dates)
  );
  if coalesce(r.purpose_name, '') <> '' then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Purpose', 'value', r.purpose_name));
  end if;
  if r.snap_travel_category is not null then
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('label', 'Entitlement',
        'value', r.snap_travel_category ||
                 case when r.snap_band_no is not null then ' (Band ' || r.snap_band_no || ')' else '' end));
  end if;

  -- ⚠ ONE BRANCH PER EVENT, and each names the ACTION the reader must take.
  --   "TRV-2627-0004 was updated" sends somebody to find out what changed;
  --   "TRV-2627-0004 is waiting for your approval" does not.
  if p_type = 'trip_submitted' then
    v_eyebrow   := 'Travel request';
    v_headline  := v_ref || ' is waiting for your approval';
    v_action    := 'submitted a travel request';
    v_subject   := 'Approval needed - travel request ' || v_ref;
    v_cta_label := 'Review the request';
    v_cta_path  := b || '/queues/approve-trip';

  elsif p_type = 'trip_approved' then
    v_eyebrow   := 'Approved';
    v_headline  := v_ref || ' was approved';
    v_action    := 'approved a travel request';
    v_subject   := 'Approved - travel request ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'trip_needs_director' then
    v_eyebrow   := 'Director approval';
    v_headline  := v_ref || ' needs Director approval';
    v_action    := 'sent a travel request for Director approval';
    v_subject   := 'Director approval needed - ' || v_ref;
    v_cta_label := 'Review the request';
    v_cta_path  := b || '/queues/director-approval';

  elsif p_type in ('trip_returned', 'trip_rejected') then
    v_eyebrow   := case when p_type = 'trip_rejected' then 'Turned down' else 'Sent back' end;
    v_headline  := v_ref || case when p_type = 'trip_rejected'
                                 then ' was turned down' else ' was sent back for changes' end;
    v_action    := case when p_type = 'trip_rejected' then 'turned down a travel request'
                        else 'sent a travel request back' end;
    v_subject   := case when p_type = 'trip_rejected'
                        then 'Turned down - travel request ' || v_ref
                        else 'Changes needed - travel request ' || v_ref end;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'advance_approved' then
    v_eyebrow   := 'Travel advance';
    v_headline  := v_ref || ' needs its advance paid before departure';
    v_action    := 'approved a travel advance';
    -- ⚠ The one deadline in this module that runs BACKWARDS (§11.1), so the
    --   subject says "before departure" rather than naming a due date.
    v_subject   := 'Advance to pay before departure - ' || v_ref;
    v_cta_label := 'Open the advance queue';
    v_cta_path  := b || '/queues/advance';

  elsif p_type = 'advance_paid' then
    v_eyebrow   := 'Advance paid';
    v_headline  := 'Your travel advance for ' || v_ref || ' has been paid';
    v_action    := 'paid a travel advance';
    v_subject   := 'Travel advance paid - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'trip_booked' then
    v_eyebrow   := 'Booked';
    v_headline  := v_ref || ' is booked - your tickets are on the trip';
    v_action    := 'booked a trip';
    v_subject   := 'Booked - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'cancellation_requested' then
    v_eyebrow   := 'Cancellation';
    v_headline  := v_ref || ' needs to be unwound - a refund window may be closing';
    v_action    := 'asked for a trip to be cancelled';
    v_subject   := 'Cancellation requested - ' || v_ref;
    v_cta_label := 'Open the cancellations queue';
    v_cta_path  := b || '/queues/cancellations';

  elsif p_type = 'trip_cancelled' then
    v_eyebrow   := 'Cancelled';
    v_headline  := v_ref || ' has been cancelled';
    v_action    := 'cancelled a trip';
    v_subject   := 'Cancelled - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'claim_submitted' then
    v_eyebrow   := 'Expense claim';
    v_headline  := v_ref || ' has an expense claim waiting for your approval';
    v_action    := 'filed an expense claim';
    v_subject   := 'Approval needed - expense claim ' || v_ref;
    v_cta_label := 'Review the claim';
    v_cta_path  := b || '/queues/approve-claim';

  elsif p_type = 'claim_returned' then
    v_eyebrow   := 'Sent back';
    v_headline  := 'Your expense claim for ' || v_ref || ' was sent back';
    v_action    := 'sent an expense claim back';
    v_subject   := 'Changes needed - expense claim ' || v_ref;
    v_cta_label := 'Open the claim';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'claim_approved' then
    v_eyebrow   := 'Claim approved';
    v_headline  := v_ref || ' has been approved and is with Finance';
    v_action    := 'approved an expense claim';
    v_subject   := 'Approved - expense claim ' || v_ref;
    v_cta_label := 'Open the Finance queue';
    v_cta_path  := b || '/queues/finance-check';

  elsif p_type = 'claim_verified' then
    v_eyebrow   := 'Verified';
    v_headline  := v_ref || ' has been verified and is ready to settle';
    v_action    := 'verified an expense claim';
    v_subject   := 'Ready to settle - ' || v_ref;
    v_cta_label := 'Open the settlement queue';
    v_cta_path  := b || '/queues/settlement';

  elsif p_type = 'trip_settled' then
    v_eyebrow   := 'Settled';
    /* ⚠ THE HEADLINE SAYS WHICH DIRECTION THE MONEY WENT, because "settled" on
       its own reads as "you have been paid" and is wrong half the time. The
       FIGURE stays out of it — that is what the trip page is for. */
    v_headline  := case when coalesce(r.settled_amount, 0) < 0
                        then v_ref || ' is settled - the balance of your advance was recovered'
                        else v_ref || ' is settled and closed' end;
    v_action    := 'settled a trip';
    v_subject   := 'Settled - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'trip_closed_no_claim' then
    v_eyebrow   := 'Closed';
    v_headline  := v_ref || ' is closed - nothing was claimed and nothing was owed';
    v_action    := 'closed a trip with no claim';
    v_subject   := 'Closed - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'trip_held' then
    v_eyebrow   := 'On hold';
    v_headline  := v_ref || ' has been put on hold';
    v_action    := 'put a trip on hold';
    v_subject   := 'On hold - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'advance_recovered' then
    v_eyebrow   := 'Advance recovered';
    v_headline  := 'Travel advance handed back on ' || v_ref;
    v_action    := 'recorded a returned travel advance';
    v_subject   := 'Advance recovered - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'cancellation_refused' then
    v_eyebrow   := 'Cancellation refused';
    v_headline  := v_ref || ' will go ahead - the desk did not cancel it';
    v_action    := 'refused a cancellation request';
    v_subject   := 'Still going ahead - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'trip_resumed' then
    v_eyebrow   := 'Resumed';
    v_headline  := v_ref || ' is back in play';
    v_action    := 'took a trip off hold';
    v_subject   := 'Resumed - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  elsif p_type = 'comment' then
    v_eyebrow   := 'Comment';
    v_headline  := 'You were mentioned on ' || v_ref;
    v_action    := 'mentioned you in a comment';
    v_subject   := 'Mentioned - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;

  else
    /* ⚠ THE GENERIC ARM IS A SAFETY NET, NOT A DESIGN. Every event this module
       announces today has a branch above; this catches one added later so it
       sends a plain, correct mail rather than a broken one. `tc_downgraded` is
       the only event that lands here on purpose, and it announces to an EMPTY
       recipient list — so it never becomes mail at all. */
    v_eyebrow   := 'Travel Desk';
    v_headline  := coalesce(nullif(btrim(coalesce(p_text, '')), ''), v_ref || ' was updated');
    v_action    := 'updated a trip';
    v_subject   := 'Travel Desk - ' || v_ref;
    v_cta_label := 'Open the trip';
    v_cta_path  := b || '/trips/' || r.id::text;
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

comment on function public.fms_travel_email_payload(text, uuid, text, text, jsonb) is
  'Email body for one Travel Desk event, authored from the trip row. No amount ever reaches a subject line - a travel claim is a named individual''s money. Consumed by fms_travel_announce and rendered by the shared FMS renderer in send-email.';
grant execute on function public.fms_travel_email_payload(text, uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- fms_travel_announce, re-issued with the gated enqueue. The body above the
-- email block is verbatim from 20261005120000.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_announce(
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
  insert into public.fms_travel_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('travel-desk') and p_type not like '%edited';
  exception when others then v_email_on := false;
  end;

  if v_email_on then
    begin
      v_payload := public.fms_travel_email_payload(
        p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_travel_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      /* Email the same recipient, only when this module's gate is on. Isolated
         so a mail problem can never roll back the work it is reporting: a failed
         outbox insert must not undo a settlement. */
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('travel_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $fn$;

comment on function public.fms_travel_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Travel Desk event: an activity row always, one notification per recipient, and - when email_module_enabled(''travel-desk'') - one email_outbox row per recipient. Pass an EMPTY recipient list for a correction; it belongs on the audit trail without paging anyone.';
grant execute on function public.fms_travel_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: the gate is OFF, and it must stay off until somebody turns it on.
-- ---------------------------------------------------------------------------
do $$
declare v_on boolean;
begin
  select enabled into v_on from public.email_module_settings where module_id = 'travel-desk';
  if v_on is null then
    raise exception 'travel-desk has no email_module_settings row';
  end if;
  if v_on then
    raise exception 'travel-desk email is ON at install time - it must ship OFF';
  end if;
  raise notice 'Travel Desk email is installed and OFF.';
end $$;

commit;
