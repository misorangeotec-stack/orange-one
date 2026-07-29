-- ===========================================================================
-- Customer Onboarding leaves the Outstanding Dashboard and becomes its own
-- grantable module — carry the existing access across.
--
-- WHY THIS EXISTS AT ALL
--   The module used to be a subtree of the Receivables hub, so reaching it
--   required only the `outstanding-dashboard` grant. As a top-level app it is
--   gated by RequireModule on its own id, and on the morning it ships every one
--   of those users would find it gone from their launcher — not because anyone
--   revoked anything, but because the grant they hold no longer names it.
--
--   So: everyone who can open the hub today gets the new module too. Nobody
--   gains access they did not already have — this grants strictly the same set
--   of people, under the id that now identifies the same screens. Admins bypass
--   module checks entirely and are unaffected either way.
--
-- ADDITIVE AND IDEMPOTENT: inserts rows only, skips anyone who already has it,
-- and revokes nothing. Re-running changes nothing.
-- ===========================================================================

insert into public.app_access (user_id, app_id)
select a.user_id, 'customer-onboarding'
from public.app_access a
where a.app_id = 'outstanding-dashboard'
  and not exists (
    select 1 from public.app_access x
    where x.user_id = a.user_id
      and x.app_id = 'customer-onboarding'
  );
