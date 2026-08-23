-- ===========================================================================
-- OCPI FMS — register the module with the platform.
--
-- One row: the email gate, seeded OFF. Every module's outbound mail is gated by
-- email_module_settings.enabled (checked inside fms_<m>_announce), and a new
-- module must ship silent so nobody receives mail from a screen that is still
-- being built. An admin turns it on in Settings → Email Notifications.
--
-- ⚠ NO app_access ROWS ARE SEEDED, DELIBERATELY. Admins bypass module checks
--   entirely (module_level() returns 'edit' for them without consulting
--   app_access), so the module is reachable the moment it deploys. Every other
--   grant is a decision about a named person and belongs in Admin → Module
--   Access, not in a migration that would hand access to whoever happened to
--   match a query when it ran.
--
-- ⚠ 'ocpi' IS THE MANIFEST ID, and the same string is the key in three places:
--   app_access.app_id, email_module_settings.module_id, and the second argument
--   to module_can_edit()/module_is_viewer(). They must not drift.
--
-- Verified free before writing this: app_access holds no 'ocpi' rows.
--
-- Purely ADDITIVE. One seeded row.
--
-- Reversal:
--   delete from public.email_module_settings where module_id = 'ocpi';
-- ===========================================================================

insert into public.email_module_settings (module_id, enabled)
values ('ocpi', false)
on conflict (module_id) do nothing;
