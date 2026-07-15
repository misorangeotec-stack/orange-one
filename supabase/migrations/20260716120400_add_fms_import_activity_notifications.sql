-- Purchase FMS (import) — ACTIVITY + NOTIFICATIONS (Phase 5).
--
-- Cross-cutting layer that powers (a) the per-entity activity timeline shown on
-- Request Detail / PO Detail, (b) the topbar notifications bell, and (c) the
-- Monitoring / Control Center actions (Nudge / Escalate / Reassign).
--
-- Tables:
--   fms_import_activity       — immutable audit trail across every entity
--   fms_import_notifications  — per-user bell feed (own-row read; mark-read)
--
-- Column:
--   fms_import_request_items.assigned_approver_id — optional per-line approver
--     override, set by a coordinator/admin Reassign; honored by decide_approval.
--
-- RPCs (all SECURITY DEFINER):
--   fms_import_announce       — one call writes an activity row (actor = caller)
--                                  and fans a notification out to recipients. Used
--                                  by the client after each workflow transition and
--                                  for Nudge / Escalate. Best-effort: never the
--                                  source of truth for state, only the trail/feed.
--   fms_import_reassign_line  — coordinator/admin sets a line's override approver,
--                                  then announces it to that approver.
--   fms_import_decide_approval (re-created) — authz now also accepts the
--                                  assigned_approver_id, so a reassigned approver
--                                  can act. Body otherwise unchanged.
--
-- Purely ADDITIVE. Reuses is_admin / fms_import_is_step_owner / the approval
-- matrix. Reversal: drop the 3 RPCs (restore prior decide_approval), drop the
-- column, then tables fms_import_notifications, fms_import_activity.

-- ===========================================================================
-- TABLES
-- ===========================================================================
create table if not exists public.fms_import_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request' | 'line' | 'po' | 'pi' | 'grn' | 'payment'
  entity_id   uuid not null,
  type        text not null,            -- 'submitted' | 'sourced' | 'approved' | 'rejected' | ...
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_import_activity_entity_idx on public.fms_import_activity (entity_type, entity_id);
create index if not exists fms_import_activity_created_idx on public.fms_import_activity (created_at);

create table if not exists public.fms_import_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  type        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  text        text not null,
  actor_id    uuid references auth.users on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists fms_import_notifications_user_idx on public.fms_import_notifications (user_id, read_at);
create index if not exists fms_import_notifications_created_idx on public.fms_import_notifications (created_at);

-- ---- per-line approver override (Reassign) -------------------------------
alter table public.fms_import_request_items
  add column if not exists assigned_approver_id uuid references auth.users on delete set null;

-- ===========================================================================
-- RLS
--   activity      — select to all authenticated (timelines); direct write admin-only
--   notifications — select/update OWN rows only; direct insert admin-only
--   (both are written through the SECURITY DEFINER RPCs below)
-- ===========================================================================
alter table public.fms_import_activity enable row level security;
drop policy if exists fms_import_activity_select on public.fms_import_activity;
create policy fms_import_activity_select on public.fms_import_activity
  for select to authenticated using (true);
drop policy if exists fms_import_activity_write_admin on public.fms_import_activity;
create policy fms_import_activity_write_admin on public.fms_import_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_import_notifications enable row level security;
drop policy if exists fms_import_notifications_select_own on public.fms_import_notifications;
create policy fms_import_notifications_select_own on public.fms_import_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_import_notifications_update_own on public.fms_import_notifications;
create policy fms_import_notifications_update_own on public.fms_import_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_import_notifications_write_admin on public.fms_import_notifications;
create policy fms_import_notifications_write_admin on public.fms_import_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- HELPERS
-- ===========================================================================

-- Process-coordinator check (reads the singleton config row).
create or replace function public.fms_import_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_import_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_import_is_coordinator(uuid) to authenticated;

-- ===========================================================================
-- RPC — announce: one activity row + fan-out notifications.
--   Actor is always auth.uid() (client-supplied actor is ignored). Recipients
--   that equal the actor are skipped so you never notify yourself. Granted to
--   authenticated; used after each transition and for Nudge / Escalate.
-- ===========================================================================
drop function if exists public.fms_import_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_import_announce(
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
begin
  insert into public.fms_import_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_import_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_import_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- RPC — reassign an approval line to a specific approver (coordinator/admin).
--   Sets assigned_approver_id (honored by decide_approval) and announces it.
-- ===========================================================================
drop function if exists public.fms_import_reassign_line(uuid, uuid, text);
create or replace function public.fms_import_reassign_line(
  p_request_item_id uuid,
  p_approver_id     uuid,
  p_note            text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.fms_import_is_coordinator(auth.uid()) then
    raise exception 'Not authorized to reassign';
  end if;
  if p_approver_id is null then raise exception 'Pick an approver to reassign to'; end if;

  select status into v_status from public.fms_import_request_items
   where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'Only a line awaiting approval can be reassigned (status %)', v_status;
  end if;

  update public.fms_import_request_items
     set assigned_approver_id = p_approver_id,
         status = 'approval'
   where id = p_request_item_id;

  perform public.fms_import_announce(
    'line', p_request_item_id, 'reassigned',
    coalesce(nullif(p_note,''), 'You were asked to approve this line'),
    array[p_approver_id]
  );
end $$;
grant execute on function public.fms_import_reassign_line(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- Re-create decide_approval: authz now also accepts the assigned approver.
-- (Body identical to the Phase-3 version except the assignment-aware check and
--  clearing assigned_approver_id on a terminal decision.)
-- ===========================================================================
create or replace function public.fms_import_decide_approval(
  p_request_item_id  uuid,
  p_decision         text,       -- approve | override | reject | hold | resume
  p_override_vendor_id uuid default null,
  p_reason           text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_value    numeric(16,2);
  v_approver uuid;
  v_tier     text;
  v_qrate    numeric(14,2);
  v_qgst     numeric(6,2);
  v_assigned uuid;
begin
  select status, line_value, assigned_approver_id
    into v_status, v_value, v_assigned
    from public.fms_import_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  -- Matched approver for the line value.
  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_import_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_import_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_import_request_items
       set final_vendor_id = p_override_vendor_id,
           final_rate = v_qrate,
           gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    -- Remarks are optional on reject/override/hold; store whatever was given.
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = nullif(p_reason,''),
           assigned_approver_id = null
     where id = p_request_item_id;

  elsif p_decision = 'hold' then
    update public.fms_import_request_items set status = 'on_hold' where id = p_request_item_id;

  elsif p_decision = 'resume' then
    update public.fms_import_request_items set status = 'approval' where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $$;
grant execute on function public.fms_import_decide_approval(uuid, text, uuid, text) to authenticated;
