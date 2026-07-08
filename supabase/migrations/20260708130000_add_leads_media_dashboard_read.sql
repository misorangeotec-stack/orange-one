-- Orange One LEADS DASHBOARD — cross-user MEDIA read (card scans, photos, voice).
--
-- The Leads Dashboard (web) resolves each lead's media from the PRIVATE
-- `lead-media` bucket to signed urls so managers can view photos + play voice
-- notes. But storage SELECT is owner-scoped (app_lead_media_select_own:
-- (storage.foldername(name))[1] = auth.uid()), so an admin/sales-head could only
-- sign THEIR OWN uploads — every other salesperson's photo/voice would 404.
--
-- This adds an ADDITIVE permissive SELECT policy on storage.objects for the
-- `lead-media` bucket, gated by the SAME authorization as the row-level dashboard
-- read (public.leads_dashboard_can_read(): admin OR granted the `leads-dashboard`
-- module). Postgres OR-combines permissive policies, so the owner-only policy is
-- untouched (the mobile app is unaffected; non-authorized users still can't read
-- others' media) and dashboard-authorized users can additionally sign ALL of it.
--
-- Purely ADDITIVE (one new policy; nothing existing is mutated). Depends on
-- public.leads_dashboard_can_read() from 20260708120000. Apply in the identity
-- project (ref coshondiqdhorwvibrwu).
--
-- Reversal:
--   drop policy if exists app_lead_media_select_dashboard on storage.objects;

drop policy if exists app_lead_media_select_dashboard on storage.objects;
create policy app_lead_media_select_dashboard on storage.objects
  for select using (bucket_id = 'lead-media' and public.leads_dashboard_can_read());
