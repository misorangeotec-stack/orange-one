-- Rollback for 20270201120000_fms_complaint_credit_notes.sql.
-- ⚠ Drops every customer credit note and its document rows. The stored files in
--   fms-complaint-docs under cn/ are left behind (remove them via the Storage API).
begin;

drop policy if exists "fms complaint cn docs read"   on storage.objects;
drop policy if exists "fms complaint cn docs insert" on storage.objects;
drop policy if exists "fms complaint cn docs delete" on storage.objects;

drop function if exists public.fms_complaint_cn_doc_note(text);
drop function if exists public.fms_complaint_cn_delete_doc(uuid);
drop function if exists public.fms_complaint_cn_add_doc(uuid, jsonb);
drop function if exists public.fms_complaint_cn_record_tally(uuid, jsonb);
drop function if exists public.fms_complaint_cn_approve(uuid, jsonb);
drop function if exists public.fms_complaint_cn_submit(jsonb);
drop function if exists public.fms_complaint_cn_can_act(text, uuid);

drop table if exists public.fms_complaint_credit_note_docs;
drop table if exists public.fms_complaint_credit_notes;
drop function if exists public.fms_complaint_can_see_cn(uuid, uuid);

delete from public.fms_complaint_step_owners where step_key in ('cn_approval', 'cn_tally');
delete from public.fms_complaint_counters where scope like 'credit_note:%';
delete from public.fms_complaint_notifications where entity_type = 'credit_note';
delete from public.fms_complaint_activity where entity_type = 'credit_note';

commit;
