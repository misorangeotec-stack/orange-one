-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_try_date — parse a Tally date string, or return NULL. Never raise.
--
-- WHY THIS EXISTS. The batch backfill decodes a manufacture date from lot numbers shaped YYMMDD…
-- (lot `26081306` = 13-Aug-2026), and Tally also carries real dates as 'YYYYMMDD' or 'DD-Mon-YYYY'.
-- Neither source is validated by Tally — a store keeper can type any six digits.
--
-- ⚠ ONE BAD ROW USED TO ABORT A WHOLE MONTH. Lot `241131` decodes to 20241131 — the 31st of a
--   30-day November. `to_date()` raised 22008 and took down the entire window being rebuilt, so a
--   single typo three years ago silently cost thousands of good rows. Worse, the driver misread
--   every SQL error as a timeout and re-chunked forever instead of reporting it.
--
--   Hence: parse only shapes we recognise, and swallow anything the parser still refuses. An
--   undecodable lot yields a NULL date, which is the honest answer — it is a lot number that
--   happens to look like a date, not a date.
--
-- IMMUTABLE so it can be used in index expressions and inlined into the rebuild's big scans.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.rpt_try_date(p text)
returns date
language plpgsql
immutable
as $function$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if p ~ '^[0-9]{8}$' then
    return to_date(p, 'YYYYMMDD');
  elsif p ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' then
    return to_date(p, 'DD-Mon-YYYY');
  end if;
  return null;
exception when others then
  return null;
end $function$;
