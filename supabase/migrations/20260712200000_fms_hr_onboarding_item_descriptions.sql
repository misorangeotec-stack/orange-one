-- HR Recruitment — say what each onboarding step actually MEANS.
--
-- `description` has existed on both the master and the snapshotted checklist since the
-- start, and the screen already renders it — it was simply never filled in. So HR saw
-- six bare titles ("Complete filing of records internally") with no statement of what
-- doing them involves or what evidence to attach. A checklist nobody can interpret is
-- a checklist people tick to make it go away.
--
-- These stay editable in Setup → Masters. They are guidance, not rules — the rules are
-- requires_file / allows_link / due_days.
--
-- Backfill only touches rows whose description is still NULL, so nothing already written
-- (by us or by HR) is overwritten. Checklists are SNAPSHOTTED per hire on purpose, so the
-- backfill is applied to open checklists too — otherwise the hires in flight right now
-- would keep the blank version forever.

update public.fms_hr_onboarding_items set description = v.description
from (values
  ('offer_letter_sent',
   'Send the signed offer letter to the candidate. Attach the letter, or link it from Drive.'),
  ('documents_collection',
   'Collect ID proof, address proof, qualification certificates and past payslips. A single ZIP or a Drive folder is fine.'),
  ('police_verification',
   'Run the background / police check and file the report that comes back.'),
  ('filing_of_records',
   'Put the complete personnel record into the HR filing system, so it is findable without asking anyone.'),
  ('onboarding_form',
   'Complete the onboarding form and add the new joiner''s name and salary to the master employee list.'),
  ('seating_system_sim',
   'Arrange the desk, laptop, email and SIM, then generate their Employee ID in the HR system.')
) as v(key, description)
where public.fms_hr_onboarding_items.key = v.key
  and public.fms_hr_onboarding_items.description is null;

-- Same text onto checklists already handed to a hire (all currently blank).
update public.fms_hr_onboarding_checks c set description = i.description
from public.fms_hr_onboarding_items i
where c.item_key = i.key
  and c.description is null
  and i.description is not null;
