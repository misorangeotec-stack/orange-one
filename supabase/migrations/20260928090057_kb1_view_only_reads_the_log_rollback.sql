-- Rollback for 20260928092000_kb1_view_only_reads_the_log.sql
--
-- Puts kb_manager_questions back on the EDIT-only gate, then drops the reader function.
-- ⚠ Order matters: kb_manager_questions calls can_read_knowledge_base, so the function
--   cannot be dropped while it is still referenced.
--
-- ⚠ After this, a view-only knowledge-base grant gives an EMPTY question log rather than an
--   error. If you roll this back, also add "knowledge-base" to NO_VIEW_ONLY_APP_IDS in
--   frontend/src/apps/registry.tsx, or Module Access will offer a switch that does nothing.

create or replace function public.kb_manager_questions(p_limit integer default 500)
returns table (
  id                uuid,
  asked_at          timestamptz,
  question          text,
  answer            text,
  covered           boolean,
  rating            smallint,
  cited_section_ids uuid[],
  sent_to_hr        boolean,
  sent_to_hr_at     timestamptz,
  asked_by          uuid,
  asked_by_name     text,
  hr_answer         text,
  hr_answered_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select q.id, q.asked_at, q.question, q.answer, q.covered, q.rating, q.cited_section_ids,
         q.sent_to_hr, q.sent_to_hr_at, q.asked_by, p.name, q.hr_answer, q.hr_answered_at
    from public.kb_questions q
    left join public.profiles p on p.id = q.asked_by
   where public.can_manage_knowledge_base(auth.uid())
   order by q.asked_at desc
   limit greatest(coalesce(p_limit, 500), 1);
$fn$;

drop function if exists public.can_read_knowledge_base(uuid);
