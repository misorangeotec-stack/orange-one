-- Rollback for 20261213120000_kb1_knowledge_base.sql
--
-- ⚠ THIS DESTROYS THE QUESTION LOG. kb_questions holds what staff asked; once dropped it
--   is gone. Export it first if there is anything in it worth keeping:
--     copy (select * from public.kb_questions) to stdout with csv header;
--
-- The handbook itself is safe to lose: it is re-ingested in minutes from the .doc by
-- frontend/scripts/ingest-handbook.mjs.
--
-- Functions are dropped before tables so a dependency cannot keep a table alive.
-- Rehearsed on the live project on 28-09-2026, not merely written.

drop function if exists public.kb_set_section_note(uuid, text);
drop function if exists public.kb_answer_question(uuid, text);
drop function if exists public.kb_manager_questions(integer);
drop function if exists public.kb_send_to_hr(uuid);
drop function if exists public.kb_rate_answer(uuid, smallint);
drop function if exists public.kb_log_question(text, text, uuid[], boolean, text, jsonb, uuid);
drop function if exists public.kb_rate_limit_take(integer);
drop function if exists public.can_manage_knowledge_base(uuid);

-- Policies go with their tables, but named explicitly so a partial apply still rolls back.
drop policy if exists kb_images_select    on public.kb_images;
drop policy if exists kb_sections_select  on public.kb_sections;
drop policy if exists kb_documents_select on public.kb_documents;

drop table if exists public.kb_rate_limit;
drop table if exists public.kb_questions;
drop table if exists public.kb_images;
drop table if exists public.kb_sections;
drop table if exists public.kb_documents;
