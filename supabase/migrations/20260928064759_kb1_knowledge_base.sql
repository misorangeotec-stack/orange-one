-- KB-1 · Knowledge Base: the HR handbook, asked in plain words and read in place.
--
-- Decided by the user on 28-09-2026 (Task Prompts/KB-1-PROMPT.md → §0):
--   • A floating "Ask HR" bubble on every screen. NOT a menu item, NOT a page.
--   • Clicking a citation widens it: chat left, the real handbook right, highlighted.
--   • Answers come from the handbook as written. The handbook flags its own draft
--     rates, so we add no second warning layer.
--   • claude-sonnet-5, behind a secret.
--   • When the handbook does not cover it: say so, and offer "Send this to HR".
--
-- 🔴 READING NEEDS NO GRANT. Every staff member may read the handbook and ask; it is
--   issued to every employee at joining. The `knowledge-base` module grant means "may
--   MANAGE" (see the question list, annotate sections), exactly as `announcements` does.
--   A customer login (profiles.is_external, OD-13) never reads any of it.
--
-- 🔴 QUESTIONS ARE LOGGED WITHOUT A NAME. kb_questions.asked_by stays NULL unless the
--   asker presses "Send this question to HR", which is them choosing to be identified so
--   HR can reply. This handbook covers sexual harassment, grievance, maternity, PIP and
--   notice period; a log naming who asked what is a pregnancy disclosure and a
--   resignation signal recorded without consent, and it would suppress use of exactly
--   the policies people most need to look up privately. HR still gets the whole list of
--   what was asked and what went unanswered, which is the part that helps them.
--
--   The per-person daily cap therefore lives in its OWN table (kb_rate_limit), holding a
--   counter and no question text, so the cap can be enforced without linking a person to
--   what they asked.
--
--   A caller proves ownership of their own question with the client_token returned by
--   kb_log_question, NOT with auth.uid() — otherwise anyone could attach their name to
--   somebody else's anonymous question.
--
-- ADDITIVE ONLY: five new tables and new functions. Nothing that exists is altered.
-- Rollback: the _rollback.sql beside this.

do $$
begin
  if to_regclass('public.kb_sections') is not null then
    raise exception 'KB-1 is already applied: public.kb_sections exists';
  end if;
end $$;

-- ── 1. The handbook ───────────────────────────────────────────────────────────

create table public.kb_documents (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  title           text not null,
  version         integer not null default 1,
  source_filename text,
  is_current      boolean not null default false,
  published_at    timestamptz not null default now(),
  published_by    uuid references public.profiles(id) on delete set null,
  constraint kb_documents_slug_fmt check (slug = btrim(slug) and slug ~ '^[a-z0-9-]{1,64}$'),
  constraint kb_documents_version_pos check (version >= 1),
  unique (slug, version)
);

comment on table public.kb_documents is
  'KB-1 · One row per published version of a handbook. Old versions are KEPT: a revision is a new row, never an edit.';

-- Exactly one current version per slug.
create unique index kb_documents_one_current on public.kb_documents (slug) where is_current;

create table public.kb_sections (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.kb_documents(id) on delete cascade,
  ordinal       integer not null,
  depth         integer not null,
  number        text,
  heading       text not null,
  path_text     text not null,
  anchor        text not null,
  body          jsonb not null default '[]'::jsonb,
  plain_text    text not null default '',
  in_force_note text,
  visibility    text not null default 'all_staff',
  constraint kb_sections_depth_range check (depth between 1 and 3),
  constraint kb_sections_ordinal_pos check (ordinal >= 0),
  constraint kb_sections_body_is_array check (jsonb_typeof(body) = 'array'),
  constraint kb_sections_visibility_known check (visibility in ('all_staff')),
  constraint kb_sections_anchor_fmt check (anchor ~ '^[a-z0-9-]{1,80}$'),
  unique (document_id, ordinal),
  unique (document_id, anchor)
);

comment on table public.kb_sections is
  'KB-1 · THE table. One row per handbook heading, in document order. ~349 rows for the HR Manual.';
comment on column public.kb_sections.path_text is
  'Breadcrumb shown to the reader and given to the model, e.g. "Chapter 4 - Leave Policy > Sick Leave".';
comment on column public.kb_sections.anchor is
  'Stable URL fragment: /handbook/read#<anchor>. Derived from the heading, not the ordinal, so it survives a re-publish.';
comment on column public.kb_sections.body is
  'Ordered blocks the SCREEN renders: [{kind:"paragraph"|"bullets"|"table"|"image", ...}]. Never rendered as markdown or raw HTML.';
comment on column public.kb_sections.plain_text is
  'body flattened. This is what goes in the model prompt; body is what the screen draws.';
comment on column public.kb_sections.in_force_note is
  'Set ONLY where the handbook fails to flag its own problem. At launch that is the two Chapter 32 section-2 rows whose band tables contradict each other. Quoted verbatim by the answer.';
comment on column public.kb_sections.visibility is
  'all_staff everywhere today. Exists so a restricted document can join later without re-ingesting this one.';

create index kb_sections_doc_order on public.kb_sections (document_id, ordinal);

create table public.kb_images (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.kb_documents(id) on delete cascade,
  section_id   uuid references public.kb_sections(id) on delete set null,
  ordinal      integer not null,
  storage_path text not null,
  alt_text     text,
  transcript   text,
  unique (document_id, ordinal)
);

comment on table public.kb_images is
  'KB-1 · The handbook pictures. Three of the seven carry policy text that extraction cannot see (Preface, Director''s Desk, Organization Chart); their transcript is what makes them answerable.';

-- ── 2. What people asked ──────────────────────────────────────────────────────

create table public.kb_questions (
  id               uuid primary key default gen_random_uuid(),
  client_token     uuid not null default gen_random_uuid(),
  document_id      uuid references public.kb_documents(id) on delete set null,
  asked_at         timestamptz not null default now(),
  question         text not null,
  answer           text,
  cited_section_ids uuid[] not null default '{}'::uuid[],
  covered          boolean not null default false,
  model            text,
  usage            jsonb,
  rating           smallint,
  -- 🔴 NULL on purpose. Stamped only by kb_send_to_hr(), which is the asker consenting.
  asked_by         uuid references public.profiles(id) on delete set null,
  sent_to_hr       boolean not null default false,
  sent_to_hr_at    timestamptz,
  hr_answer        text,
  hr_answered_by   uuid references public.profiles(id) on delete set null,
  hr_answered_at   timestamptz,
  constraint kb_questions_rating_known check (rating is null or rating in (-1, 1)),
  constraint kb_questions_named_only_when_sent check (asked_by is null or sent_to_hr)
);

comment on table public.kb_questions is
  'KB-1 · Every question asked, ANONYMOUS by default. asked_by is stamped only when the asker presses "Send this question to HR".';
comment on column public.kb_questions.client_token is
  'Returned to the asking browser and to nobody else. Proves ownership for rating and for Send to HR. NEVER exposed to managers.';
comment on column public.kb_questions.asked_by is
  'NULL unless sent_to_hr. See the constraint: a name cannot exist without that consent.';

create index kb_questions_recent   on public.kb_questions (asked_at desc);
create index kb_questions_unanswered on public.kb_questions (asked_at desc) where not covered;
create index kb_questions_token    on public.kb_questions (client_token);

-- Holds a COUNTER and no question text, so the daily cap is enforceable without
-- linking a person to what they asked.
create table public.kb_rate_limit (
  user_id uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  used    integer not null default 0,
  primary key (user_id, on_date)
);

comment on table public.kb_rate_limit is
  'KB-1 · Per-person daily question counter. Deliberately separate from kb_questions so the cap does not de-anonymise the log.';

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

alter table public.kb_documents  enable row level security;
alter table public.kb_sections   enable row level security;
alter table public.kb_images     enable row level security;
alter table public.kb_questions  enable row level security;
alter table public.kb_rate_limit enable row level security;

-- The handbook itself: any staff member may READ it, nobody may write it from a browser.
-- (`(select ...)` wrapping is deliberate — it hoists the call out of the per-row loop.)
create policy kb_documents_select on public.kb_documents
  for select to authenticated
  using ((select public.is_staff((select auth.uid()))));

create policy kb_sections_select on public.kb_sections
  for select to authenticated
  using ((select public.is_staff((select auth.uid()))));

create policy kb_images_select on public.kb_images
  for select to authenticated
  using ((select public.is_staff((select auth.uid()))));

-- The question log and the counter: no policies at all. Everything goes through the
-- definer functions below, each of which checks its own caller.
revoke all on public.kb_questions, public.kb_rate_limit from anon, authenticated;

-- ── 4. Who may manage ─────────────────────────────────────────────────────────

-- Admins, or staff holding the knowledge-base module at the EDIT level. module_level()
-- already answers 'edit' for an admin. Reading the handbook needs NONE of this.
create or replace function public.can_manage_knowledge_base(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.is_staff(p_uid)
     and public.module_level(p_uid, 'knowledge-base') = 'edit';
$$;

-- ── 5. Asking ─────────────────────────────────────────────────────────────────

-- The daily cap. Insurance against a loop in the client billing real money overnight,
-- not a real abuse worry at 70 people. Call BEFORE the model, not after.
create or replace function public.kb_rate_limit_take(p_cap integer default 50)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_used integer;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    return false;
  end if;

  insert into public.kb_rate_limit (user_id, on_date, used)
  values (v_uid, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, on_date)
    do update set used = public.kb_rate_limit.used + 1
  returning used into v_used;

  return v_used <= greatest(p_cap, 1);
end;
$$;

-- Log an answered question. Returns the client_token, which the browser keeps so it can
-- rate the answer or hand it to HR. ⚠ asked_by is NOT set here, on purpose.
create or replace function public.kb_log_question(
  p_question    text,
  p_answer      text,
  p_section_ids uuid[],
  p_covered     boolean,
  p_model       text,
  p_usage       jsonb,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Not permitted';
  end if;
  if coalesce(btrim(p_question), '') = '' then
    raise exception 'A question is required';
  end if;

  insert into public.kb_questions (question, answer, cited_section_ids, covered, model, usage, document_id)
  values (btrim(p_question), p_answer, coalesce(p_section_ids, '{}'::uuid[]),
          coalesce(p_covered, false), p_model, p_usage, p_document_id)
  returning client_token into v_token;

  return v_token;
end;
$$;

-- 👍 / 👎. First rating wins, and only within a day. Ownership is the token, not the user.
create or replace function public.kb_rate_answer(p_token uuid, p_rating smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rating is null or p_rating not in (-1, 1) then
    raise exception 'Rating must be -1 or 1';
  end if;

  update public.kb_questions
     set rating = p_rating
   where client_token = p_token
     and rating is null
     and asked_at > now() - interval '1 day';
end;
$$;

-- The one place a name is ever attached: the asker chooses to be reachable.
create or replace function public.kb_send_to_hr(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Not permitted';
  end if;

  update public.kb_questions
     set sent_to_hr    = true,
         sent_to_hr_at = now(),
         asked_by      = v_uid
   where client_token = p_token
     and not sent_to_hr
     and asked_at > now() - interval '1 day';
end;
$$;

-- ── 6. HR's side ──────────────────────────────────────────────────────────────

-- The question list. ⚠ client_token is NOT selected: holding it would let a manager
-- rate or claim somebody else's question.
create or replace function public.kb_manager_questions(p_limit integer default 500)
returns table (
  id             uuid,
  asked_at       timestamptz,
  question       text,
  answer         text,
  covered        boolean,
  rating         smallint,
  cited_section_ids uuid[],
  sent_to_hr     boolean,
  sent_to_hr_at  timestamptz,
  asked_by       uuid,
  asked_by_name  text,
  hr_answer      text,
  hr_answered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.asked_at, q.question, q.answer, q.covered, q.rating, q.cited_section_ids,
         q.sent_to_hr, q.sent_to_hr_at, q.asked_by, p.name, q.hr_answer, q.hr_answered_at
    from public.kb_questions q
    left join public.profiles p on p.id = q.asked_by
   where public.can_manage_knowledge_base(auth.uid())
   order by q.asked_at desc
   limit greatest(coalesce(p_limit, 500), 1);
$$;

-- HR replies to a question somebody handed them.
create or replace function public.kb_answer_question(p_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.can_manage_knowledge_base(v_uid) then
    raise exception 'Not permitted';
  end if;
  if coalesce(btrim(p_answer), '') = '' then
    raise exception 'An answer is required';
  end if;

  update public.kb_questions
     set hr_answer = btrim(p_answer), hr_answered_by = v_uid, hr_answered_at = now()
   where id = p_id;
end;
$$;

-- Annotate a section where the handbook fails to flag its own problem. A row edit, not a
-- deploy: this is how the Chapter 32 band note comes off the day the Directors sign.
create or replace function public.kb_set_section_note(p_section_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_knowledge_base(auth.uid()) then
    raise exception 'Not permitted';
  end if;

  update public.kb_sections
     set in_force_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_section_id;
end;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────

revoke all on function public.can_manage_knowledge_base(uuid)                          from public, anon, authenticated;
revoke all on function public.kb_rate_limit_take(integer)                               from public, anon, authenticated;
revoke all on function public.kb_log_question(text, text, uuid[], boolean, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.kb_rate_answer(uuid, smallint)                            from public, anon, authenticated;
revoke all on function public.kb_send_to_hr(uuid)                                       from public, anon, authenticated;
revoke all on function public.kb_manager_questions(integer)                             from public, anon, authenticated;
revoke all on function public.kb_answer_question(uuid, text)                            from public, anon, authenticated;
revoke all on function public.kb_set_section_note(uuid, text)                           from public, anon, authenticated;

grant execute on function public.kb_rate_limit_take(integer)                            to authenticated;
grant execute on function public.kb_log_question(text, text, uuid[], boolean, text, jsonb, uuid) to authenticated;
grant execute on function public.kb_rate_answer(uuid, smallint)                         to authenticated;
grant execute on function public.kb_send_to_hr(uuid)                                    to authenticated;
grant execute on function public.kb_manager_questions(integer)                          to authenticated;
grant execute on function public.kb_answer_question(uuid, text)                         to authenticated;
grant execute on function public.kb_set_section_note(uuid, text)                        to authenticated;
