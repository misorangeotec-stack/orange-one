# Edge Functions

## `admin-users`

Onboards / removes workspace users. Add/Delete user need the auth admin API
(service role), which can't run in the browser, so the admin UI calls this
function. The function **verifies the caller is an admin** before using the
service-role key. See `admin-users/index.ts` for the request shapes.

### Deploy (one-time per change)

Deploying needs a Supabase **management access token** (different from the
service-role key). Either run `supabase login` once, or export a token:

```bash
# from the repo root
export SUPABASE_ACCESS_TOKEN=<your token from https://supabase.com/dashboard/account/tokens>
REF=$(grep -E '^SUPABASE_PROJECT_REF=' .env | cut -d= -f2- | tr -d '"\r')

supabase functions deploy admin-users --project-ref "$REF"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by the platform — no secrets to set.

### After deploying

In `frontend/src/core/platform/store.tsx`, flip `canAddUser` and `canDeleteUser`
to `true`. The Add User form and the Users delete action then call the function.
Verify with a throwaway user (create → confirm the auth user + profile/role/
reporting/modules → delete → confirm cascade) before relying on it.
