-- ROLLBACK for salesperson_and_collection_team_masters.sql (RC-15).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    in its SQL editor. Same target as the file it reverses.
--
-- ⚠️ ORDER MATTERS, AND THIS FILE IS ONLY SAFE IN ONE WINDOW.
--    Rehearse it immediately after the first apply, while NOTHING depends on these tables yet.
--    Once the muster-write Edge Function is redeployed it validates every salesperson and collection
--    team against them, so dropping them at that point 400s every save on Settings → Masters, and
--    the frontend's two master tabs error on load. If you must run it after that, roll the Edge
--    Function and the frontend back FIRST, in that order.
--
-- WHAT IT DOES NOT TOUCH, BY DESIGN
--    ext_ledger_tags.salesperson and ext_ledger_group.collection_team are untouched. There is no
--    foreign key and no trigger between them and these masters (see the create script for why), so
--    the customer mappings survive the rollback exactly as they are. Reversing this feature loses
--    the vocabulary and the is_active flags; it loses no customer data.
--
--    set_updated_at() is left in place: receivables_followups.sql created it and still uses it.
--    Dropping it here would break that table's trigger.
--
-- Both statements are idempotent. Running this twice, or before the create script has ever been
-- applied, is a no-op rather than an error.

drop table if exists public.ext_salesperson_master cascade;
drop table if exists public.ext_collection_team_master cascade;

-- ── Verify the rollback landed ───────────────────────────────────────────────
--   select count(*) from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('ext_salesperson_master', 'ext_collection_team_master');   -- 0
--
-- ── And that it took nothing with it ─────────────────────────────────────────
--   select count(*) from public.ext_ledger_tags;                        -- must still be 1875
--   select count(*) from public.ext_ledger_group;                       -- must still be 1875
--   select count(distinct salesperson) from public.ext_ledger_tags;     -- must still be 13
