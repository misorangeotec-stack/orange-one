-- Rollback for 20270104120000_training_videos.sql
--
-- ⚠ THIS DELETES EVERY VIDEO LINK THE TEAM HAS ENTERED. The recordings themselves stay
--   on OneDrive, but the list of which link is which goes with the table. Take it out
--   first if there is any chance it is wanted:
--     \copy (select module, title, url, description, sort_order from public.training_videos
--              order by module, sort_order, title) to 'training_videos.csv' with (format csv, header);

drop table if exists public.training_videos;
