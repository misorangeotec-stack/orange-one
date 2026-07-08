-- Orange One LEADS — add the "Source" master list (e.g. exhibition name).
--
-- A new admin-managed dropdown for the mobile Leads app: where a lead came from
-- (primarily the exhibition it was captured at). Single-select per lead, stored
-- as `sourceId` inside app_leads.payload (no column change needed — payload is the
-- full Contact jsonb). This migration only seeds the new list into the org-wide
-- master set so the dropdown exists everywhere; the admin renames/extends it from
-- the web portal (Admin → Masters → Source).
--
-- Purely ADDITIVE + idempotent: it appends a "source" key to the single 'global'
-- masters row ONLY when that key is missing, so re-running (or an admin who has
-- already curated the list) is never clobbered. No table/column is altered.
--
-- Reversal (optional):
--   update public.app_lead_masters_global
--     set masters = masters - 'source' where id = 'global';

update public.app_lead_masters_global
set
  masters = masters || jsonb_build_object(
    'source',
    '[
      {"id": "m20", "label": "Exhibition 2026", "order": 20},
      {"id": "m21", "label": "Trade Show", "order": 21},
      {"id": "m22", "label": "Walk-in", "order": 22}
    ]'::jsonb
  ),
  updated_at = now()
where id = 'global'
  and not (masters ? 'source');

-- If the 'global' row somehow doesn't exist yet, create it with just the source
-- list (the earlier migration's seed covers the other lists on a fresh project).
insert into public.app_lead_masters_global (id, masters, updated_at)
values (
  'global',
  '{
    "source": [
      {"id": "m20", "label": "Exhibition 2026", "order": 20},
      {"id": "m21", "label": "Trade Show", "order": 21},
      {"id": "m22", "label": "Walk-in", "order": 22}
    ]
  }'::jsonb,
  now()
)
on conflict (id) do nothing;
