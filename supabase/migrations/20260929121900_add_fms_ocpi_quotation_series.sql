-- ===========================================================================
-- OCPI — the quotation series, confirmed by a human before the first live number.
--
-- ⚠ THE ONE THING IN THIS MODULE THAT CANNOT BE UNDONE. A quotation number goes
--   out on a document a customer keeps. `QT-M0023` was issued through the
--   Microsoft form, so 20260929120000 seeded the counter at 23 — but 23 is a
--   FLOOR read off a single scanned submission, not a confirmed maximum. If the
--   paper series actually reached 41, the first eight live quotations re-issue
--   numbers customers already hold, and there is no fixing that after the fact.
--
--   Until now the only remedy was an UPDATE typed by hand against the counters
--   table, which nobody outside this repo can do, and nothing anywhere said the
--   figure was unconfirmed. This migration makes it a setting with an owner:
--
--     * fms_ocpi_set_quotation_series(n) — admin-only, FORWARD-ONLY, records who
--       confirmed it and when.
--     * config key `quotation_series` — readable by everyone (the config SELECT
--       policy is `using (true)`), so the app can warn every salesperson that the
--       series is unconfirmed. The counters table itself is admin-read, which is
--       why the confirmation flag lives in config rather than being derived.
--
-- ⚠ FORWARD-ONLY IS THE WHOLE SAFETY PROPERTY. Lowering the counter is the one
--   move that can duplicate a number, so the function refuses it — including the
--   case where somebody confirms a figure that live minting has already passed.
--   Raising it only ever skips numbers, which costs nothing.
--
-- ⚠ `confirmed_at_value` IS A SNAPSHOT, NOT A LIVE FIGURE. It records what was
--   confirmed, and does not move as quotations are minted afterwards; the live
--   number is fms_ocpi_counters.last_value. Two names for two different
--   questions — "what did a person vouch for" and "where is the series now".
--
-- Additive. Reversal (reverse order):
--   drop function if exists public.fms_ocpi_set_quotation_series(integer);
--   delete from public.fms_ocpi_config where key = 'quotation_series';
-- ===========================================================================

begin;

-- Seeded UNCONFIRMED on purpose: the absence of a row and a row saying "nobody
-- has checked this" read the same to the app, but only the second survives
-- somebody wondering whether the feature is even installed.
insert into public.fms_ocpi_config (key, value)
values ('quotation_series', jsonb_build_object('confirmed', false))
on conflict (key) do nothing;

create or replace function public.fms_ocpi_set_quotation_series(p_last_used integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_current integer;
begin
  if not (select public.is_admin(v_uid)) then
    raise exception 'Only an administrator can set the quotation series';
  end if;

  if p_last_used is null or p_last_used < 0 or p_last_used > 999999 then
    raise exception 'The last quotation number used must be between 0 and 999999';
  end if;

  -- Lock the row so two admins confirming at once cannot interleave with each
  -- other or with a live mint.
  select last_value into v_current
    from public.fms_ocpi_counters
   where scope = 'quotation'
     for update;

  if v_current is not null and p_last_used < v_current then
    raise exception
      'The quotation series is already at %, and it can only move forward. Set % or higher.',
      v_current, v_current;
  end if;

  insert into public.fms_ocpi_counters (scope, last_value)
  values ('quotation', p_last_used)
  on conflict (scope) do update
    set last_value = excluded.last_value,
        updated_at = now();

  insert into public.fms_ocpi_config (key, value)
  values ('quotation_series', jsonb_build_object(
    'confirmed', true,
    'confirmed_at_value', p_last_used,
    'confirmed_by', v_uid,
    'confirmed_at', now()
  ))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return p_last_used;
end $$;

comment on function public.fms_ocpi_set_quotation_series(integer) is
  'Admin-only, forward-only. Sets the last quotation number already issued (on paper or in the app) so the next minted number continues the series, and records the confirmation in fms_ocpi_config.quotation_series for the app to stop warning about.';

grant execute on function public.fms_ocpi_set_quotation_series(integer) to authenticated;

do $$
begin
  if not exists (select 1 from public.fms_ocpi_config where key = 'quotation_series') then
    raise exception 'quotation_series config row missing';
  end if;
  if to_regprocedure('public.fms_ocpi_set_quotation_series(integer)') is null then
    raise exception 'fms_ocpi_set_quotation_series did not install';
  end if;
end $$;

commit;
