-- ===========================================================================
-- THE EMPLOYEE EXIT HAND-OFF — a boolean ticked from memory becomes evidence.
--
-- hr-exit has always seeded a clearance item `travel_advance` — "Travel advance
-- settlement", owned by the Travel Desk — with `requires_file = false` and
-- `allows_link = false`. Until now that was a tick with NOTHING BEHIND IT:
-- nobody in the business could answer "does this leaver still owe travel
-- advance?", so the box was ticked from memory, and §11.2's whole point — that
-- unreconciled advance is tracked per person — died at the exit door.
--
-- Travel Desk can now answer it. `fms_travel_outstanding_advance_by_code` was
-- built in phase 5 keyed on EMPLOYEE CODE precisely for this, because hr-exit's
-- cases carry a nullable `employee_user_id` (plenty of staff never had a portal
-- login) and a hand-off that only worked for people with accounts would fail on
-- exactly the leavers most likely to have an open advance.
--
-- ⚠ NO SCHEMA CHANGE. This is a master-row edit and one read-only function.
--   `fms_exit_toggle_clearance_check` already enforces both flags, and it reads
--   them as "a file OR (allows_link AND a link)" — so turning BOTH on does not
--   demand an upload. It demands EVIDENCE, and a link to the live Outstanding
--   Advances report is better evidence than a file, because a file is a
--   screenshot of a figure that has since moved.
--
--   That distinction is the whole reason `allows_link` is turned on at the same
--   time. `requires_file` alone would have manufactured screenshots.
--
-- ⚠ THE FLAGS ARE COPIED ONTO A CASE WHEN IT IS RAISED, not read live. So this
--   changes cases raised from now on and leaves open ones exactly as they are.
--   Today that is moot — there are ZERO `travel_advance` checks on any case in
--   the database — but it is the kind of thing that looks like a bug six months
--   later when somebody flips a master and nothing happens on screen.
--
-- ⚠ THE RECOVERY HEAD ALREADY EXISTS. hr-exit's payroll heads carry an
--   `Advance Recovery` DEDUCTION, seeded long before this module. A non-zero
--   balance at exit is a line under that head — nothing new is created here,
--   which is the point: the hand-off is two systems agreeing on a figure, not a
--   third place to record it.
--
-- Reversal:
--   update public.fms_exit_clearance_items
--      set requires_file = false, allows_link = false, description = null
--    where key = 'travel_advance';
--   drop function if exists public.fms_travel_exit_clearance(text, uuid, date);
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- What the person ticking the box is actually being asked, and where to look.
-- ---------------------------------------------------------------------------
update public.fms_exit_clearance_items set
  requires_file = true,
  allows_link   = true,
  description   =
    'Confirm the leaver has no unreconciled travel advance. Travel Desk → Reports → '
    || 'Outstanding Advances answers this by name and by employee code; paste the link, '
    || 'or attach the statement. A non-zero balance is recovered in the full and final '
    || 'settlement under the Advance Recovery head — it is not a reason to hold the '
    || 'clearance open.'
where key = 'travel_advance';

-- ---------------------------------------------------------------------------
-- The figure itself, in the shape the exit screen needs to render it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_exit_clearance(
  p_employee_code text,
  p_user_id       uuid default null,
  p_as_at         date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amount numeric := 0;
  v_trips  jsonb;
begin
  /*
    ⚠ BOTH KEYS, AND THE LARGER ANSWER WINS. A leaver may have trips raised
      before their employee code was recorded (keyed only by user id) AND trips
      raised after (frozen with the code). Taking one key would silently under-
      report, and under-reporting here means the company writes off money at the
      exit door. `greatest` is the conservative reading and the right one.
  */
  if nullif(btrim(coalesce(p_employee_code, '')), '') is not null then
    v_amount := public.fms_travel_outstanding_advance_by_code(p_employee_code, p_as_at);
  end if;
  if p_user_id is not null then
    v_amount := greatest(v_amount, public.fms_travel_outstanding_advance(p_user_id, p_as_at));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'trip_id',   t.id,
           'trip_no',   t.trip_no,
           'status',    t.status,
           'paid',      t.advance_paid_amount,
           'recovered', coalesce(t.advance_recovered_amount, 0),
           'owed',      greatest(coalesce(t.advance_paid_amount, 0)
                                 - coalesce(t.advance_recovered_amount, 0), 0),
           'paid_on',   t.advance_paid_at
         ) order by t.advance_paid_at), '[]'::jsonb)
    into v_trips
    from public.fms_travel_trips t
   where coalesce(t.advance_paid_amount, 0) > 0
     and t.advance_paid_at::date <= p_as_at
     and (t.st_at is null or t.st_at::date > p_as_at)
     and (
          (p_user_id is not null and t.traveller_id = p_user_id)
       or (nullif(btrim(coalesce(p_employee_code, '')), '') is not null
           and upper(btrim(coalesce(t.traveller_employee_code, ''))) = upper(btrim(p_employee_code)))
     );

  return jsonb_build_object(
    'outstanding', round(coalesce(v_amount, 0), 2),
    'clear',       coalesce(v_amount, 0) = 0,
    'trips',       v_trips,
    'as_at',       p_as_at,
    -- ⚠ THE SENTENCE, NOT JUST THE NUMBER. Whoever ticks this box is an HR
    --   coordinator, not a travel administrator; "12000.00" tells them nothing
    --   about what to do next.
    'sentence',    case
      when coalesce(v_amount, 0) = 0
        then 'No travel advance is outstanding. This clearance can be ticked.'
      else 'Rs. ' || trim(to_char(v_amount, 'FM99,99,99,990.00'))
           || ' of travel advance is still unreconciled across '
           || coalesce(jsonb_array_length(v_trips), 0)
           || ' trip(s). Recover it in the full and final settlement under the '
           || 'Advance Recovery head; it does not have to hold the clearance open.'
    end);
end $$;

comment on function public.fms_travel_exit_clearance(text, uuid, date) is
  'What a leaver still owes in travel advance, for the hr-exit travel_advance clearance item. Reads BOTH employee code and user id and takes the larger, because a leaver can have trips raised under each and under-reporting here writes money off at the exit door. Returns the figure, the trips behind it, and the sentence the HR coordinator actually needs.';
grant execute on function public.fms_travel_exit_clearance(text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions: the item was found, and the recovery head it points at exists.
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean; v_head text;
begin
  select requires_file and allows_link into v_ok
    from public.fms_exit_clearance_items where key = 'travel_advance';
  if v_ok is null then
    raise exception 'The hr-exit travel_advance clearance item is missing - the hand-off has nothing to attach to';
  end if;
  if not v_ok then
    raise exception 'travel_advance did not take both flags';
  end if;

  select name into v_head from public.fms_exit_payroll_heads
   where kind = 'deduction' and name ilike 'advance recovery' and active;
  if v_head is null then
    raise exception 'The Advance Recovery deduction head is missing - the description points at a head that does not exist';
  end if;
  raise notice 'Exit hand-off live; recovery head is "%".', v_head;
end $$;

commit;
