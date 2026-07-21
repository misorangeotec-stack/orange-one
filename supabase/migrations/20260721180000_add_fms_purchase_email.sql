-- Email Alerts — RM Domestic (procurement) FMS rollout (step 1: enqueue).
--
-- WHY
--   RM Domestic already fans every workflow transition through ONE RPC,
--   public.fms_purchase_announce, which computes the exact next-step recipient(s)
--   and writes a bell notification per recipient. This re-issues that RPC to ALSO
--   drop an email_outbox row per recipient — so email goes exactly where a new
--   RM Domestic bell notification goes, inheriting the RPC's self-skip + de-dup.
--
--   Rich per-step content is authored client-side (where procurement's selectors +
--   ₹ formatters + item labels live) and passed in p_meta; it is carried verbatim
--   into email_outbox.payload and rendered by the send-email function's shared
--   Purchase template. kind = 'procurement_' || p_type.
--
-- GATE: only fires when email_module_enabled('procurement') is true; seeded OFF
-- below, so nothing emails until an admin flips the Procurement → Setup →
-- Notifications switch.
--
-- NOTE the app id is 'procurement' but the DB objects are prefixed fms_purchase_
-- (historical — see frontend/src/apps/procurement/meta.tsx).
--
-- Additive + reversible: re-apply 20260630160000_add_fms_purchase_activity_notifications.sql
-- to restore the un-enqueuing body; delete the seeded row to remove the gate.

-- Seed the per-module gate row (OFF). email_module_enabled('procurement') is false
-- until a row exists (helper defaults to false), but seed it explicitly so the
-- Setup toggle has a row to flip.
insert into public.email_module_settings (module_id, enabled)
values ('procurement', false)
on conflict (module_id) do nothing;

drop function if exists public.fms_purchase_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_purchase_announce(
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
  v_email_on boolean := public.email_module_enabled('procurement');
  v_email text;
begin
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- (new) email the same recipient, only when Procurement email is enabled.
      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('procurement_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_purchase_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
