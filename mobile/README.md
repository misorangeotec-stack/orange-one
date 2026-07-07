# Orange One — Mobile app

An [Expo](https://expo.dev) / React Native app that shares the Orange One
backend. It lives beside the web app (`../frontend`) as an independent Expo
project and authenticates against the **same** Supabase identity project, so
staff sign in with their existing Orange One accounts.

- **Expo SDK 54** (pinned — see [CLAUDE.md](./CLAUDE.md)), file-based routing via
  `expo-router`, session persisted with AsyncStorage.
- Runs in **Expo Go** on your phone — no dev build / custom native modules.

## Getting started

```bash
cd mobile
npm install

# One-time: create your local env (already pointed at the Orange One identity project)
cp .env.example .env   # then fill in the two EXPO_PUBLIC_SUPABASE_* values

npx expo start         # scan the QR with Expo Go (SDK 54) on your phone
```

Other targets: `npm run ios`, `npm run android`, `npm run web`.
Checks: `npm run lint`, `npm run typecheck`.

## What's here

```
src/
  app/            expo-router routes: index (Home), activity, profile, _layout
  components/     app-tabs (native) / app-tabs.web, auth-gate, auth-screen,
                  screen wrapper, themed-text / themed-view
  constants/      theme.ts — Orange One brand tokens (orange/navy) + spacing
  hooks/          use-auth (Supabase session), use-theme, use-color-scheme
  lib/            supabase.ts (client), database.types.ts (copy of the web
                  schema types), app-data.ts (typed profile read + device upsert)
```

The **Home** tab reads your own `profiles` row (typed, RLS-scoped) and can
register the device into `app_devices` — this proves end-to-end auth + read +
write before any real feature is built.

## Backend

- Same Supabase project as the web portal: **identity / Task Management**
  (`coshondiqdhorwvibrwu`). Sign-in only — accounts are provisioned by an admin
  in the web portal (a user's mobile number is their initial password).
- New mobile tables are **additive** and prefixed `app_`. The scaffold's table
  is created by `../supabase/migrations/20260703120000_add_app_mobile_core.sql`
  (`app_devices`, RLS-scoped to the owner). Apply it in the identity project
  before registering a device.

## Notes

- Env vars use Expo's `EXPO_PUBLIC_*` convention (the web app uses Vite's
  `VITE_*`). The URL + anon key are the same values.
- `database.types.ts` is a manual copy of
  `frontend/src/core/platform/database.types.ts` (plus the `app_devices` table).
  Keep it in sync when the schema changes — see the follow-up in CLAUDE.md.
- This app is **not** part of the Vercel web deploy; Vercel only builds
  `frontend/`. Shipping outside Expo Go would need EAS Build (`eas.json`).
