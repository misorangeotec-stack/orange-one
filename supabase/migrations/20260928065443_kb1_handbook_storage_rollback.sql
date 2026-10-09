-- Rollback for 20260928065443_kb1_handbook_storage.sql
--
-- ⚠ The bucket is NOT dropped, deliberately. Dropping it needs the objects gone first, and
--   deleting the handbook pictures is not something a schema rollback should decide. The
--   policy goes, which is what closes the access this migration opened; an empty private
--   bucket nobody may read is harmless.
--
--   To remove the bucket too, once you are certain the pictures are not wanted:
--     delete from storage.objects where bucket_id = 'kb-handbook-docs';
--     delete from storage.buckets where id = 'kb-handbook-docs';
--   They are re-uploaded in seconds by `npm run handbook -- --publish`.

drop policy if exists kb_handbook_docs_read on storage.objects;
