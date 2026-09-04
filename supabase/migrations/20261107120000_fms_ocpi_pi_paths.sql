-- OCPI-36 · Stage 5 — where the Performa Invoice is stored.
--
-- Two nullable columns mirroring the two the other papers already use, and the
-- two write doors that fill them.
--
--   fms_ocpi_quotation_versions.pi_pdf_path  mirrors  pdf_path / oc_pdf_path
--   fms_ocpi_deals.pi_pdf_path               mirrors  oc_summary_pdf_path
--
-- ⚠ ADDITIVE ONLY. New nullable columns; nothing is dropped, mutated or
--   backfilled. Every deal issued before OCPI-36 keeps a null here, which is the
--   honest answer — those revisions never had a PI, and the panel says so in
--   words rather than rebuilding one that was never issued.
--
-- ── WHY THE APPROVED PATH GETS ITS OWN FUNCTION ────────────────────────────
--
-- 🔴 `fms_ocpi_freeze_oc` IS DELIBERATELY NOT TOUCHED. Adding a fifth parameter
--    to it would either create an OVERLOAD — leaving PostgREST with two
--    candidates for one call and no way to choose — or require dropping the live
--    4-argument version, which the currently DEPLOYED frontend is calling right
--    now. Dropping a function that production is mid-call on, to save writing a
--    two-line one, is not a trade worth making.
--
--    So the approved PI is filed by its own small RPC. It carries the same
--    authorization and the same path check as `freeze_oc`, because the file is
--    the same kind of thing and the storage policy derives the owning deal from
--    the first path segment either way.
--
-- ⚠ THE VERSION SLOT IS EXTENDED IN PLACE, and that one is safe: the signature
--   does not change, only the set of slot names it accepts. A deployed frontend
--   that never says 'pi' is unaffected.

/* ── 1 · the two columns ───────────────────────────────────────────────────── */
alter table public.fms_ocpi_quotation_versions
  add column if not exists pi_pdf_path text;

alter table public.fms_ocpi_deals
  add column if not exists pi_pdf_path text;

comment on column public.fms_ocpi_quotation_versions.pi_pdf_path is
  'OCPI-36 - the Performa Invoice frozen with this revision, beside pdf_path (summary) and oc_pdf_path (detailed sheet). Null on every revision issued before OCPI-36.';
comment on column public.fms_ocpi_deals.pi_pdf_path is
  'OCPI-36 - the approved Performa Invoice, beside oc_summary_pdf_path and oc_pdf_path.';

/* ── 2 · the version slot accepts 'pi' ─────────────────────────────────────── */
do $mig$
declare
  v_src    text;
  v_anchor text;
  v_hits   int;
begin
  v_src := pg_get_functiondef(
    'public.fms_ocpi_set_version_pdf(uuid,integer,text,text)'::regprocedure);

  v_anchor := $a$  if p_slot not in ('summary', 'detail') then$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_set_version_pdf: expected the slot guard exactly once, found %', v_hits;
  end if;
  v_src := replace(v_src, v_anchor, $b$  if p_slot not in ('summary', 'detail', 'pi') then$b$);

  v_anchor := $a$  if p_slot = 'summary' then
    update public.fms_ocpi_quotation_versions
       set pdf_path = p_path
     where deal_id = p_deal and version_no = p_version;
  else$a$;
  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'fms_ocpi_set_version_pdf: expected the summary branch exactly once, found %', v_hits;
  end if;
  v_src := replace(v_src, v_anchor, $b$  if p_slot = 'summary' then
    update public.fms_ocpi_quotation_versions
       set pdf_path = p_path
     where deal_id = p_deal and version_no = p_version;
  elsif p_slot = 'pi' then
    -- OCPI-36 · the third paper of the revision.
    update public.fms_ocpi_quotation_versions
       set pi_pdf_path = p_path
     where deal_id = p_deal and version_no = p_version;
  else$b$);

  execute v_src;
end $mig$;

/* ── 3 · the approved PI's own write door ──────────────────────────────────── */
create or replace function public.fms_ocpi_set_deal_pi_pdf(p_deal uuid, p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  /*
    The same three-way test `fms_ocpi_freeze_oc` applies, and for the same
    reason: the approver writes this file at the gate, the order-confirmation
    owner may re-file it, and the salesperson who raised the deal may re-issue
    their own papers.
  */
  if not public.fms_ocpi_can_act('quotation_approval', p_deal, v_uid)
     and not public.fms_ocpi_can_act('order_confirmation', p_deal, v_uid)
     and not exists (select 1 from public.fms_ocpi_deals where id = p_deal and raised_by = v_uid) then
    raise exception 'Not authorized';
  end if;
  /*
    ⚠ THE PATH MUST START WITH ITS OWN DEAL ID. The storage policy derives the
      owning deal from the first segment, so a file written anywhere else would
      be readable by the wrong people. Every other document RPC in this module
      refuses the same way.
  */
  if p_path is null or split_part(p_path, '/', 1) <> p_deal::text then
    raise exception 'A document path must start with its own deal id';
  end if;

  update public.fms_ocpi_deals
     set pi_pdf_path = p_path
   where id = p_deal;
end $fn$;

comment on function public.fms_ocpi_set_deal_pi_pdf(uuid, text) is
  'OCPI-36 - file the approved Performa Invoice on the deal. Separate from fms_ocpi_freeze_oc so that function keeps its live 4-argument signature.';
