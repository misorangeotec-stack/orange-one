-- Rollback for 20270106120000_org_kras.sql
--
-- ⚠ THIS DELETES EVERY KRA HR HAS ENTERED. Export first (Admin → Organisation →
--   KRA Details → Export) if there is any chance it is wanted, or:
--     \copy (select p.name as employee, k.name as kra, k.weight, k.active from public.org_kras k
--              join public.profiles p on p.id = k.profile_id order by 1, k.sort_order)
--           to 'org_kras.csv' with (format csv, header);

drop table if exists public.org_kras;
