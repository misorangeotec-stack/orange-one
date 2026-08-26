-- ===========================================================================
-- Email alerts — an interview booking, and a handover.
--
-- WHY. Booking a panel notified NOBODY: the store wrote the row and invalidated,
-- and no bell, no mail, no work item went anywhere. A head learned they were taking
-- a round by opening the board and noticing. 20261020130000 makes an assigned head a
-- real owner of the round; this is how they find out.
--
-- New Recruitment already enqueues mail for MASTER REQUESTS ONLY (20260814120000).
-- This widens `fms_hr_announce`'s gate to admit exactly two more event types and
-- authors their content here in SQL — the sampling / supplies / dispatch / asset /
-- OCPI / travel pattern, so there is no frontend `emailMeta` wiring.
--   kind = 'hr-recruitment_' || p_type, i.e. hr-recruitment_interview_booked
--                                        and hr-recruitment_interview_reassigned
--   GATE: email_module_enabled('hr-recruitment'), which is FALSE today.
--
-- ⚠ THE GATE IS OFF AND STAYS OFF UNTIL SOMEBODY TURNS IT ON. Settings → Email
--   notifications is the switch. Turning it on also releases the master-request mail
--   that has been built behind the same switch since August — that is a deliberate
--   decision for HR to take, not a side effect of this migration.
--
-- ⚠ NO CANDIDATE NAME IN THE SUBJECT LINE. Subjects are logged by mail servers, shown
--   on lock screens and quoted in replies. A recruitment mail names someone who has
--   not been hired and may never be told they were considered; the whole module is
--   built around that (fms_hr_can_read_requisition gates every candidate row as PII).
--   The name belongs in the body, behind a login. The round and the vacancy are
--   enough to know what the mail is about.
--
-- ⚠ THE CTA POINTS AT THE INTERVIEWS QUEUE, which the recipient can now actually
--   open — 20261020130000 widened `fms_hr_can_read_requisition`, and the frontend
--   added the booked panel to `canInterview` and the page's own `canSee`. Without
--   BOTH of those this mail would land its reader on Access Denied, which is defect
--   (C) of 20260905120000 and worse than sending nothing.
--
-- ⚠ CORRECTIONS STAY BELL-ONLY. The standing `%edited` rule across the other modules;
--   nothing here enqueues on an edit.
--
-- Requires supabase/functions/send-email/index.ts to know that a
-- 'hr-recruitment_interview_' kind is a panel notice rather than master-data
-- governance, or the footer tells the reader they own a master they have never seen.
--
-- Reversal:
--   re-apply 20260814120000_add_fms_hr_master_request_email.sql  (narrows the gate back)
--   drop function if exists public.fms_hr_interview_email_payload(uuid, integer, text, text, jsonb);
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- Content, authored from the interview + candidate + requisition rows.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_hr_interview_email_payload(uuid, integer, text, text, jsonb);
create or replace function public.fms_hr_interview_email_payload(
  p_candidate uuid,
  p_round     integer,
  p_type      text,
  p_text      text,
  p_meta      jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b           text := '/hr-recruitment';
  v_round_lbl text;
  c           record;
  r           record;
  iv          record;
  v_rows      jsonb;
  v_when      text;
begin
  select * into c from public.fms_hr_candidates where id = p_candidate;
  -- Row gone or unreadable — fall back to the bell text so the mail is still
  -- coherent rather than empty.
  if not found then return jsonb_build_object('headline', p_text); end if;

  select * into r from public.fms_hr_requisitions where id = c.requisition_id;
  select * into iv from public.fms_hr_interviews
   where candidate_id = p_candidate and round = p_round;

  v_round_lbl := case when p_round = 0 then 'Telephonic screen' else 'Round ' || p_round end;
  v_when := coalesce(to_char(iv.scheduled_on, 'DD Mon YYYY'), 'not set');

  v_rows := jsonb_build_array(
    jsonb_build_object('label', 'Candidate', 'value', c.name),
    jsonb_build_object('label', 'Round',     'value', v_round_lbl),
    jsonb_build_object('label', 'Date',      'value', v_when),
    jsonb_build_object('label', 'Vacancy',
      'value', coalesce(r.job_title, 'the vacancy') || coalesce(' (' || r.mrf_no || ')', ''))
  );

  if p_type = 'interview_reassigned' then
    return jsonb_build_object(
      -- No candidate name: see the header.
      'subject',  v_round_lbl || ' is now yours - ' || coalesce(r.job_title, 'a vacancy'),
      'eyebrow',  'Interview handed to you',
      'headline', v_round_lbl || ' has been passed to you',
      'action',   'handed you ' || v_round_lbl,
      'rows',     v_rows,
      'ctaLabel', 'Open the interviews queue',
      'ctaPath',  b || '/queues/interviews')
      -- Why it moved is the whole point of a handover mail — carry it when given.
      || case when coalesce(btrim(p_meta->>'reason'), '') <> ''
              then jsonb_build_object('note',
                     jsonb_build_object('label', 'Why', 'text', p_meta->>'reason'))
              else '{}'::jsonb end;
  end if;

  -- interview_booked
  return jsonb_build_object(
    'subject',  v_round_lbl || ' booked with you - ' || coalesce(r.job_title, 'a vacancy'),
    'eyebrow',  'Interview booked',
    'headline', 'You are taking ' || v_round_lbl,
    'action',   'booked you for ' || v_round_lbl,
    'rows',     v_rows,
    'ctaLabel', 'Open the interviews queue',
    'ctaPath',  b || '/queues/interviews');
end $$;

grant execute on function public.fms_hr_interview_email_payload(uuid, integer, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue fms_hr_announce: unchanged activity + bell writes, and the email gate
-- widened from master requests alone to ALSO admit the two interview events.
--
-- Body is 20260814120000's; only `v_email_on` and the payload selection change.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_hr_announce(
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
  -- Evaluated once: the switch AND the narrow entity/type scope. Everything outside
  -- these two shapes stays bell-only regardless of the switch.
  v_is_master boolean := p_entity_type = 'master_request'
                         and p_type in ('master_requested', 'master_approved', 'master_rejected');
  -- (new) a panel was booked, or a round was handed over. `interview_handed_over`
  -- (the outgoing panel) is deliberately NOT here: losing a round is not something
  -- to be emailed about, and the bell already says so.
  v_is_interview boolean := p_entity_type = 'candidate'
                            and p_type in ('interview_booked', 'interview_reassigned');
  v_email_on boolean := (v_is_master or v_is_interview)
                        and public.email_module_enabled('hr-recruitment');
  v_payload jsonb;
  v_email text;
  v_round integer;
begin
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Built once outside the loop — it is the same for every recipient.
  if v_email_on then
    if v_is_master then
      v_payload := public.fms_hr_master_request_email_payload(p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    else
      -- The round rides in the announce meta; the store always sets it. Default to 2
      -- rather than failing: R2 is the round this whole feature exists for, and a mail
      -- naming the wrong round beats no mail at all with a null here.
      v_round := coalesce((p_meta->>'round')::integer, 2);
      v_payload := public.fms_hr_interview_email_payload(p_entity_id, v_round, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    end if;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- Email the same recipient. Wrapped so a mail problem can never roll back the
      -- bell notification or the caller's write.
      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('hr-recruitment_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(v_payload, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;

grant execute on function public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

commit;
