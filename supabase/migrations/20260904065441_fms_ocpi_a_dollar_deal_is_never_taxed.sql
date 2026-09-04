/*
  OCPI-45 · A DOLLAR DEAL CARRIES NO GST.

  🔴 RITESH BHAI, 04-09-2026: "a dollar deal should never be taxed. If it is
     getting taxed in our scenario, that is wrong. The dollar deal should just be
     the amount multiplied by the conversion rate."

  Found by typing real folder 121 (Modi Dyeing, Rocket) into the live form. Its
  own Performa Invoice reads

      Machine Value USD 11,50,000.00 / @96 (Fluctuate Rate) / Total Value INR 11,04,00,000.00

  which is 11,50,000 x 96 exactly. Ours printed the same first two lines and then
  INR 13,02,72,000.00 -- 18% GST added -- while piPdf's dollar layout carries no
  tax line at all (deliberately, copied from folder 120). So the page's own
  figures did not reconcile and nothing on it accounted for Rs 1,98,72,000.

  🟢 SIX REAL DOLLAR PAPERS, EVERY ONE EXACT AND NONE TAXED:
       105  1,80,000 x 96 = 1,72,80,000
       106  1,70,000 x 95 = 1,61,50,000
       107, 109  6,250 x 96 = 6,00,000
       120  94,063 x 96 = 90,30,048
       121  11,50,000 x 96 = 11,04,00,000

  ⚠ ONE LINE, AND IT IS A WIDENING. `v_transport = 'high_seas'` already forced
    the rate NULL; a High Seas deal is always USD, so the new disjunct is a
    superset and nothing about High Seas changes. What changes is the "Others"
    deal quoted in dollars -- there are exactly two on record.

  ⚠ NO DATA IS MIGRATED. v_gst falls out NULL, total_inr collapses to v_value
    (= amount x fx), and grand_total_inr follows through guards that already
    exist. Stored rows keep their figures until somebody re-saves the deal, and
    every frozen revision keeps exactly what it printed. QT-M0040 (AADESH
    DIGITAL PRINTS, $1,00,000, awaiting approval) still holds Rs 17,10,000 of
    GST and will shed it the next time it is saved -- reported, not touched.

  ⚠ ITS TWIN IS RULE 5 in lib/branching.ts, which now hides the GST question on
    a dollar deal so `clearHidden` blanks it before the payload is built. This
    is the backstop, and the two must agree.

  ⚠ TRANSFORMED FROM THE LIVE BODY, not from a file on disk: the migrations
    diverge from what actually runs. Anchor asserted before and after.
*/
do $$
declare
  v_def  text;
  v_old  text := $a$  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;$a$;
  v_new  text := $a$  -- OCPI-45 · A DOLLAR DEAL IS NEVER TAXED (Ritesh Bhai, 04-09-2026), and
  -- neither is a High Seas sale. The second disjunct is a superset of the
  -- first -- a High Seas deal is always USD -- and both are kept because they
  -- are two separate rules that happen to overlap, not one rule stated twice.
  -- Its twin is RULE 5 in lib/branching.ts.
  v_rate := case when v_transport = 'high_seas' or v_currency = 'USD' then null
                 else nullif(p->>'gst_rate', '')::numeric end;$a$;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def is null then
    raise exception 'OCPI-45: fms_ocpi_write_oc not found';
  end if;

  -- PRE 1 · the clause exists, exactly once
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  if v_hits is distinct from 1 then
    raise exception 'OCPI-45 pre 1: expected the gst-rate clause exactly once, found %', v_hits;
  end if;

  -- PRE 2 · v_currency is assigned BEFORE the clause, or the new test reads null
  if position('v_currency' in v_def) > position(v_old in v_def) then
    raise exception 'OCPI-45 pre 2: v_currency is not set before the gst-rate clause';
  end if;

  -- PRE 3 · the money derivation this depends on is unchanged
  if v_def not like '%v_gst   := case when v_rate is null or v_value is null then null%' then
    raise exception 'OCPI-45 pre 3: the v_gst derivation is not what this change assumes';
  end if;

  execute replace(v_def, v_old, v_new);

  -- POST · the new clause is in, the old one is gone
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def not like '%v_transport = ''high_seas'' or v_currency = ''USD''%' then
    raise exception 'OCPI-45 post: the dollar disjunct did not land';
  end if;
  if position(v_old in v_def) > 0 then
    raise exception 'OCPI-45 post: the old clause is still present';
  end if;
end $$;
