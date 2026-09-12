-- ===========================================================================
-- ROLLBACK for 20261117120000_add_fms_sampling_machine_testing.sql
--
-- ⚠ GUARD FIRST. Any request currently sitting in machine testing has nowhere to
--   go once the branch is removed — its status would fail the narrowed CHECK.
--   The guard below reports how many there are and stops. Decide what happens to
--   them (normally: close them) and re-run.
--
--   Rows that already FINISHED machine testing are fine: they are closed, and
--   their machine_* columns are left in place by this rollback (dropping data is
--   not reversible). Only the branch's plumbing goes away.
--
-- Restores: the status CHECK without the two machine values, record_collect and
-- its edit window (the forward migration taught collection to hand off to the
-- machine bucket), the two closing RPCs so they close again, their edit-window
-- predicates, can_act and resume_status — each as it stood before.

-- ⚠ A no-lab+machine request that has been COLLECTED but not yet machine-tested
--   sits in awaiting_machine_process and is caught by the guard below; after the
--   suggested update it lands in the no-lab bucket at sample_received, which is
--   where such a request would have gone had machine testing never existed.
-- ===========================================================================

begin;

do $do$
declare v_stuck int;
begin
  select count(*) into v_stuck from public.fms_sampling_requests
   where status in ('awaiting_machine_process','awaiting_machine_result');
  if v_stuck > 0 then
    raise exception
      'Cannot roll back: % request(s) are in machine testing. Move them out first. A lab request can be closed: update public.fms_sampling_requests set status = ''closed'', current_step = ''result_received'', closed_at = coalesce(closed_at, now()) where status in (''awaiting_machine_process'',''awaiting_machine_result'') and lab_testing_required is true; a no-lab one belongs back at its receipt step: update public.fms_sampling_requests set status = ''awaiting_sample_received'', current_step = ''sample_received'' where status = ''awaiting_machine_process'' and lab_testing_required is distinct from true;',
      v_stuck;
  end if;
end
$do$;

-- record_collect — as at 20260808120000 (no machine arm).
create or replace function public.fms_sampling_record_collect(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_no        text;
  v_lab       boolean;
  v_uid       uuid := auth.uid();
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
  v_next      text;
  v_step      text;
begin
  select status, req_no, lab_testing_required into v_status, v_no, v_lab
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_collect' then
    raise exception 'This request is not awaiting sample collection (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_collect', p_req, v_uid) then
    raise exception 'Not authorized to record the sample collection';
  end if;

  if v_lab is true then
    v_next := 'awaiting_sample_to_lab';   v_step := 'sample_to_lab';
  else
    v_next := 'awaiting_sample_received'; v_step := 'sample_received';
  end if;

  update public.fms_sampling_requests set
    handover_recipient_id   = v_recipient,
    handover_recipient_name = nullif(trim(p->>'handover_recipient_name'), ''),
    collected_date          = coalesce(nullif(p->>'collected_date','')::date, current_date),
    collect_note            = case when p ? 'collect_note'
                                   then nullif(trim(p->>'collect_note'), '')
                                   else collect_note end,
    collected_at            = coalesce(collected_at, now()),
    collected_by            = coalesce(collected_by, v_uid),
    status = v_next, current_step = v_step
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'collected',
    'Sample collected for ' || coalesce(v_no,'a request') || ' — awaiting handover receipt.',
    (case when v_recipient is not null then array[v_recipient]
          else public.fms_sampling_step_owner_ids(v_step) end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Sample handed to you',
      'headline', 'A sample has been handed over for you to receive',
      'action', 'handed a sample over to you',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $$;
grant execute on function public.fms_sampling_record_collect(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_collect_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.collected_at is not null
       and r.status in ('awaiting_sample_received','awaiting_sample_to_lab')
  );
$$;
grant execute on function public.fms_sampling_collect_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_machine_result_received(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_result_received(uuid, jsonb);
drop function if exists public.fms_sampling_machine_result_received_editable(uuid);
drop function if exists public.fms_sampling_update_machine_complete(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_complete(uuid, jsonb);
drop function if exists public.fms_sampling_machine_complete_editable(uuid);
drop function if exists public.fms_sampling_update_machine_start(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_start(uuid, jsonb);
drop function if exists public.fms_sampling_machine_start_editable(uuid);

alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'awaiting_collect','awaiting_sample_received',
                    'awaiting_sample_to_lab','awaiting_lab_process','awaiting_result_received',
                    'closed','on_hold','cancelled'));

-- can_act — as at 20260806120000 (no machine_result arm).
create or replace function public.fms_sampling_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_sampling_is_coordinator(p_uid)
      or public.fms_sampling_is_step_owner_for(p_step_key, p_req, p_uid)
      or (p_step_key = 'receive_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_collect'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'sample_to_lab'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'result_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.lab_result_to_id = p_uid))
      or (p_step_key = 'send_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.sender_id = p_uid))
      or (p_step_key = 'result_handover'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.result_handover_to_id = p_uid))
      or (p_step_key = 'confirm_receipt'
          and exists (select 1
                        from public.fms_sampling_requests r
                        join public.fms_sampling_confirmers c
                          on c.active
                         and c.user_id = p_uid
                         and c.source = public.fms_sampling_confirmer_source(r.receive_via)
                       where r.id = p_req));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- The two closing steps — close again, unconditionally.
create or replace function public.fms_sampling_record_sample_received(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_sample_received' then
    raise exception 'This request is not awaiting sample receipt (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_received', p_req, v_uid) then
    raise exception 'Not authorized to confirm sample receipt';
  end if;

  update public.fms_sampling_requests set
    sample_received_date     = coalesce(nullif(p->>'sample_received_date','')::date, current_date),
    sample_received_note     = nullif(trim(p->>'sample_received_note'), ''),
    sample_received_doc_path = nullif(p->>'sample_received_doc_path', ''),
    sample_received_doc_name = nullif(p->>'sample_received_doc_name', ''),
    sample_received_at = coalesce(sample_received_at, now()),
    sample_received_by = coalesce(sample_received_by, v_uid),
    closed_at          = coalesce(closed_at, now()),
    status = 'closed', current_step = 'sample_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sample_received',
    'Sample received for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_sample_received(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_record_result_received(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_result_received' then
    raise exception 'This request is not awaiting the result to be received (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('result_received', p_req, v_uid) then
    raise exception 'Not authorized to confirm the result was received';
  end if;

  update public.fms_sampling_requests set
    result_received_date = coalesce(nullif(p->>'result_received_date','')::date, current_date),
    result_received_note = nullif(trim(p->>'result_received_note'), ''),
    result_received_at   = coalesce(result_received_at, now()),
    result_received_by   = coalesce(result_received_by, v_uid),
    closed_at            = coalesce(closed_at, now()),
    status = 'closed', current_step = 'result_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_received',
    'Lab result received for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_result_received(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_sample_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.sample_received_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_sample_received_editable(uuid) to authenticated;

create or replace function public.fms_sampling_result_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.result_received_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_result_received_editable(uuid) to authenticated;

-- resume_status — as at 20260903120000 (no machine arms).
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when r.handed_over_at     is not null then 'closed'
    when r.result_received_at is not null then 'closed'
    when r.sample_received_at is not null then 'closed'
    when r.lab_completed_at   is not null then 'awaiting_result_received'
    when r.lab_sent_at        is not null then 'awaiting_lab_process'
    when r.collected_at       is not null then
      case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
           else 'awaiting_sample_received' end
    when r.resulted_at        is not null then 'awaiting_handover'
    when r.tested_at          is not null then 'awaiting_result'
    when r.direction = 'inward' then
      case when r.received_at is not null then 'awaiting_testing'
           when r.collect_skipped then
             case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
                  else 'awaiting_sample_received' end
           else 'awaiting_collect' end
    else
      case when r.confirmed_at is not null then 'awaiting_result'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$function$;

-- submit_request / update_request keep accepting the machine key: it is simply
-- written to a column nothing reads any more. Re-issuing them here would mean
-- restating every rule a third time for no behavioural gain — and the columns
-- are deliberately NOT dropped, so the write stays valid.

commit;
