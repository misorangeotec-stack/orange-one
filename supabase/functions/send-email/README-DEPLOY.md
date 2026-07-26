# send-email — execution checklist (Gmail API + OAuth refresh token)

Sends as **support@orangeotec.com** via the Gmail API using an **OAuth refresh token**.
Chosen because this Workspace tenant blocks BOTH app-password SMTP AND service-account
key creation (org policy `iam.managed.disableServiceAccountKeyCreation`). A user-consented
refresh token needs neither a key file nor domain-wide delegation, and Internal (Workspace)
OAuth apps issue **long-lived** refresh tokens.

Project ref (auth/identity): `coshondiqdhorwvibrwu`.
Nothing sends until the final step (the config row), so migrations + function can be
applied/deployed ahead of the Google setup.

---

## A. Google setup (one-time)

### A1. Enable Gmail API + OAuth consent (console.cloud.google.com)
1. Pick/create a project → **APIs & Services → Library** → enable **Gmail API**.
2. **APIs & Services → OAuth consent screen** → User type **Internal** → app name
   `Orange One`, support email support@orangeotec.com → Save. (Internal = no Google
   verification, and refresh tokens don't expire.)

### A2. Create an OAuth client (Web application)
1. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs** add: `https://developers.google.com/oauthplayground`
3. Create → copy the **Client ID** and **Client secret**.

### A3. Get a refresh token (OAuth 2.0 Playground)
1. Open **developers.google.com/oauthplayground**.
2. Top-right gear → tick **Use your own OAuth credentials** → paste Client ID + secret.
3. Left panel "Input your own scopes" → `https://www.googleapis.com/auth/gmail.send`
   → **Authorize APIs** → sign in as **support@orangeotec.com** → Allow.
4. **Step 2 → Exchange authorization code for tokens** → copy the **Refresh token**.

Hand off: **Client ID, Client secret, Refresh token** (→ B2 secrets).

---

## B. Supabase setup

### B1. Apply the two migrations (SQL editor or psql over the pooler)
- `supabase/migrations/20260721140000_add_email_outbox_and_task_email.sql`
- `supabase/migrations/20260721140100_add_email_dispatch.sql`  (dormant until B4)

### B2. Set the function secrets
```
supabase secrets set \
  EMAIL_DISPATCH_SECRET="<long random string>" \
  GMAIL_OAUTH_CLIENT_ID="<A2 client id>" \
  GMAIL_OAUTH_CLIENT_SECRET="<A2 client secret>" \
  GMAIL_OAUTH_REFRESH_TOKEN="<A3 refresh token>" \
  GMAIL_SENDER="support@orangeotec.com" \
  GMAIL_FROM="Orange One <support@orangeotec.com>" \
  APP_BASE_URL="https://<LIVE Vercel portal URL — see Production below>" \
  --project-ref coshondiqdhorwvibrwu
```

### B3. Deploy the function (needs `supabase login` / `SUPABASE_ACCESS_TOKEN`)
```
supabase functions deploy send-email --no-verify-jwt --project-ref coshondiqdhorwvibrwu
```

### B4. Smoke test to a SAFE address (before flipping the trigger on)
```sql
insert into public.email_outbox (kind, to_user_id, to_email, actor_id)
values ('task_assigned', gen_random_uuid(), 'YOUR_TEST_INBOX@example.com', null);
```
```
curl -i -X POST "https://coshondiqdhorwvibrwu.functions.supabase.co/send-email" \
  -H "x-dispatch-secret: <EMAIL_DISPATCH_SECRET>" \
  -H "Content-Type: application/json" -d '{}'
```
```sql
select status, subject, last_error, sent_at from public.email_outbox order by created_at desc limit 3;
```
Expect delivery + `status='sent'`. If `failed`, read `last_error`.

### B5. Flip it ON (single go-live switch)
```sql
insert into private.email_dispatch_config (id, function_url, dispatch_secret)
values (1, 'https://coshondiqdhorwvibrwu.functions.supabase.co/send-email', '<EMAIL_DISPATCH_SECRET>')
on conflict (id) do update
  set function_url = excluded.function_url, dispatch_secret = excluded.dispatch_secret;
```

### B6. Live end-to-end check
- Assign a real task to a **different** user → "New task" email within ~a second.
- Post a remark **@mentioning** a user → "mentioned you" email.
- No self-emails; a repeat mention / task edit doesn't re-send.

---

## Production / Vercel — why this "just works" live

The email engine is **entirely server-side in Supabase** (the `email_outbox` table, the
trigger + `send-email` Edge Function, and pg_cron). **No frontend code changed**, so a normal
Vercel deploy of the current frontend is unaffected and email works regardless of where the
UI is hosted. The ONLY tie to the live site:

- **`APP_BASE_URL` must be the production portal URL** (the live Vercel domain, e.g.
  `https://orange-one.vercel.app` or your custom domain) so the "Open task" buttons open the
  live app, not localhost.
- The Supabase project used here (`coshondiqdhorwvibrwu`) is the SAME one prod already uses for
  auth/tasks, so once B1–B5 are done, they serve production immediately — there is no separate
  "prod" Supabase to repeat this on.
- No new Vercel env vars are required for email.

Deploy order for a clean prod go-live: apply migrations (B1) → set secrets incl. the live
`APP_BASE_URL` (B2) → deploy function (B3) → smoke test (B4) → flip config on (B5). All of this
is Supabase-side and independent of the Vercel deploy.

## Pause / off
```sql
delete from private.email_dispatch_config where id = 1;   -- instant + sweep stop; rows just queue
```

## Rollback (full)
```sql
drop trigger if exists email_outbox_dispatch_trg on public.email_outbox;
drop function if exists private.email_outbox_dispatch();
drop function if exists private.email_outbox_sweep();
select cron.unschedule('email-outbox-sweep');
drop table if exists private.email_dispatch_config;
drop table if exists public.email_outbox;
-- then re-apply 20260721120100_notify_task_assignee.sql and db/migrations/0001_add_task_remark_rpc.sql
```

---

### Next (after Task Management is proven): FMS rollout
Each FMS app already computes the recipient and calls one `fms_<app>_announce(...)` RPC.
Add the same `email_outbox` enqueue inside those 5 RPCs, reusing `p_user_ids` + `p_text`.
The trigger, sweep, and this function need **no changes**.
