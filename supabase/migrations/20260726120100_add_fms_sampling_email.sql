-- Email Alerts — Sampling FMS rollout (enqueue).
--
-- WHY
--   Sampling already fans every workflow transition through ONE RPC,
--   public.fms_sampling_announce, which computes the next-step recipient(s) (and,
--   on an inward raise, the chosen collector) and writes a bell notification per
--   recipient. This re-issues that RPC to ALSO drop an email_outbox row per
--   recipient — so email goes exactly where a new Sampling bell goes, inheriting
--   the RPC's self-skip + de-dup.
--
--   Content is payload-driven: p_meta (authored by the submit RPC for the raise,
--   and client-side for result/handover) is carried verbatim into
--   email_outbox.payload and rendered by the send-email function's shared
--   purchase-family template. kind = 'sampling_' || p_type.
--
-- GATE: only fires when email_module_enabled('sampling'); seeded OFF below, so
-- nothing emails until an admin flips Sampling → Setup → Notifications.
--
-- Additive + reversible: re-apply 20260724120000_add_fms_sampling_foundations.sql
-- to restore the un-enqueuing body; delete the seeded row to remove the gate.

insert into public.email_module_settings (module_id, enabled)
values ('sampling', false)
on conflict (module_id) do nothing;

drop function if exists public.fms_sampling_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_sampling_announce(
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
  v_email_on boolean := public.email_module_enabled('sampling');
  v_email text;
begin
  insert into public.fms_sampling_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_sampling_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- (new) email the same recipient, only when Sampling email is enabled.
      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('sampling_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_sampling_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
