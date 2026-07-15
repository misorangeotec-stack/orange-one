-- ===========================================================================
-- HR Recruitment FMS — additional onboarding checklist items.
--
-- The onboarding checklist is master-driven (fms_hr_onboarding_items), snapshotted
-- onto each hire when the joining date is set. These three items add the offer-
-- confirmation step the hiring team asked for, plus the appointment letter.
--
--   • Appointment letter is due_days = 0 → due ON the joining date. This is the
--     "appointment will be on the date of joining" requirement, expressed as data:
--     checkDueIso() = joining date + due_days working days, so 0 lands on the day.
--
-- No email is sent by the system — "Confirmation email sent" is the record that HR
-- did it (a file or Drive link may be attached as evidence).
--
-- NOTE: only NEW onboardings pick these up (the checklist is snapshotted at joining-
-- date time, so hires already in flight are unchanged — the same rule that protects
-- an in-flight hire from every other master edit).
--
-- Purely ADDITIVE. Reversal: delete these three keys.
-- ===========================================================================

insert into public.fms_hr_onboarding_items (key, name, description, requires_file, allows_link, due_days, sort_order) values
  ('offer_confirmation_sent', 'Send offer confirmation',
     'Send the candidate their offer confirmation once they are selected.', false, true, 0, 7),
  ('confirmation_email_sent', 'Confirmation email sent',
     'Record that the confirmation email has gone out (attach the mail or a link as evidence).', false, true, 1, 8),
  ('appointment_letter', 'Appointment letter',
     'Issue the appointment letter — dated as the joining date.', false, true, 0, 9)
on conflict (key) do nothing;
