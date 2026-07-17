-- Orange One — lead_master_usage(): how many leads reference each master item.
--
-- Powers the Masters admin (web portal → Leads Dashboard → Masters), which must
-- refuse to delete a master that any lead still uses and offer "make inactive"
-- instead.
--
-- Why this has to live in SQL:
--   Leads reference masters BY ID and there is NO foreign key — the masters are a
--   single jsonb blob (app_lead_masters_global), not rows — so Postgres cannot
--   guard the delete for us. Worse, only two of the five master types are promoted
--   to columns (interest_level_id, follow_up_action_id); source / categories /
--   asked-about live ONLY inside app_leads.payload jsonb. Counting them in the
--   browser would mean downloading every lead's payload, so we count server-side
--   in one round trip.
--
-- Counting rules:
--   * Soft-deleted leads (deleted = true) ARE counted. They are restorable and the
--     Google Sheets export still renders their labels, so their master must not be
--     deletable. (Deliberate — do not add `where deleted = false`.)
--   * interest_level_id / follow_up_action_id are duplicated (column + payload);
--     prefer the column and fall back to payload, matching the dashboard's own
--     precedence in useLeadsData.ts.
--
-- Purely ADDITIVE: creates one function. No table, column, row, policy or grant on
-- any existing object is altered. Read-only at runtime. Apply in the Orange One
-- identity project (ref coshondiqdhorwvibrwu) via the SQL editor or `supabase db push`.
--
-- Reversal:
--   drop function if exists public.lead_master_usage();

create or replace function public.lead_master_usage()
returns table (master_type text, master_id text, uses bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER so the count is TRUE regardless of the caller's row visibility;
  -- the admin check keeps that from being a data leak. Only the Masters admin page
  -- (admin-gated) calls this, and it returns ids + counts only — never lead content.
  if not public.is_admin(auth.uid()) then
    raise exception 'lead_master_usage: admin only';
  end if;

  return query
  with refs as (
    select 'interestLevels'::text as mtype,
           coalesce(l.interest_level_id, l.payload ->> 'interestLevelId') as mid
      from public.app_leads l
    union all
    select 'followUpActions',
           coalesce(l.follow_up_action_id, l.payload ->> 'followUpActionId')
      from public.app_leads l
    union all
    select 'source', l.payload ->> 'sourceId'
      from public.app_leads l
    union all
    -- Multi-selects: jsonb string arrays inside payload. jsonb_typeof guards against
    -- a malformed/absent key (a non-array would abort jsonb_array_elements_text).
    select 'categories', jsonb_array_elements_text(
             case when jsonb_typeof(l.payload -> 'categoryIds') = 'array'
                  then l.payload -> 'categoryIds' else '[]'::jsonb end)
      from public.app_leads l
    union all
    select 'askedAbout', jsonb_array_elements_text(
             case when jsonb_typeof(l.payload -> 'askedAboutIds') = 'array'
                  then l.payload -> 'askedAboutIds' else '[]'::jsonb end)
      from public.app_leads l
  )
  select r.mtype, r.mid, count(*)
    from refs r
   where r.mid is not null and r.mid <> ''
   group by r.mtype, r.mid;
end;
$$;

comment on function public.lead_master_usage() is
  'Orange One Leads: (master_type, master_id, uses) — how many leads reference each master item, counting soft-deleted leads. Admin-only. Backs the Masters admin in-use guard, which blocks deleting a referenced master (there is no FK; masters are jsonb).';

grant execute on function public.lead_master_usage() to authenticated;
