-- ===========================================================================
-- HR Recruitment — AI FIT SCORING.
--
-- HR screens a column of ten to twenty CVs at a time, and nothing in the app has
-- ever helped with that first pass: the CV is a PDF, the job description is a set
-- of fields on the requisition, and joining the two happens entirely in someone's
-- head. Since 20260815120100 the vacancy carries a real JD, so the second half of
-- the comparison finally exists in the database. This is where the answer lands.
--
-- WHAT A ROW HERE IS
--   One advisory read of one CV against one vacancy's JD, made by a named model on
--   a named date. A whole number out of ten, plus five parameters showing where the
--   number came from, each with a line of evidence.
--
-- WHAT A ROW HERE IS NOT
--   A decision. Nothing in this file moves a stage, shortlists, disqualifies, or
--   notifies anybody. There is deliberately no trigger, no stage write, and no
--   fms_hr_announce call — see note 4.
--
-- APPEND-ONLY, ON PURPOSE. One row per scoring run; rows are never updated. "The
-- JD gained three must-have skills after she scored 8 — is that still true?" is the
-- question this feature exists to survive, and a single mutable row cannot answer
-- it. `latest` is derived: distinct on (candidate_id) order by scored_at desc.
--
-- Additive: one new table, one new function. Nothing existing is altered or dropped.
--
-- Reversal:
--   drop function if exists public.fms_hr_save_candidate_score(uuid, jsonb);
--   drop table    if exists public.fms_hr_candidate_scores;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE TABLE.
--
--    A table, not columns on fms_hr_candidates. Fifteen values that would be null
--    for the overwhelming majority of historical candidates, on the widest and
--    hottest table in the module — and a column can only hold the latest, which
--    throws away the history this feature is about.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_candidate_scores (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.fms_hr_candidates   on delete cascade,

  -- Denormalised from the candidate, set by the RPC and NEVER from the payload.
  -- Lets the read policy below be a plain predicate on this column rather than a
  -- subquery back through fms_hr_candidates on every row.
  requisition_id uuid not null references public.fms_hr_requisitions on delete cascade,

  -- Whole number 0-10. A decimal would advertise a precision the model does not
  -- have, and would invite re-scoring to chase 0.3.
  overall        integer not null check (overall between 0 and 10),
  verdict        text    not null check (verdict in ('strong', 'possible', 'weak')),

  -- The five axes as scored: an ordered array of
  --   {key, label, score, weight, applicable, evidence}
  -- where key is one of must_have_skills | experience | role_fit | preferred_skills
  -- | qualifications. jsonb rather than five column pairs because the axis SET is a
  -- product decision that will be revisited, and adding a sixth axis must not be a
  -- migration against a table that already holds history.
  axes           jsonb   not null default '[]'::jsonb,

  notes          text,
  cv_quality     text    not null default 'text'
                   check (cv_quality in ('text', 'scanned', 'thin')),

  -- WHICH JD THIS WAS A JUDGEMENT ABOUT. A digest of exactly the requisition fields
  -- the scorer reads, computed by the client (lib/fit.ts jdFingerprint) and stored
  -- verbatim. Recomputed on read and compared: different = the vacancy changed since,
  -- so the page marks the score stale.
  --
  -- Deliberately NOT a timestamp. fms_hr_requisitions.updated_at moves when a
  -- vacancy is posted, held or closed — none of which changes what the role asks
  -- for — so every score would read stale within a day for the wrong reason.
  jd_fingerprint text    not null default '',

  model          text    not null default '',
  scored_by      uuid    references auth.users on delete set null,
  scored_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.fms_hr_candidate_scores is
  'Advisory AI read of one CV against one vacancy''s job description. Append-only: one row per run, never updated. Never moves a stage, never shortlists, never notifies.';
comment on column public.fms_hr_candidate_scores.axes is
  'Ordered array of {key,label,score,weight,applicable,evidence}. overall = round(sum(score*weight)/sum(weight)) over the applicable axes, computed by the caller so it is reproducible from these values.';
comment on column public.fms_hr_candidate_scores.jd_fingerprint is
  'Digest of the JD fields this score was formed from. Differs from a fresh digest of the requisition = the vacancy changed since, so the score is stale.';
comment on column public.fms_hr_candidate_scores.requisition_id is
  'Denormalised from the candidate by the RPC, never supplied by the caller. Carries the RLS predicate.';

-- "The latest score for this candidate" — the only read shape the app has.
create index if not exists fms_hr_candidate_scores_candidate_idx
  on public.fms_hr_candidate_scores (candidate_id, scored_at desc);
create index if not exists fms_hr_candidate_scores_req_idx
  on public.fms_hr_candidate_scores (requisition_id);

-- No updated_at column and no trg_*_updated trigger: these rows are immutable.

-- ---------------------------------------------------------------------------
-- 2. RLS.
--
--    Read follows the CANDIDATE, because that is what a row here paraphrases. Same
--    predicate as fms_hr_candidates_select (20260712140000).
--
-- ⚠ fms_hr_can_read_requisition, NOT fms_hr_may_touch_candidate. The latter ORs
--   fms_hr_is_any_step_owner(), which includes owners of the `mrf` step — i.e. every
--   department HOD, because owning `mrf` is how a HOD earns the right to raise a
--   requisition. 20260712180000_fms_hr_restrict_candidate_pii.sql exists precisely
--   to stop that from buying sight of other departments' applicants ("A Sales HOD
--   could read the Purchase team's applicants"). A score is a paraphrase of a CV, so
--   using may_touch here would reopen exactly the hole that migration closed.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_candidate_scores enable row level security;

drop policy if exists fms_hr_candidate_scores_select on public.fms_hr_candidate_scores;
create policy fms_hr_candidate_scores_select on public.fms_hr_candidate_scores
  for select to authenticated
  using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));

drop policy if exists fms_hr_candidate_scores_write_admin on public.fms_hr_candidate_scores;
create policy fms_hr_candidate_scores_write_admin on public.fms_hr_candidate_scores
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. THE WRITE.
--
--    The edge function does NOT write this row — the browser does, through here,
--    after the model returns. That is the house rule for every AI function in this
--    project ("it never writes to the database"), and it buys something specific
--    here: score-candidate needs no service-role key at all. It authenticates as the
--    caller, and RLS decides what it may read. A bug in that function cannot reach
--    anything the caller could not already open in the CV tab.
--
--    Cost of the choice, accepted: if the browser dies between the model returning
--    and this call, the score is lost and the tokens are spent. A wasted call is a
--    better failure than a write-capable AI function.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_save_candidate_score(p_candidate uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid    uuid := auth.uid();
  v_req    uuid;
  v_over   integer;
  v_recent integer;
  v_id     uuid;
begin
  select c.requisition_id into v_req
    from public.fms_hr_candidates c
   where c.id = p_candidate
     for update;
  if v_req is null then
    raise exception 'Candidate not found';
  end if;

  -- The same gate the CV itself is behind. See note 2.
  if not public.fms_hr_can_read_requisition(v_req, v_uid) then
    raise exception 'Not authorized to score this candidate';
  end if;

  v_over := coalesce((p->>'overall')::integer, -1);
  if v_over < 0 or v_over > 10 then
    raise exception 'A score must be a whole number between 0 and 10';
  end if;
  if coalesce(p->>'verdict', '') not in ('strong', 'possible', 'weak') then
    raise exception 'A score needs a verdict';
  end if;

  -- Cost backstop. The function checks the same thing before spending a token; this
  -- is the racy-path copy, because the ceiling has to hold even if two tabs race.
  select count(*) into v_recent
    from public.fms_hr_candidate_scores s
   where s.candidate_id = p_candidate
     and s.scored_at > now() - interval '1 hour';
  if v_recent >= 6 then
    raise exception 'This CV has been scored several times in the last hour — read the score you already have rather than running it again';
  end if;

  insert into public.fms_hr_candidate_scores (
    candidate_id, requisition_id, overall, verdict, axes,
    notes, cv_quality, jd_fingerprint, model, scored_by
  ) values (
    p_candidate,
    v_req,                                   -- from the candidate, never the payload
    v_over,
    p->>'verdict',
    coalesce(p->'axes', '[]'::jsonb),
    nullif(btrim(coalesce(p->>'notes', '')), ''),
    coalesce(nullif(p->>'cv_quality', ''), 'text'),
    coalesce(p->>'jd_fingerprint', ''),
    coalesce(nullif(p->>'model', ''), ''),
    v_uid
  )
  returning id into v_id;

  -- ⚠ NO fms_hr_announce CALL, DELIBERATELY.
  --   fms_hr_announce writes an fms_hr_activity row, and CandidateTimeline renders
  --   every non-comment activity row into the Discussion thread. An audit row here
  --   would drop "AI score 7/10" into the team's conversation on every run, so a
  --   candidate scored four times would carry four machine lines among the human
  --   notes. scored_by + scored_at on this table are the audit trail, and they are a
  --   better one: they sit with the thing they describe.
  --   It would also be wrong to ring anyone's bell for a machine opinion.

  return v_id;
end $function$;

grant execute on function public.fms_hr_save_candidate_score(uuid, jsonb) to authenticated;

comment on function public.fms_hr_save_candidate_score(uuid, jsonb) is
  'Records one advisory AI fit score against a candidate. Authorises exactly like reading the candidate does. Writes no activity row and notifies nobody.';

commit;
