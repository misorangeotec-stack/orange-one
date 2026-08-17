-- ===========================================================================
-- MASTER REPORT — section 2: who has access to what.
--
-- ⚠ WHY THIS IS AN RPC AND NOT A CLIENT-SIDE READ.
--   The obvious build is to render this from useDirectory(), which the browser
--   already holds. That silently produces a nearly EMPTY report for exactly the
--   people it is built for, because RLS on the three tables involved is
--   restrictive:
--
--     app_access  select : user_id = auth.uid() OR is_admin()
--     user_roles  select : user_id = auth.uid() OR is_admin()
--     profiles    select : id = auth.uid() OR is_admin()
--                          OR is_hod_of(auth.uid(), id)
--                          OR same_department(auth.uid(), id)
--
--   A director holding `master-report` but NOT admin would therefore see their
--   own grants, their own role, and only their own department's people. The
--   whole point of making Master Report a grantable module was that a director
--   holds it without being made an admin, so the report has to read past those
--   policies deliberately — which is what SECURITY DEFINER is for, gated by the
--   same check master_report_snapshot() already uses.
--
-- ⚠ THIS RETURNS FACTS ONLY — raw granted app ids and the role.
--   It does NOT decide "has access". That rule is
--       admin OR universal-module OR explicitly granted
--   and `universal` is frontend-only knowledge (apps/universal.ts, empty today).
--   Encoding it here would put the rule in two places and guarantee they drift,
--   so the overlay is applied once in the browser by the shared `hasAccess`.
--
-- Reversal:
--   drop function if exists public.master_report_access_matrix();
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
      )                                              as app_ids
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
  'Every user with department, role, last sign-in and raw granted app ids, for the Master Report user-access section. Reads past RLS deliberately; requires the master-report module or admin. Returns facts only — the admin/universal overlay is applied client-side.';
