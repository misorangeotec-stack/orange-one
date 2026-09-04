-- OCPI-40 (re-audit, C-3) · Nine deals name a real roster person and carry no
--                            link to their account.
--
-- ── WHAT THIS DOES, AND WHAT IT REFUSES TO DO ──────────────────────────────
--
-- `fms_ocpi_deals.salesperson_name` is free text; `salesperson_user_id` is the
-- link to `profiles`. The form's own rule, stated in QuotationForm.tsx, is
-- "EXACTLY ONE MATCH, OR NO ID" - `profiles.name` has no uniqueness constraint,
-- so guessing between two people of the same name would attribute a deal to the
-- wrong person on the strength of a string.
--
-- Nine deals predate that rule or were typed before the roster existed:
--     Yash Agarwal   7 deals
--     Khurshid Alam  2 deals
-- Both names resolve to EXACTLY ONE profile, case-insensitively. So this applies
-- the code's own rule retroactively - mechanical, no inference. Until now those
-- deals never matched the `salesperson_user_id = auth.uid()` route, so they were
-- missing from that person's own "My deals" except by name tag.
--
-- 🔴 THE FOUR AMBIGUOUS NAMES ARE DELIBERATELY UNTOUCHED. `Afrin Saiyed` (13
--    deals), `Nakul Sir` (3), `KARAN SIR` (1) and `UMESH BHAI` (1) match NO
--    profile at all. Each has one obvious candidate - AFRIN AMIN SAIYED,
--    Nakuleshwar Sharma, Karan Toshniwal, UMESHKUMAR SOLANKI - but attributing
--    18 commercial documents to a person is Ritesh Bhai's word to give, not an
--    inference to make in a migration. They are a Waiting-for.
--
--    ⚠ The original audit reported this as "one stale value to retire", on 3
--      deals. The true figure is 18 to re-attribute plus 9 to link.
--
-- ⚠ THE NAME IS NOT REWRITTEN, only the id filled. Frozen revisions print the
--   name from their stored payload and are unaffected either way; leaving the
--   text alone means no already-issued paper is contradicted by the record.
--
-- ⚠ EXACTLY-ONE IS ENFORCED HERE TOO, not assumed. The correlated count means a
--   second person sharing either name would make this update skip the row rather
--   than pick one.
--
-- Additive in effect: fills a NULL column on nine rows; no row is deleted and no
-- non-null value is overwritten.
--
-- Reversal:
--   update public.fms_ocpi_deals set salesperson_user_id = null
--    where salesperson_name in ('Yash Agarwal', 'Khurshid Alam');

update public.fms_ocpi_deals d
   set salesperson_user_id = p.id,
       updated_at          = now()
  from public.profiles p
 where d.salesperson_user_id is null
   and d.salesperson_name is not null
   and lower(btrim(p.name)) = lower(btrim(d.salesperson_name))
   and (select count(*) from public.profiles p2
         where lower(btrim(p2.name)) = lower(btrim(d.salesperson_name))) = 1;
