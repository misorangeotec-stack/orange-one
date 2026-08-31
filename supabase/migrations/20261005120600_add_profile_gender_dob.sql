-- ===========================================================================
-- profiles.gender + profiles.date_of_birth (Travel Desk prerequisite, Phase 3).
--
-- WHY A CORE TABLE IS TOUCHED FOR A MODULE
--   Every airline and every train operator needs a passenger's GENDER and DATE
--   OF BIRTH to issue a ticket. The portal holds neither. The source PRD's
--   answer is "passenger details are always entered manually for every
--   traveller" — which means an employee retypes their own date of birth on
--   every trip they ever take, and one typo becomes a denied boarding.
--
--   These are facts about a PERSON, not about travel, so they belong on
--   `profiles` rather than in `fms_travel_*`. Base city went the other way for
--   exactly the same reason: it is defined by the Travel Policy (§1.3, against
--   the appointment letter), nothing else in the portal uses it, and it lives on
--   fms_travel_employee_settings.
--
-- ⚠ THESE ARE **NOT** ADDED TO guard_profile_org_fields(), AND THAT IS A CHANGE
--   OF MIND FROM THE PLAN, WHICH SAID THEY WOULD BE.
--
--   That guard protects department, sub-department, designation, band and
--   employee code — every one of which decides what somebody is ENTITLED to or
--   PERMITTED to do, which is why only an administrator may set them. Band in
--   particular is what prices this entire module.
--
--   Gender and date of birth decide nothing. They are personal details used to
--   print a name on a ticket. Locking them behind an admin would mean HR typing
--   sixty dates of birth, and every subsequent correction becoming a request to
--   somebody else — for data whose only victim, if it is wrong, is the person
--   who owns it and who is best placed to fix it.
--
--   So: editable by the person themselves (Account) and by an administrator
--   (the User form), like `name` and `phone` already are.
--
-- ⚠ A NEW profiles COLUMN MUST ALSO BE ADDED TO THE EXPLICIT SELECT IN
--   frontend/src/core/platform/liveDirectory.ts. That query names its columns
--   one by one, so a column not listed there simply never reaches the browser —
--   silently, with no error anywhere.
--
-- Purely additive. Reversal:
--   alter table public.profiles
--     drop column if exists gender,
--     drop column if exists date_of_birth;
-- ===========================================================================

begin;

alter table public.profiles
  add column if not exists gender        text,
  add column if not exists date_of_birth date;

-- Constrained, but not narrowly. Airlines generally accept male/female and some
-- accept a third value; anything beyond that is not a ticketing concept, and a
-- free-text column here would produce "M", "m", "Male" and "MALE" within a
-- month.
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_gender_check') then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('male', 'female', 'other'));
  end if;
end $mig$;

comment on column public.profiles.gender is
  'Passenger gender, as airlines and rail operators require it for a ticket. Editable by the person themselves and by an administrator - it decides no entitlement, so it is deliberately NOT in guard_profile_org_fields().';

comment on column public.profiles.date_of_birth is
  'Passenger date of birth, as airlines and rail operators require it for a ticket. Editable by the person themselves and by an administrator.';


do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'gender'
  ) then
    raise exception 'profiles.gender did not install';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'date_of_birth'
  ) then
    raise exception 'profiles.date_of_birth did not install';
  end if;

  -- The CHECK actually bites.
  begin
    update public.profiles set gender = 'Male'
     where id = (select id from public.profiles limit 1);
    raise exception 'profiles.gender accepted an unconstrained value';
  exception
    when check_violation then null;  -- expected
  end;
end $mig$;

commit;
