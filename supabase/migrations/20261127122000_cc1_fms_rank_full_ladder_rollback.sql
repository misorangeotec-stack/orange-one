-- ROLLBACK for 20261127122000_cc1_fms_rank_full_ladder.sql — the board as the preview
-- migration left it: top five and the viewer only, no provisional place.

create or replace function public.fms_rank_board(p_month date default null, p_as uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer   uuid := auth.uid();
  v_viewer_admin boolean;
  v_uid      uuid;
  v_admin    boolean;
  v_current  date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_month    date;
  v_m        public.fms_rank_months%rowtype;
  v_me       public.fms_rank_scores%rowtype;
  v_size     integer;
  v_above    numeric;
  v_above_rk integer;
  v_t        numeric;
  v_k        integer;
  v_gap      jsonb;
  v_eotm     date;
  v_out      jsonb;
begin
  if v_viewer is null then raise exception 'Not signed in'; end if;
  if not public.fms_rank_can_view(v_viewer) then raise exception 'Not authorized'; end if;
  v_viewer_admin := public.is_admin(v_viewer);

  -- PREVIEW AS: an admin sees exactly what one person sees — that person's card, the
  -- top five, the employees of the month — and none of the admin section. Admins are
  -- not ranked themselves, so without this nobody could check the screen employees get.
  if p_as is not null then
    if not v_viewer_admin then raise exception 'Admins only'; end if;
    v_uid := p_as;
    v_admin := false;
  else
    v_uid := v_viewer;
    v_admin := v_viewer_admin;
  end if;
  v_month := coalesce(date_trunc('month', p_month)::date, v_current);

  select * into v_m from public.fms_rank_months where month = v_month;
  select * into v_me from public.fms_rank_scores where month = v_month and user_id = v_uid;
  v_size := coalesce(v_m.ladder_size, 0);

  -- "N more on-time steps to move up." Closing k more steps on time makes the score
  -- (points + k) / (given + k); it passes the next score up once that rounds above it,
  -- i.e. once it reaches (above + 0.05)%. Someone above on 100% can only be drawn level
  -- with, never passed — and only by reaching 99.95%.
  if v_me.ranked then
    select min(score) into v_above from public.fms_rank_scores
     where month = v_month and ranked and score > v_me.score;
    if v_above is not null then
      select min(rank) into v_above_rk from public.fms_rank_scores
       where month = v_month and ranked and score = v_above;
      v_t := case when v_above >= 100 then 0.9995 else (v_above + 0.05) / 100 end;
      v_k := greatest(1, ceil((v_t * v_me.given - v_me.points) / (1 - v_t)))::integer;
      v_gap := jsonb_build_object(
        'above_rank', v_above_rk, 'above_score', v_above,
        'steps', v_k, 'draw_level_only', v_above >= 100);
    end if;
  end if;

  -- Employees of the month: the last frozen month before the one being viewed (for the
  -- running month, that is last month).
  select max(month) into v_eotm from public.fms_rank_months
   where frozen_at is not null and month < greatest(v_month, v_current);
  if v_month < v_current and v_m.frozen_at is not null then
    v_eotm := v_month;
  end if;

  v_out := jsonb_build_object(
    'month', v_month,
    'current_month', v_current,
    'is_current', v_month = v_current,
    'frozen', v_m.frozen_at is not null,
    'frozen_at', v_m.frozen_at,
    'computed_at', v_m.computed_at,
    'ladder_size', v_size,
    'is_admin', v_admin,
    'viewer_is_admin', v_viewer_admin,
    'previewing', p_as,
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'frozen', frozen_at is not null) order by month)
                          from public.fms_rank_months), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(jsonb_build_object('module', module, 'active', active) order by module)
                           from public.fms_rank_modules), '[]'::jsonb),
    -- The top five, named. Ties can make it six.
    'top', coalesce((select jsonb_agg(jsonb_build_object(
                        'rank', s.rank, 'name', p.name, 'score', s.score, 'given', s.given,
                        'on_time', s.on_time, 'late', s.late, 'missed', s.missed, 'is_me', s.user_id = v_uid)
                        order by s.rank, s.given desc, p.name)
                       from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                      where s.month = v_month and s.ranked and s.rank <= 5), '[]'::jsonb),
    -- Everyone's score with no name attached, for "watch your rank move" on the what-if.
    'ladder_scores', coalesce((select jsonb_agg(score order by score desc)
                                 from public.fms_rank_scores where month = v_month and ranked), '[]'::jsonb),
    'me', case when v_me.user_id is null then null else jsonb_build_object(
            'given', v_me.given, 'on_time', v_me.on_time, 'late', v_me.late, 'missed', v_me.missed,
            'points', v_me.points, 'score', v_me.score, 'rank', v_me.rank,
            'ranked', v_me.ranked, 'not_ranked', v_me.not_ranked, 'by_module', v_me.by_module,
            'ahead_pct', case when v_me.ranked and v_size > 1 then round(100.0 *
                (select count(*) from public.fms_rank_scores o
                  where o.month = v_month and o.ranked and o.score < v_me.score) / (v_size - 1)) end,
            'gap', v_gap) end,
    'me_name', (select name from public.profiles where id = v_uid),
    'excluded_reason', (select reason from public.fms_rank_exclusions where user_id = v_uid),
    -- The caller's OWN open steps this month: overdue (scored 0) and not yet due.
    'my_open', coalesce((select jsonb_agg(jsonb_build_object(
                           'module', st.module, 'step', st.step_label, 'ref', st.ref,
                           'due_date', st.due_date, 'outcome', st.outcome)
                           order by st.due_date, st.ref)
                          from public.fms_rank_steps st
                          join public.fms_rank_modules m on m.module = st.module and m.active
                         where st.month = v_month and st.user_id = v_uid
                           and st.basis = 'open' and st.outcome in ('missed', 'upcoming')), '[]'::jsonb),
    'my_trend', coalesce((select jsonb_agg(jsonb_build_object('as_of', as_of, 'score', score, 'rank', rank, 'given', given)
                            order by as_of)
                           from public.fms_rank_history where month = v_month and user_id = v_uid), '[]'::jsonb),
    'my_history', coalesce((select jsonb_agg(jsonb_build_object(
                              'month', s.month, 'score', s.score, 'rank', s.rank, 'ranked', s.ranked,
                              'given', s.given, 'ladder_size', m.ladder_size, 'frozen', m.frozen_at is not null)
                              order by s.month)
                             from public.fms_rank_scores s join public.fms_rank_months m on m.month = s.month
                            where s.user_id = v_uid), '[]'::jsonb),
    'eotm', case when v_eotm is null then null else jsonb_build_object(
              'month', v_eotm,
              'podium', coalesce((select jsonb_agg(jsonb_build_object(
                           'rank', s.rank, 'name', p.name, 'score', s.score, 'given', s.given, 'is_me', s.user_id = v_uid)
                           order by s.rank, s.given desc, p.name)
                          from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                         where s.month = v_eotm and s.ranked and s.rank <= 3), '[]'::jsonb)) end
  );

  if v_admin then
    v_out := v_out || jsonb_build_object('admin', jsonb_build_object(
      'ladder', coalesce((select jsonb_agg(jsonb_build_object(
                    'user_id', s.user_id, 'name', p.name, 'rank', s.rank, 'score', s.score,
                    'given', s.given, 'on_time', s.on_time, 'late', s.late, 'missed', s.missed,
                    'points', s.points, 'ranked', s.ranked, 'not_ranked', s.not_ranked, 'by_module', s.by_module)
                    order by s.ranked desc, s.rank nulls last, s.score desc, p.name)
                   from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                  where s.month = v_month), '[]'::jsonb),
      'exclusions', coalesce((select jsonb_agg(jsonb_build_object(
                        'user_id', e.user_id, 'name', p.name, 'reason', e.reason,
                        'added_by', a.name, 'added_at', e.added_at) order by p.name)
                       from public.fms_rank_exclusions e
                       join public.profiles p on p.id = e.user_id
                       left join public.profiles a on a.id = e.added_by), '[]'::jsonb),
      'modules', coalesce((select jsonb_agg(jsonb_build_object(
                     'module', m.module, 'active', m.active, 'note', m.note,
                     'changed_by', p.name, 'changed_at', m.changed_at) order by m.module)
                    from public.fms_rank_modules m left join public.profiles p on p.id = m.changed_by), '[]'::jsonb),
      'run', v_m.modules,
      'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name) order by p.name)
                   from public.profiles p where not coalesce(p.is_external, false)), '[]'::jsonb)
    ));
  end if;

  return v_out;
end $$;
