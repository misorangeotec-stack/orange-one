-- ===========================================================================
-- HR Recruitment FMS — attach a JD file to a requisition.
--
-- The requisition table already has jd_path / jd_name (added with the table in
-- 20260712130000), and submit/resubmit already carry them. What was missing is a
-- way to set them AFTER creation: a brand-new MRF has no id at the moment the JD is
-- picked, so the client creates the requisition, uploads to jd/<id>/… in the
-- fms-hr-docs bucket, then records the path here.
--
-- Authz: the person who raised it, or an admin. (The upload itself is separately
-- gated by the fms-hr-docs storage policy — any HR step owner / coordinator.)
--
-- Purely ADDITIVE. Reversal: drop the function.
-- ===========================================================================

create or replace function public.fms_hr_set_requisition_jd(
  p_req  uuid,
  p_path text default '',
  p_name text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_requester uuid;
begin
  select requester_id into v_requester
    from public.fms_hr_requisitions where id = p_req for update;
  if not found then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(v_uid) or v_requester = v_uid) then
    raise exception 'Not authorized to attach a JD to this requisition';
  end if;

  update public.fms_hr_requisitions set
    jd_path = nullif(trim(p_path), ''),
    jd_name = nullif(trim(p_name), '')
  where id = p_req;
end $$;

grant execute on function public.fms_hr_set_requisition_jd(uuid, text, text) to authenticated;
