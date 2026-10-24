-- Rollback for 20261001074053_kb1_gate_to_grant_holders.sql
--
-- Puts the Knowledge Base back in front of EVERY staff member, with no grant needed, which
-- is where KB-1 §0 had it.
--
-- ⚠ YOU PROBABLY DO NOT WANT THIS. To open the feature to the whole company, GRANT 'view'
--   to everyone instead. That is a data change, keeps the question log edit-only, and needs
--   no deploy. Rolling back instead ALSO re-opens the log to view-level holders, and leaves
--   the frontend guards (AskHrBubble, homeNav, the RequireModule on /handbook/read) hiding
--   a feature the database would now allow, which is the worst of both.

drop policy if exists kb_documents_select on public.kb_documents;
drop policy if exists kb_sections_select  on public.kb_sections;
drop policy if exists kb_images_select    on public.kb_images;

create policy kb_documents_select on public.kb_documents
  for select to authenticated using ((select public.is_staff((select auth.uid()))));
create policy kb_sections_select on public.kb_sections
  for select to authenticated using ((select public.is_staff((select auth.uid()))));
create policy kb_images_select on public.kb_images
  for select to authenticated using ((select public.is_staff((select auth.uid()))));

create or replace function public.kb_rate_limit_take(p_cap integer default 50)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_used integer;
begin
  if v_uid is null or not public.is_staff(v_uid) then return false; end if;
  insert into public.kb_rate_limit (user_id, on_date, used)
  values (v_uid, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, on_date) do update set used = public.kb_rate_limit.used + 1
  returning used into v_used;
  return v_used <= greatest(p_cap, 1);
end; $fn$;

create or replace function public.kb_log_question(
  p_question text, p_answer text, p_section_ids uuid[], p_covered boolean,
  p_model text, p_usage jsonb, p_document_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_token uuid;
begin
  if v_uid is null or not public.is_staff(v_uid) then raise exception 'Not permitted'; end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'A question is required'; end if;
  insert into public.kb_questions (question, answer, cited_section_ids, covered, model, usage, document_id)
  values (btrim(p_question), p_answer, coalesce(p_section_ids, '{}'::uuid[]),
          coalesce(p_covered, false), p_model, p_usage, p_document_id)
  returning client_token into v_token;
  return v_token;
end; $fn$;

create or replace function public.kb_send_to_hr(p_token uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_staff(v_uid) then raise exception 'Not permitted'; end if;
  update public.kb_questions
     set sent_to_hr = true, sent_to_hr_at = now(), asked_by = v_uid
   where client_token = p_token and not sent_to_hr and asked_at > now() - interval '1 day';
end; $fn$;

create or replace function public.can_read_knowledge_base(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_uid is not null
     and public.is_staff(p_uid)
     and public.module_level(p_uid, 'knowledge-base') in ('view', 'edit');
$fn$;

drop function if exists public.can_use_knowledge_base(uuid);
