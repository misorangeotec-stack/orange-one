-- KB-1 · The handbook's pictures.
--
-- Seven JPEGs, and SIX of them carry text no extraction can see: the Preface ("This manual
-- supersedes all previous personnel policies"), From the Director's Desk, both halves of the
-- Organization Chart, the Designation Hierarchy, and the back cover's address and phone.
-- Only the front cover is decorative. The reader pane shows the picture; kb_images.transcript
-- is what makes it answerable, and those transcripts are hand-written in
-- frontend/scripts/handbook-image-text.json.
--
-- Private, like every other bucket here. ONE rule: any staff member may read, and nobody
-- writes from a browser. The ingest script uploads with the service role, which does not
-- pass through these policies at all.
--
-- ADDITIVE ONLY: one bucket, one policy. Rollback: the _rollback.sql beside this.

insert into storage.buckets (id, name, public)
values ('kb-handbook-docs', 'kb-handbook-docs', false)
on conflict (id) do nothing;

drop policy if exists kb_handbook_docs_read on storage.objects;

-- `(select ...)` wrapping is deliberate: it hoists the call out of the per-row loop.
create policy kb_handbook_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'kb-handbook-docs'
    and (select public.is_staff((select auth.uid())))
  );
