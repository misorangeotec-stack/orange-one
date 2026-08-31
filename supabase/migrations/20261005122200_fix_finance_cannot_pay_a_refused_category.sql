-- ===========================================================================
-- FINANCE COULD PAY A LINE THE POLICY REFUSES OUTRIGHT.
--
-- `fms_travel_set_line_settlement` let Finance settle any line at any figure up
-- to what was claimed, with a reason. That is right for a CAP — §7.2's hotel
-- ceiling, §10's conveyance limit — because §7.3 exists precisely so a cap can
-- be exceeded when the evidence justifies it.
--
-- It is WRONG for §15, which is not a cap. §15 lists categories that are
-- "never reimbursable under ANY circumstances, regardless of band or whether a
-- client was present", and the seeded refusal note on the Alcohol & Tobacco
-- category says exactly that. Before this migration:
--
--     set_line_settlement(<the bar tab>, 900, 'Client was present.')  -- accepted
--
-- The engine refused the line, and the human override walked straight past the
-- refusal — using, word for word, the justification the policy pre-emptively
-- rejects. A prohibition that any reviewer can set aside with a sentence is not
-- a prohibition; it is a default.
--
-- ⚠ THE DISTINCTION THIS ENFORCES: a CAP is a figure Finance may exceed with a
--   reason; a REFUSAL is a category Finance may not pay at all. `reimbursable`
--   on `fms_travel_expense_categories` is what separates them, and it is already
--   the column the engine reads to refuse the line in the first place. One
--   source of truth, now honoured on both paths.
--
-- Settling such a line at ZERO stays legal and is a no-op that costs nothing —
-- there is no reason to make Finance's screen error on a figure that changes
-- nothing.
--
-- Found by the phase 9 browser pass: the panel offered "Settle at a different
-- figure" on an alcohol line, and the RPC accepted 900.
-- ===========================================================================
create or replace function public.fms_travel_set_line_settlement(
  p_line   uuid,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  l      record;
  t      record;
  cat    record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into l from public.fms_travel_claim_lines where id = p_line;
  if l.id is null then raise exception 'Claim line not found'; end if;

  select * into t from public.fms_travel_trips where id = l.trip_id for update;
  if not public.fms_travel_can_act('finance_review', t.id, v_uid) then
    raise exception 'You are not authorized to verify this claim';
  end if;
  if t.status <> 'awaiting_finance_review' then
    raise exception 'This trip is %, not awaiting Finance verification', replace(t.status, '_', ' ');
  end if;

  if p_amount is not null then
    if v_why is null then
      raise exception 'Say why. A figure Finance changed without a reason is one nobody can explain to the traveller, and it is what the Policy Exceptions report has to print.';
    end if;
    if p_amount > l.amount then
      raise exception 'This line claimed %, so it cannot be settled at %. The company does not reimburse more than was spent.',
        to_char(l.amount, 'FM999999999.00'), to_char(p_amount, 'FM999999999.00');
    end if;
    if p_amount < 0 then raise exception 'A settled amount cannot be negative'; end if;

    /*
      ⚠ §15 IS NOT A CAP, SO IT HAS NO EXCEPTION PATH. §7.3 lets a cap be
        exceeded on evidence; nothing lets a refused category be paid. The
        category's own refusal note is quoted back rather than paraphrased,
        because it is the sentence the policy actually wrote.
    */
    if p_amount > 0 then
      select * into cat from public.fms_travel_expense_categories where id = l.category_id;
      if cat.id is not null and not coalesce(cat.reimbursable, true) then
        raise exception '% cannot be settled at any figure. %  There is no exception path for this — §7.3 lets a CAP be exceeded on evidence, but §15 is a refusal, not a cap.',
          cat.name,
          coalesce(cat.refusal_note,
                   format('%s is not reimbursable under any circumstances (§15).', cat.name));
      end if;
    end if;
  end if;

  update public.fms_travel_claim_lines set
    finance_amount = p_amount,
    finance_reason = case when p_amount is null then null else v_why end,
    finance_by     = case when p_amount is null then null else v_uid end,
    finance_at     = case when p_amount is null then null else now() end
  where id = p_line;

  return public.fms_travel_price_claim(l.trip_id);
end $$;

comment on function public.fms_travel_set_line_settlement(uuid, numeric, text) is
  'Finance settles one claim line at a figure of its own, in either direction, with a mandatory reason. It never touches allowed_amount - the engine''s answer and the human''s sit side by side, and the gap between them IS the Policy Exceptions report. A CAP may be exceeded; a §15 REFUSAL may not be paid at any figure. Passing NULL clears the override.';
grant execute on function public.fms_travel_set_line_settlement(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertion: at least one category still refuses, so the guard has something to
-- stand on. A seed that quietly marked everything reimbursable would make this
-- fix a no-op.
-- ---------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.fms_travel_expense_categories
   where not coalesce(reimbursable, true);
  if v_n = 0 then
    raise exception 'No expense category is marked non-reimbursable - §15 is not represented in the masters';
  end if;
  raise notice '% categories refuse outright under §15', v_n;
end $$;

-- Reversal: re-apply 20261005122100's definition of fms_travel_set_line_settlement.
-- Doing so reintroduces the defect above.
