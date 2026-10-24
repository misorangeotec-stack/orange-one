-- ===========================================================================
-- ROLLBACK of 20270210120000_fms_travel_cancel_trip_step.sql
--
-- ⚠ Run only when no trip is `cancel_pending` and no cancellation row is
--   `requested` — the narrowed CHECK and NOT NULLs below would refuse them.
--   Complete or clear those first.
-- ===========================================================================

begin;

drop function if exists public.fms_travel_complete_cancel_booking(uuid, text, numeric, text);
drop function if exists public.fms_travel_request_cancel_booking(uuid, uuid[], text);

grant execute on function public.fms_travel_cancel_booking(uuid, uuid[], text, text, numeric, text) to authenticated;

alter table public.fms_travel_cancellations drop constraint if exists fms_travel_cancellations_completed_has_credit_note;
alter table public.fms_travel_cancellations drop constraint if exists fms_travel_cancellations_status_check;
alter table public.fms_travel_cancellations
  alter column credit_note_no     set not null,
  alter column credit_note_amount set not null,
  alter column credit_note_path   set not null,
  alter column cancelled_at       set default now(),
  alter column cancelled_at       set not null;
alter table public.fms_travel_cancellations
  drop column if exists status,
  drop column if exists requested_by,
  drop column if exists requested_at;

alter table public.fms_travel_trips
  drop column if exists cancel_requested_at,
  drop column if exists cancel_requested_by,
  drop column if exists cancel_done_at,
  drop column if exists cancel_done_by;

alter table public.fms_travel_trips drop constraint if exists fms_travel_trips_status_check;
alter table public.fms_travel_trips add constraint fms_travel_trips_status_check
  check (status in (
    'draft',
    'awaiting_manager_approval',
    'awaiting_director_approval',
    'returned',
    'rejected',
    'awaiting_advance',
    'awaiting_booking',
    'booked',
    'cancellation_requested',
    'cancelled_pending_claim',
    'awaiting_claim_review',
    'awaiting_finance_review',
    'awaiting_settlement',
    'closed',
    'on_hold',
    'cancelled'));

create or replace function public.fms_travel_hold_trip(p_trip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_why is null then raise exception 'Say why this trip is being put on hold'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status in ('draft', 'on_hold', 'closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot be put on hold', replace(t.status, '_', ' ');
  end if;
  -- The same list that may CANCEL, plus whoever currently owes the step.
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)
          or public.fms_travel_can_act(coalesce(t.current_step, 'request'), p_trip, v_uid)) then
    raise exception 'You are not authorized to hold this trip';
  end if;

  update public.fms_travel_trips
     set status = 'on_hold', hold_at = now(), hold_reason = v_why, hold_from_status = t.status
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_held',
    coalesce(t.trip_no, 'The trip') || ' was put on hold — ' || v_why,
    array_remove(array[t.raised_by, t.traveller_id], null));
end $$;
grant execute on function public.fms_travel_hold_trip(uuid, text) to authenticated;

commit;
