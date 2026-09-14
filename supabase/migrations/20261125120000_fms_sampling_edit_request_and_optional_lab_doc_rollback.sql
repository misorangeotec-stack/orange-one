-- ===========================================================================
-- ROLLBACK for 20261125120000_fms_sampling_edit_request_and_optional_lab_doc.sql
--
-- ⚠ RUN 20261125130000's rollback FIRST. The guard below refuses otherwise.
-- ⚠ APPLYING: send the body WITHOUT the begin; / commit; lines.
--
-- Restores record_lab_complete BYTE-IDENTICAL to live pg_proc.prosrc as of
-- 14-09-2026 (the lab testing attachment required again; generated from
-- pg_get_functiondef and md5-checked below) and drops the two request-edit
-- functions.
--
-- Rows completed WITHOUT a lab report while the forward migration was live keep
-- their null lab_doc_path — nothing re-checks a finished step. Edits already
-- saved stay saved; only the ability to make new ones goes away.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $guard$
begin
  if (select prosrc from pg_proc where oid = to_regprocedure('public.fms_sampling_update_request(uuid,jsonb)'))
     like '%machine%' then
    raise exception 'ABORT: roll back 20261125130000 (machine testing) first';
  end if;
end $guard$;

drop function if exists public.fms_sampling_update_request(uuid, jsonb);
drop function if exists public.fms_sampling_request_editable(uuid);

CREATE OR REPLACE FUNCTION public.fms_sampling_record_lab_complete(p_req uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_comment text := nullif(trim(p->>'lab_comment'), '');
  v_doc     text := nullif(p->>'lab_doc_path', '');
  v_to      uuid := nullif(p->>'lab_result_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'lab_result_to_name'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_lab_process' then
    raise exception 'This request is not with the lab (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('lab_process', p_req, v_uid) then
    raise exception 'Not authorized to complete the lab process';
  end if;
  if v_comment is null then raise exception 'Test comments are required to complete the lab process'; end if;
  if v_doc     is null then raise exception 'A lab testing attachment is required to complete the lab process'; end if;
  if v_to is null and v_to_name is null then
    raise exception 'Record whom the result is handed over to';
  end if;

  update public.fms_sampling_requests set
    lab_completed_date = coalesce(nullif(p->>'lab_completed_date','')::date, current_date),
    lab_comment        = v_comment,
    lab_note           = case when p ? 'lab_note' then nullif(trim(p->>'lab_note'), '') else lab_note end,
    lab_doc_path       = v_doc,
    lab_doc_name       = nullif(p->>'lab_doc_name', ''),
    lab_result_to_id   = v_to,
    lab_result_to_name = v_to_name,
    lab_completed_at   = coalesce(lab_completed_at, now()),
    lab_completed_by   = coalesce(lab_completed_by, v_uid),
    status = 'awaiting_result_received', current_step = 'result_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_completed',
    'Lab testing is complete for ' || coalesce(v_no,'a request') || ' — the result is ready to be received.',
    (case when v_to is not null then array[v_to]
          else public.fms_sampling_step_owner_ids('result_received') end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Lab result ready',
      'headline', 'A lab result has been handed to you',
      'action', 'completed lab testing and handed you the result',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $function$;

do $check$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.fms_sampling_record_lab_complete(uuid,jsonb)'::regprocedure)
     is distinct from '02ff96291ad7b95a524d6b093389fd3c' then
    raise exception 'ABORT: record_lab_complete was not restored byte-identically';
  end if;
  if to_regprocedure('public.fms_sampling_update_request(uuid,jsonb)') is not null
     or to_regprocedure('public.fms_sampling_request_editable(uuid)') is not null then
    raise exception 'ABORT: the request-edit functions are still there';
  end if;
end $check$;

commit;
