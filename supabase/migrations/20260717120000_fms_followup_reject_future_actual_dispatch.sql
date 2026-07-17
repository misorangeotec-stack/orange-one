-- ===========================================================================
-- Purchase + Import FMS — an actual dispatch date can never be in the future.
--
-- WHY
-- PO-2627-0011 was recorded as dispatched on 2026-08-10 while the date was
-- 2026-07-17: goods booked as having left the vendor three weeks from now.
-- The follow-up modal pre-filled "Actual Dispatch Date" (a FACT) from the
-- dispatch DUE date (a future PROMISE) and nothing rejected it — the modal had
-- no cap, save() checked only that `delayed` carried a revised date, and
-- fms_purchase_record_followup validated authz + status + PO existence but not
-- one date. The modal now seeds only from a real prior dispatch and caps its
-- picker at today; this is the matching server-side invariant.
--
-- WHY A TRIGGER, NOT A CHECK INSIDE THE RPC
-- The follow-up tables carry an admin write policy:
--   fms_purchase_followups_write_admin | ALL | authenticated | is_admin(auth.uid())
-- so an admin can INSERT straight through PostgREST and never touch the RPC.
-- A trigger sits on the table and therefore covers every path — the app, a
-- direct API call, any future caller — and needs no rewrite of the two large
-- record_followup functions (no risk of miscopying their bodies).
--
-- WHY NOT A CHECK CONSTRAINT
-- A constraint is validated against rows already present, so it would fail on
-- PO-2627-0011 — the row we are deliberately leaving alone. A trigger only
-- fires on new writes. (now() is not immutable, so a CHECK could not call it
-- anyway.)
--
-- WHY IST, NOT current_date
-- current_date on Supabase is UTC. A dispatch recorded at 02:00 IST is still
-- "yesterday" in UTC until 05:30, so `> current_date` would read it as
-- tomorrow and wrongly reject it. Users are in IST and the browser guard uses
-- the LOCAL date (todayLocalIso), so both layers must agree on IST.
--
-- The exception message reaches the user verbatim: save()'s catch does
-- setErr((e as Error).message), so it is worded like the app's own errors.
--
-- Additive: new function + new triggers. No table, column, or row is altered.
-- ===========================================================================

create or replace function public.fms_reject_future_actual_dispatch()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Let legacy rows (PO-2627-0011) still be edited for unrelated fields —
  -- only object when the date itself is being set or changed.
  if tg_op = 'UPDATE' and new.actual_dispatch_date is not distinct from old.actual_dispatch_date then
    return new;
  end if;

  -- Goods cannot have left the vendor on a day that has not happened yet.
  if new.actual_dispatch_date is not null
     and new.actual_dispatch_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Enter a dispatch date on or before today.';
  end if;

  return new;
end $$;

comment on function public.fms_reject_future_actual_dispatch() is
  'Rejects a future actual_dispatch_date on any FMS follow-up write, evaluated in IST. Shared by the Purchase and Import follow-up tables.';

drop trigger if exists fms_purchase_followups_no_future_dispatch on public.fms_purchase_followups;
create trigger fms_purchase_followups_no_future_dispatch
  before insert or update on public.fms_purchase_followups
  for each row execute function public.fms_reject_future_actual_dispatch();

drop trigger if exists fms_import_followups_no_future_dispatch on public.fms_import_followups;
create trigger fms_import_followups_no_future_dispatch
  before insert or update on public.fms_import_followups
  for each row execute function public.fms_reject_future_actual_dispatch();
