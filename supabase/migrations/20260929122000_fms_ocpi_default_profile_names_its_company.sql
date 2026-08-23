-- ===========================================================================
-- OCPI — the default company profile says WHICH company it is.
--
-- 20260929120000 seeded one profile: Orange O Tec Pvt Ltd's legal name, CIN,
-- registered address and the AXIS/SACHIN bank block, read verbatim off the
-- order-confirmation decks. It was inserted with `company_id = null` and
-- `is_default = true`, so it answered for everybody.
--
-- ⚠ THAT MADE THE FALLBACK INDISTINGUISHABLE FROM A MATCH. `profileFor()` looks
--   for the deal's own company first and drops back to the default — but with no
--   profile naming a company, EVERY deal took the fallback, including the 1,203
--   customers who really are Orange O Tec Pvt Ltd. A warning that fires on every
--   deal is a warning nobody reads, and the 675 customers who are NOT that
--   entity — Enterprises, either Noida arm, Colorix — are the ones whose
--   contracts print the wrong bank account, CIN and registered address.
--
--   Naming the company splits the two cases apart:
--     Orange O Tec Pvt Ltd deal  → exact match, silent, unchanged output
--     Enterprises / Noida / Colorix → fallback, and the screens that produce a
--                                     document now say so (SetupWarnings.tsx)
--     customer with no company at all → still the default, by is_default
--
-- ⚠ THIS IS AN IDENTIFICATION, NOT A BUSINESS DECISION. The profile already
--   carries "M/s ORANGE O TEC PVT LTD." as its legal name and CIN
--   U72200RJ2011PTC033991; the Tally company row is the same legal entity. What
--   the OTHER four entities should print — their own bank accounts, their own
--   letterhead artwork — is still an open question for the business, and this
--   migration deliberately does not invent an answer. It only stops the wrong
--   answer being given silently.
--
-- ⚠ THE TALLY COMPANY NAME CARRIES A FINANCIAL YEAR. When Tally opens the next
--   book, a NEW mst_companies row appears with a new id and the profile will not
--   match it — deals under it will fall back and warn, which is the correct
--   behaviour (somebody must point the profile at the new row) but is worth
--   knowing about in April rather than discovering then.
--
-- Additive: one UPDATE of a nullable column on a single row. Reversal:
--   update public.fms_ocpi_company_profiles set company_id = null where is_default;
-- ===========================================================================

begin;

do $$
declare
  v_company uuid;
  v_n       integer;
begin
  -- Matched on the name rather than a hardcoded id: the id is per-database, and
  -- an id typed into a migration is the kind of thing that silently matches
  -- nothing on a restore. The hyphenated Noida row ("...LIMITED-NOIDA-...") does
  -- not match this pattern, and the guard below refuses to act on ambiguity
  -- rather than picking one.
  -- min(uuid) does not exist in Postgres, hence the order-by/limit form.
  select count(*) into v_n
    from public.mst_companies
   where name ilike 'ORANGE O TEC PRIVATE LIMITED (%';

  select id into v_company
    from public.mst_companies
   where name ilike 'ORANGE O TEC PRIVATE LIMITED (%'
   order by name
   limit 1;

  if v_n <> 1 then
    raise exception
      'Expected exactly one "ORANGE O TEC PRIVATE LIMITED (...)" company, found %. Point the default profile at the right one by hand.', v_n;
  end if;

  -- Only if it is still unattached. If somebody has already set a company here,
  -- theirs is the decision that stands.
  update public.fms_ocpi_company_profiles
     set company_id = v_company
   where is_default
     and company_id is null;
end $$;

do $$
begin
  if not exists (
    select 1
      from public.fms_ocpi_company_profiles p
      join public.mst_companies c on c.id = p.company_id
     where p.is_default
       and c.name ilike 'ORANGE O TEC PRIVATE LIMITED (%'
  ) then
    raise exception 'The default OCPI company profile is not attached to Orange O Tec Private Limited';
  end if;
end $$;

commit;
