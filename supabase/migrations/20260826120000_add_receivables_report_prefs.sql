-- Per-user REPORT PREFERENCES for the Outstanding Dashboard (Receivables Control).
--
-- Every `receivables_*` column on profiles so far is a grant an ADMIN makes about a user
-- (which salespeople they may see, which menus, which source). This one is the opposite: it
-- is the user's own choice, written by the user, about how they like a report laid out.
-- Today that is which columns they keep on the Customers with Zero Collections table; the
-- shape is per-report so the next report costs a key, not a column.
--
--   { "collections:zero": { "columns": ["customers", "outstanding", ...] },
--     "collections:threshold": { "columns": [...] } }
--
-- Report keys are the frontend's own (lib/reportPrefs.ts). Unknown keys are ignored on read,
-- and unknown COLUMN keys are dropped against the report's picker, so a column that is later
-- renamed or retired can never strand a user on an empty table.
--
-- ── Why an RPC and not a plain update ──
-- `profiles` is admin-only for writes under RLS (see core/platform/directoryWrites.ts), and it
-- must stay that way — it carries role-adjacent grants. Opening an UPDATE policy so a user can
-- save a column layout would also let them PATCH receivables_salespersons or
-- receivables_admin_menus from the browser console, because Postgres RLS cannot scope an UPDATE
-- policy to a single column. So the write goes through one SECURITY DEFINER function that can
-- only ever touch this column, only ever on the caller's own row.
--
-- Purely ADDITIVE: a new nullable column and a new function. No existing column, row or policy
-- is touched. Apply in the Orange One identity project (ref icutjkrqkbzwvmnfbzpr) via the SQL
-- editor or the session pooler BEFORE the frontend goes live — the hub selects this column, so
-- the saved layout silently falls back to the report default until it exists.

alter table public.profiles
  add column if not exists receivables_report_prefs jsonb;

comment on column public.profiles.receivables_report_prefs is
  'Outstanding Dashboard per-user report layout, keyed by report id: {"collections:zero":{"columns":[...]}}. Written only by set_receivables_report_prefs(); NULL = report defaults.';

-- Save (or clear) one report's saved column layout for the CALLING user.
--   p_columns non-empty -> stores {"columns": [...]} under p_report_id
--   p_columns null/empty -> removes p_report_id entirely (back to the report default)
create or replace function public.set_receivables_report_prefs(
  p_report_id text,
  p_columns   text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_report_id is null or btrim(p_report_id) = '' then
    raise exception 'A report id is required';
  end if;
  -- A layout is a handful of column keys. The cap is a guard against a runaway client, not a
  -- product rule — the widest report today offers 23.
  if p_columns is not null and array_length(p_columns, 1) > 100 then
    raise exception 'Too many columns';
  end if;

  update public.profiles
     set receivables_report_prefs =
           case
             when p_columns is null or array_length(p_columns, 1) is null
               then coalesce(receivables_report_prefs, '{}'::jsonb) - p_report_id
             else coalesce(receivables_report_prefs, '{}'::jsonb)
                  || jsonb_build_object(
                       p_report_id,
                       jsonb_build_object('columns', to_jsonb(p_columns))
                     )
           end
   where id = v_uid;
end;
$$;

-- `from public` alone is NOT enough here, and the first run proved it: Supabase ships
-- `alter default privileges in schema public grant all on functions to ... anon ...`, so a
-- newly created function is granted to anon DIRECTLY, and revoking PUBLIC leaves that grant
-- standing. Saving a column layout is a signed-in act; anon has no business calling it at all.
-- (The auth.uid() guard inside would reject the call anyway — but "cannot call it" beats
-- "calls it and gets an error".)
revoke all on function public.set_receivables_report_prefs(text, text[]) from public;
revoke all on function public.set_receivables_report_prefs(text, text[]) from anon;
grant execute on function public.set_receivables_report_prefs(text, text[]) to authenticated;

comment on function public.set_receivables_report_prefs(text, text[]) is
  'Saves the calling user''s column layout for one Outstanding Dashboard report. Touches only profiles.receivables_report_prefs, only on auth.uid()''s own row. NULL/empty p_columns clears the saved layout.';
