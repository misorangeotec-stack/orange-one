-- Purchase FMS (procurement) — FOLLOW-UP HISTORY + remarks.
--
-- Follow-up on a PI happens repeatedly (chase the vendor until dispatch). Until
-- now record_followup only OVERWROTE the PI's latest dispatch snapshot, so there
-- was no history. This adds an append-only history table (one row per follow-up,
-- with a free-text remark) and makes record_followup insert a history row while
-- still updating the PI snapshot the queues read. Additive only.

create table if not exists public.fms_purchase_followups (
  id                    uuid primary key default gen_random_uuid(),
  pi_id                 uuid not null references public.fms_purchase_pis on delete cascade,
  po_id                 uuid not null references public.fms_purchase_pos on delete cascade,
  dispatch_status       text not null check (dispatch_status in ('pending','dispatched','delayed')),
  actual_dispatch_date  date,
  revised_dispatch_date date,
  lr_no                 text,
  transport_details     text,
  remarks               text,
  created_by            uuid references auth.users on delete set null,
  created_at            timestamptz not null default now()
);
create index if not exists fms_purchase_followups_pi_idx on public.fms_purchase_followups (pi_id);

-- RLS — select-all; direct writes admin-only (the RPC is definer).
do $$
begin
  execute 'alter table public.fms_purchase_followups enable row level security';
  execute 'drop policy if exists fms_purchase_followups_select on public.fms_purchase_followups';
  execute 'create policy fms_purchase_followups_select on public.fms_purchase_followups for select to authenticated using (true)';
  execute 'drop policy if exists fms_purchase_followups_write_admin on public.fms_purchase_followups';
  execute 'create policy fms_purchase_followups_write_admin on public.fms_purchase_followups for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';
end $$;

-- Stage 7 — dispatch follow-up on a PI: append a history row + refresh snapshot.
drop function if exists public.fms_purchase_record_followup(uuid, text, date, text, text, date);
drop function if exists public.fms_purchase_record_followup(uuid, text, date, text, text, date, text);
create or replace function public.fms_purchase_record_followup(
  p_pi_id uuid, p_dispatch_status text,
  p_actual_dispatch_date date default null,
  p_lr_no text default '', p_transport text default '', p_revised_dispatch_date date default null,
  p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_po_id uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('follow_up', auth.uid())) then
    raise exception 'Not authorized to record follow-ups';
  end if;
  if p_dispatch_status not in ('pending','dispatched','delayed') then raise exception 'Invalid dispatch status'; end if;

  select po_id into v_po_id from public.fms_purchase_pis where id = p_pi_id;
  if v_po_id is null then raise exception 'PI not found'; end if;

  -- Append the history row (one per follow-up event).
  insert into public.fms_purchase_followups
    (pi_id, po_id, dispatch_status, actual_dispatch_date, revised_dispatch_date, lr_no, transport_details, remarks, created_by)
  values
    (p_pi_id, v_po_id, p_dispatch_status, p_actual_dispatch_date, p_revised_dispatch_date,
     nullif(p_lr_no,''), nullif(p_transport,''), nullif(p_remarks,''), auth.uid());

  -- Keep the PI's latest snapshot (queues + stepper read these).
  update public.fms_purchase_pis
     set dispatch_status = p_dispatch_status,
         actual_dispatch_date = p_actual_dispatch_date,
         lr_no = nullif(p_lr_no,''),
         transport_details = nullif(p_transport,''),
         revised_dispatch_date = p_revised_dispatch_date
   where id = p_pi_id;
end $$;
grant execute on function public.fms_purchase_record_followup(uuid, text, date, text, text, date, text) to authenticated;
