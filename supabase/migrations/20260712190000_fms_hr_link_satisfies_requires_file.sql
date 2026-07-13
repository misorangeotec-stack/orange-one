-- HR Recruitment — a Drive link must satisfy a "file required" checklist item.
--
-- THE BUG
-- The onboarding screen offers, for every item that allows one: "Attach a file …
-- OR paste a Drive link". But the tick was gated on the FILE alone:
--
--     if v_needsfile and v_file is null then raise exception '… needs a file' end if;
--
-- link_url was written to the row and then ignored. So an item marked `requires_file`
-- could never be ticked with a Drive link, no matter what the screen said. HR pastes
-- the link, presses "Mark done", and nothing happens — the word "or" was a lie.
--
-- That matters most for exactly the items it was designed for: a documents ZIP or an
-- offer letter that already lives in Drive and should not be re-uploaded into a second
-- store.
--
-- THE FIX
-- Evidence is a file OR — where the item permits it (`allows_link`) — a Drive link.
-- An item with `requires_file` and `allows_link = false` still demands a real upload,
-- which is the point of that flag: some documents must be held, not linked.
--
-- The link supplied in THIS call counts, exactly as the file supplied in this call
-- already did — otherwise HR would have to save the link first and tick second.

create or replace function public.fms_hr_toggle_onboarding_check(
  p_check          uuid,
  p_done           boolean,
  p_file_path      text default null,
  p_file_name      text default null,
  p_link_url       text default null,
  p_pending_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_onb        uuid;
  v_needsfile  boolean;
  v_allowslink boolean;
  v_name       text;
  v_file       text;
  v_link       text;
  v_req        uuid;
  v_joining    date;
  v_status     text;
  v_done       timestamptz;
begin
  select k.onboarding_id, k.requires_file, k.allows_link, k.name, k.file_path, k.link_url
    into v_onb, v_needsfile, v_allowslink, v_name, v_file, v_link
    from public.fms_hr_onboarding_checks k where k.id = p_check for update;
  if v_onb is null then raise exception 'Checklist item not found'; end if;

  select o.requisition_id, o.joining_date, o.offer_status, o.completed_at
    into v_req, v_joining, v_status, v_done
    from public.fms_hr_onboardings o where o.id = v_onb for update;

  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_done is not null then
    raise exception 'This onboarding is already complete';
  end if;
  if v_status in ('declined','no_show') then
    raise exception 'This candidate did not join — the checklist no longer applies';
  end if;
  if v_joining is null then
    raise exception 'Set the joining date first — it is what the checklist due dates are measured from';
  end if;

  -- Whatever arrived in THIS call counts as evidence, same as the file always did.
  v_file := coalesce(nullif(p_file_path, ''), v_file);
  v_link := coalesce(nullif(trim(p_link_url), ''), v_link);

  if p_done then
    if v_needsfile and v_file is null and not (v_allowslink and v_link is not null) then
      raise exception '% needs a file% before it can be ticked',
        v_name,
        case when v_allowslink then ' or a Drive link' else '' end;
    end if;

    update public.fms_hr_onboarding_checks set
      done           = true,
      done_at        = now(),          -- stamped automatically; HR never types a date
      done_by        = v_uid,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = null
    where id = p_check;

  else
    update public.fms_hr_onboarding_checks set
      done           = false,
      done_at        = null,
      done_by        = null,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = nullif(trim(p_pending_reason), '')
    where id = p_check;
  end if;

  -- Completion is decided here, not by the UI: the last tick (with the offer
  -- accepted) means the person joined, which fills a seat and may close the vacancy.
  perform public.fms_hr_try_complete_onboarding(v_onb);
end $$;

grant execute on function public.fms_hr_toggle_onboarding_check(uuid, boolean, text, text, text, text) to authenticated;
