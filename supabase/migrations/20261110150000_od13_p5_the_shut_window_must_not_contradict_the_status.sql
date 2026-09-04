-- OD-13 · P5 — the closed-window sentence contradicted the status printed above it.
--
-- Applied to the live database on 04-09-2026 as
-- `od13_p5_the_shut_window_must_not_contradict_the_status`.
--
-- 🔴 SEEN ONLY ON SCREEN, WITH BOTH SENTENCES IN ONE GLANCE:
--
--      Placed
--      We have your order and are checking it now.
--      ...
--      This order is now being PREPARED and can no longer be changed.
--
--    Two answers to "what is happening to my order", eight lines apart, disagreeing. Neither
--    the code nor the SQL shows this: the pill is built from status_key and the refusal is a
--    string literal in a plpgsql function, and nothing but a rendered page puts them side by
--    side.
--
--    The refusal was written for the common case -- approved, therefore being prepared -- and
--    the window does not only shut that way. It shuts on ANY recorded credit decision, and a
--    CREDIT HOLD is one: cc_decided_at is stamped, the buttons go, and the customer's status
--    deliberately stays "Placed" because Q6 forbids telling them a hold happened. So the two
--    sentences were guaranteed to contradict each other on every held order -- the case where
--    the customer is most likely to be reading closely.
--
--    It also asserted something FALSE. On a credit hold nothing is being prepared; the order
--    is sitting still while we chase a payment. Telling a customer we are preparing goods we
--    have deliberately stopped is worse than saying nothing.
--
-- THE FIX IS TO STOP DESCRIBING OUR STATE AT ALL. The customer asked whether they can change
-- their order; the answer they need is about the order, not about which of our steps it is
-- sitting in. "Gone past the point where it can be changed" is true in every case that shuts
-- the window -- decided, held, partly approved, or half shipped -- and contradicts no pill,
-- because it makes no claim about what we are doing.
--
-- ⚠ THE BROWSER'S COPY CHANGED WITH IT (apps/customer-orders/lib/customerLabels.ts,
--   WINDOW_SHUT). The two are deliberately near-identical so that a stale tab racing a
--   decision shows the customer the same sentence twice rather than two different
--   explanations. Changing one alone would quietly turn that into the very thing it avoids.
--
-- Patched by substitution off pg_get_functiondef rather than by re-declaring the bodies, so
-- the two functions cannot pick up an unrelated drift from whatever this file last saw. The
-- anchor check aborts rather than patching blind.

do $$
declare
  v_src text;
  v_new text;
begin
  -- update: refuse to CHANGE
  v_src := pg_get_functiondef('public.fms_dispatch_update_customer_order(jsonb)'::regprocedure);
  if position('This order is now being prepared and can no longer be changed. Please call us if something needs to move.' in v_src) = 0 then
    raise exception 'anchor not found in fms_dispatch_update_customer_order - refusing to patch blind';
  end if;
  v_new := replace(v_src,
    'This order is now being prepared and can no longer be changed. Please call us if something needs to move.',
    'This order has gone past the point where it can be changed. Please call us if something needs to move.');
  execute v_new;

  -- cancel: refuse to CANCEL
  v_src := pg_get_functiondef('public.fms_dispatch_cancel_customer_order(jsonb)'::regprocedure);
  if position('This order is now being prepared and can no longer be cancelled. Please call us if something needs to move.' in v_src) = 0 then
    raise exception 'anchor not found in fms_dispatch_cancel_customer_order - refusing to patch blind';
  end if;
  v_new := replace(v_src,
    'This order is now being prepared and can no longer be cancelled. Please call us if something needs to move.',
    'This order has gone past the point where it can be cancelled. Please call us if something needs to move.');
  execute v_new;
end $$;

-- Prove it took, rather than trusting that it did.
do $$
begin
  if position('gone past the point where it can be changed' in
       pg_get_functiondef('public.fms_dispatch_update_customer_order(jsonb)'::regprocedure)) = 0
  or position('gone past the point where it can be cancelled' in
       pg_get_functiondef('public.fms_dispatch_cancel_customer_order(jsonb)'::regprocedure)) = 0
  or position('being prepared' in
       pg_get_functiondef('public.fms_dispatch_update_customer_order(jsonb)'::regprocedure)) > 0
  or position('being prepared' in
       pg_get_functiondef('public.fms_dispatch_cancel_customer_order(jsonb)'::regprocedure)) > 0
  then
    raise exception 'the wording did not change as intended';
  end if;
end $$;
