-- KB-1 · Restrict the Knowledge Base to people who hold the module.
--
-- ⚠ THIS REVERSES KB-1 §0's "reading needs no grant". That decision said the handbook is
-- issued to every employee at joining, so gating it defeats the point, and it was right in
-- principle. The user chose on 01-10-2026 to trial the feature with the HR department
-- first, with the cost of the reversal stated. Open it back up by granting 'view' to
-- everyone, NOT by reverting this: the level split below is what makes that a one-step
-- change.
--
-- THREE LEVELS, and they now mean different things:
--   no grant      nothing. No bubble, no handbook, no rows returned by anything.
--   view          may ASK and may READ the handbook.
--   edit          that, plus the question log and the section notes.
--
-- 🔴 THE GATE IS HERE, NOT IN THE BROWSER. Hiding the bubble would leave the Edge Function
--   and the tables reachable by anyone signed in. `ask-handbook` reads kb_sections under
--   the CALLER'S own JWT precisely so that these policies decide, and the frontend guards
--   (AskHrBubble, homeNav, RequireModule on /handbook/read) are a courtesy on top.
--
-- ⚠ can_use_knowledge_base MUST STAY EXECUTABLE BY `authenticated`. It is called from
--   inside an RLS policy, and a policy expression runs with the QUERYING role's privileges,
--   so revoking it makes every read fail with "permission denied for function". That was
--   tried here and reverted within the minute. can_manage_knowledge_base stays revoked
--   because only SECURITY DEFINER functions call it, never a policy. Same trap the dispatch
--   storage migration documents at length.
--
-- ADDITIVE ONLY: one new function, three policies replaced, three functions re-pointed.

create or replace function public.can_use_knowledge_base(p_uid uuid)
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

comment on function public.can_use_knowledge_base(uuid) is
  'KB-1 · May ask the handbook and read it. View OR edit. This is the gate the Ask HR bubble and the reader both sit behind.';

drop policy if exists kb_documents_select on public.kb_documents;
drop policy if exists kb_sections_select  on public.kb_sections;
drop policy if exists kb_images_select    on public.kb_images;

create policy kb_documents_select on public.kb_documents
  for select to authenticated
  using ((select public.can_use_knowledge_base((select auth.uid()))));

create policy kb_sections_select on public.kb_sections
  for select to authenticated
  using ((select public.can_use_knowledge_base((select auth.uid()))));

create policy kb_images_select on public.kb_images
  for select to authenticated
  using ((select public.can_use_knowledge_base((select auth.uid()))));

create or replace function public.kb_rate_limit_take(p_cap integer default 50)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); v_used integer;
begin
  if not public.can_use_knowledge_base(v_uid) then return false; end if;
  insert into public.kb_rate_limit (user_id, on_date, used)
  values (v_uid, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, on_date) do update set used = public.kb_rate_limit.used + 1
  returning used into v_used;
  return v_used <= greatest(p_cap, 1);
end;
$fn$;

create or replace function public.kb_log_question(
  p_question text, p_answer text, p_section_ids uuid[], p_covered boolean,
  p_model text, p_usage jsonb, p_document_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); v_token uuid;
begin
  if not public.can_use_knowledge_base(v_uid) then raise exception 'Not permitted'; end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'A question is required'; end if;
  insert into public.kb_questions (question, answer, cited_section_ids, covered, model, usage, document_id)
  values (btrim(p_question), p_answer, coalesce(p_section_ids, '{}'::uuid[]),
          coalesce(p_covered, false), p_model, p_usage, p_document_id)
  returning client_token into v_token;
  return v_token;
end;
$fn$;

create or replace function public.kb_send_to_hr(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if not public.can_use_knowledge_base(v_uid) then raise exception 'Not permitted'; end if;
  update public.kb_questions
     set sent_to_hr = true, sent_to_hr_at = now(), asked_by = v_uid
   where client_token = p_token and not sent_to_hr and asked_at > now() - interval '1 day';
end;
$fn$;

-- The question LOG moves to edit-only, so the two levels differ by something real: view
-- asks and reads, edit also sees what everybody asked.
create or replace function public.can_read_knowledge_base(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and public.is_staff(p_uid)
     and public.module_level(p_uid, 'knowledge-base') = 'edit';
$fn$;

comment on function public.can_read_knowledge_base(uuid) is
  'KB-1 · May see the QUESTION LOG. Edit only since 01-10-2026: a view grant asks and reads but does not see what colleagues asked.';

revoke all on function public.can_use_knowledge_base(uuid) from public, anon;
grant execute on function public.can_use_knowledge_base(uuid) to authenticated;
