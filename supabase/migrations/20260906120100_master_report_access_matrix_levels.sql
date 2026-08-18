-- ===========================================================================
-- MASTER REPORT — the access matrix carries the module LEVEL.
--
-- WHY
--   20260906120000 gave app_access an access_level ('view' | 'edit'). The
--   user-access section of the Master Report renders one cell per person per
--   module, so a report that still says only "granted / not granted" now
--   understates what an admin set — a view-only grant would read identically to
--   a full one.
--
-- ⚠ app_ids IS DELIBERATELY LEFT IN PLACE, UNCHANGED.
--   The tempting move is to change app_ids from text[] to an id->level object.
--   That breaks four readers in apps/master-report/lib/accessMatrix.ts plus
--   UserAccess.tsx and exportAccessXlsx.ts, all of which do Array.isArray /
--   .includes / .length on it — and it breaks them SILENTLY, since a jsonb
--   object fails Array.isArray and every user simply reads as "no access".
--
--   So this adds a PARALLEL key, app_levels, as {app_id: 'view'|'edit'}. Old
--   readers keep working untouched; the two screens that want the distinction
--   opt in. Same reason the function has always returned facts rather than
--   verdicts (see 20260830120400) — one more fact, not a new shape.
--
-- ⚠ The gate and the trusted null-uid cron path are unchanged, and are still
--   spelled out inline rather than delegated to module_level(): a view-only
--   master-report holder must still be able to OPEN the report, so this gate
--   must stay level-agnostic. Making it ask module_level() = 'edit' would lock
--   view-only users out of a report they are entitled to read.
--
-- ADDITIVE ONLY: one new key in the returned jsonb. Nothing is dropped.
--
-- Reversal:
--   re-apply 20260830120400_add_master_report_access_matrix.sql as-is.
-- ===========================================================================

create or replace function public.master_report_access_matrix()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed boolean;
  v_users   jsonb;
begin
  -- Null uid is the trusted server path (cron), exactly as in the snapshot.
  if v_uid is not null then
    select public.is_admin(v_uid)
        or exists (select 1 from public.app_access a
                    where a.user_id = v_uid and a.app_id = 'master-report')
      into v_allowed;
    if not coalesce(v_allowed, false) then
      raise exception 'you do not have access to the Master Report';
    end if;
  end if;

  select coalesce(jsonb_agg(u order by u.sort_name), '[]'::jsonb)
    into v_users
  from (
    select
      lower(p.name)                                  as sort_name,
      p.id                                           as id,
      p.name                                         as name,
      coalesce(d.name, '')                           as department,
      p.designation                                  as designation,
      -- user_roles.role is enum app_role; the client compares it against string
      -- literals, so cast explicitly.
      coalesce(r.role, 'employee')                   as role,
      p.last_active_at                               as last_active_at,
      coalesce(
        (select array_agg(a.app_id order by a.app_id)
           from public.app_access a where a.user_id = p.id),
        array[]::text[]
      )                                              as app_ids,
      -- The same grants keyed by app id, so a reader can tell a view-only grant
      -- from a full one. Empty OBJECT, not empty array — a reader indexing into
      -- it must get undefined for an ungranted app, never a type error.
      coalesce(
        (select jsonb_object_agg(a.app_id, a.access_level)
           from public.app_access a where a.user_id = p.id),
        '{}'::jsonb
      )                                              as app_levels
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    -- ⚠ A USER MAY HOLD SEVERAL ROLE ROWS. "Master Admin" currently holds both
    --   admin and employee. A plain LEFT JOIN therefore returned 58 rows for 57
    --   people — the user appeared twice, and which role won was undefined.
    --   This mirrors ROLE_RANK in core/platform/liveDirectory.ts exactly: highest
    --   precedence wins, one row per person.
    left join lateral (
      select ur.role::text as role
        from public.user_roles ur
       where ur.user_id = p.id
       order by case ur.role::text
                  when 'admin'   then 4
                  when 'hod'     then 3
                  when 'sub_hod' then 2
                  else 1
                end desc
       limit 1
    ) r on true
  ) u;

  -- sort_name rides along inside each row so jsonb_agg can order by it; the
  -- client ignores the extra key. Names are a mix of "Bharat" and
  -- "ABHISHEK BANSBAHADUR SINGH", so a raw sort would list every capitalised
  -- name first — lower() is what makes it read alphabetically to a human.
  return jsonb_build_object(
    'generated_at', now(),
    'users',        v_users
  );
end $$;

revoke all on function public.master_report_access_matrix() from public, anon;
grant execute on function public.master_report_access_matrix() to authenticated;

comment on function public.master_report_access_matrix() is
  'Every user with department, role, last sign-in, raw granted app ids and their access levels, for the Master Report user-access section. Reads past RLS deliberately; requires the master-report module or admin (at any level). Returns facts only — the admin/universal overlay is applied client-side.';
