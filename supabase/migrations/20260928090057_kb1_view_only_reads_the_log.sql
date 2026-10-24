-- KB-1 · A view-only knowledge-base grant should mean something.
--
-- The module grant means "may MANAGE" (reading the handbook itself needs no grant at all).
-- But there are two different jobs inside that: someone compiles what staff are asking and
-- what went unanswered, and someone decides that a section needs a note on it. The first is
-- reading; the second changes what every answer says.
--
-- Without this, a view-only grant would pass module_level() = 'view', fail
-- can_manage_knowledge_base() (which demands 'edit'), and hand the holder an empty screen:
-- a switch in Module Access that looks like access and gives nothing. That is the trap
-- `announcements` avoids by refusing view-only outright (NO_VIEW_ONLY_APP_IDS). Here the
-- split is real, so it is honoured rather than removed.
--
-- READ  = view or edit  -> can_read_knowledge_base   -> kb_manager_questions
-- WRITE = edit only     -> can_manage_knowledge_base -> kb_answer_question, kb_set_section_note
--
-- ADDITIVE ONLY: one new function, one existing function re-pointed. Rollback beside this.

create or replace function public.can_read_knowledge_base(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and public.is_staff(p_uid)
     and public.module_level(p_uid, 'knowledge-base') in ('view', 'edit');
$fn$;

comment on function public.can_read_knowledge_base(uuid) is
  'KB-1 · May see the question log. View OR edit. Reading the HANDBOOK needs no grant and does not come through here.';

-- Re-pointed at the reader gate. Everything else about it is unchanged.
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
   where public.can_read_knowledge_base(auth.uid())
   order by q.asked_at desc
   limit greatest(coalesce(p_limit, 500), 1);
$fn$;

revoke all on function public.can_read_knowledge_base(uuid)   from public, anon, authenticated;
revoke all on function public.kb_manager_questions(integer)   from public, anon, authenticated;
grant execute on function public.kb_manager_questions(integer) to authenticated;
