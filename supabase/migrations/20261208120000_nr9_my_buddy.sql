-- NR-9 follow-up — the buddy can see WHO they are buddying.
--
-- Found in the browser, signed in as a real buddy rather than an admin: /my-buddy
-- read the joiner's name straight off fms_hr_candidates, and a buddy has no grant
-- on New Recruitment, so RLS returned nothing and the page said "You are your new
-- joiner's buddy". The row it needed was one it is allowed to know about; the
-- TABLE is the thing it must not have, because a candidate row carries the phone
-- number, the expected salary and the CV.
--
-- So: a SECURITY DEFINER reader that returns the name and the job title and
-- NOTHING else, filtered to the caller's own buddy record. The same shape as
-- fms_hr_my_probation(), for the same reason.
--
-- ⚠ `where b.buddy_user_id = auth.uid()` is what makes this safe. The joiner also
-- appears on this row (as the candidate) and must NOT get it back — they would be
-- reading their own record through a door meant for somebody else. They have
-- fms_hr_my_probation() for their side.

create or replace function public.fms_hr_my_buddy()
returns table (
  buddy_id           uuid,
  joiner_name        text,
  job_title          text,
  joining_date       date,
  due_on             date,
  extended_to        date,
  interaction_target integer,
  status             text,
  feedback_rating    integer,
  feedback_at        timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    b.id,
    c.name,
    r.job_title,
    b.joining_date,
    b.due_on,
    b.extended_to,
    b.interaction_target,
    b.status,
    b.feedback_rating,
    b.feedback_at
  from public.fms_hr_buddies b
  join public.fms_hr_candidates c on c.id = b.candidate_id
  join public.fms_hr_requisitions r on r.id = b.requisition_id
  where b.buddy_user_id = auth.uid();
$$;

revoke all on function public.fms_hr_my_buddy() from public;
grant execute on function public.fms_hr_my_buddy() to authenticated;

comment on function public.fms_hr_my_buddy() is
  'NR-9 — the caller''s own buddy record plus the joiner''s name and job title. Read-only, and returns nothing to the joiner themselves.';
