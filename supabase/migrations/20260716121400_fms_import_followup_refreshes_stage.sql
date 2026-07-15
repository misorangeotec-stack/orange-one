-- Purchase FMS (import) — record_followup must re-derive the PO stage.
--
-- Bug: record_followup updated the PI's dispatch_status snapshot but never called
-- refresh_po. So marking a PI "dispatched" left current_stage stuck at 'follow_up'
-- (the stage only moved when some OTHER refresh_po-calling action ran). With the
-- stage-driven queues, a dispatched PO then wrongly stayed in the Follow-up queue
-- instead of moving to Inward. Fix: refresh_po at the end so dispatch → Inward
-- takes effect immediately. Replace-only.

create or replace function public.fms_import_record_followup(
  p_pi_id uuid, p_dispatch_status text,
  p_actual_dispatch_date date default null,
  p_lr_no text default '', p_transport text default '', p_revised_dispatch_date date default null,
  p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po_id uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to record follow-ups';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;

  select po_id into v_po_id from public.fms_import_pis where id = p_pi_id;
  if v_po_id is null then raise exception 'PI not found'; end if;

  -- Append the history row (one per follow-up event).
  insert into public.fms_import_followups
    (pi_id, po_id, dispatch_status, actual_dispatch_date, revised_dispatch_date, lr_no, transport_details, remarks, created_by)
  values
    (p_pi_id, v_po_id, p_dispatch_status, p_actual_dispatch_date, p_revised_dispatch_date,
     nullif(p_lr_no,''), nullif(p_transport,''), nullif(p_remarks,''), auth.uid());

  -- Keep the PI's latest snapshot (queues + stepper read these).
  update public.fms_import_pis
     set dispatch_status = p_dispatch_status,
         actual_dispatch_date = p_actual_dispatch_date,
         lr_no = nullif(p_lr_no,''),
         transport_details = nullif(p_transport,''),
         revised_dispatch_date = p_revised_dispatch_date
   where id = p_pi_id;

  -- Re-derive the PO stage so "dispatched" moves it to Inward right away.
  perform public.fms_import_refresh_po(v_po_id);
end $$;
grant execute on function public.fms_import_record_followup(uuid, text, date, text, text, date, text) to authenticated;
