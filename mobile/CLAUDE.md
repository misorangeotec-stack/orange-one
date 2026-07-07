# CLAUDE.md — Orange One mobile app

Guidance for working in `mobile/` (the Expo / React Native app). The web app in
`../frontend` and the repo root have their own CLAUDE.md files — read those for
the wider Orange One architecture.

## What this is

A standalone **Expo SDK 54** app (file-based routing via `expo-router`) that
reuses the Orange One backend. It is a **sibling** of `frontend/`, not part of a
monorepo/workspace — its own `package.json`, its own `node_modules`, its own
Expo pipeline. The Vercel web deploy is scoped to `frontend/` and is unaffected
by anything here.

## Hard constraints

- **Pinned to Expo SDK 54.** The target phone runs Expo Go, which only supports
  SDK 54 — keep it running in **Expo Go** (no dev build, no custom native
  modules). Match the demo app's dependency versions; don't bump the SDK.
- **Supabase = the identity / Task Management project** (`coshondiqdhorwvibrwu`),
  the same one the web portal authenticates against. Accounts are the same;
  sign-in only (admins provision users in the web portal; mobile number is the
  initial password).
- **Schema is additive-only, `app_`-prefixed.** New mobile tables go in
  `../supabase/migrations/` named `*_add_app_*.sql`, are created (never alter
  existing tables), and are RLS-scoped to `auth.uid()`. Reuse the existing
  `public.set_updated_at()` trigger helper.

## Env vars

Expo uses `process.env.EXPO_PUBLIC_*` (inlined at build time), **not** Vite's
`import.meta.env.VITE_*`. The two values map 1:1 to the web app:

| Web (`frontend/.env.local`) | Mobile (`mobile/.env`)          |
| --------------------------- | ------------------------------- |
| `VITE_SUPABASE_URL`         | `EXPO_PUBLIC_SUPABASE_URL`       |
| `VITE_SUPABASE_ANON_KEY`    | `EXPO_PUBLIC_SUPABASE_ANON_KEY`  |

Restart `npx expo start` after editing `.env`.

## Layout & conventions

- Routes live in `src/app/` (not the conventional top-level `app/`) — the router
  root, mirroring the demo. Trigger names in `components/app-tabs.tsx` (native)
  and `components/app-tabs.web.tsx` (web) must match the route filenames and be
  edited together.
- Theming: `constants/theme.ts` holds the light/dark `Colors` + `Brand` (orange
  `#FF6A1F`, navy `#0B1B40`). Use `ThemedText` / `ThemedView` + `useTheme()`, not
  hardcoded colors.
- Data access: `lib/supabase.ts` is the single client (AsyncStorage session,
  PKCE, url-polyfill). Typed helpers live in `lib/app-data.ts`.

## Known follow-ups

- `lib/database.types.ts` is a **manual copy** of the web app's
  `frontend/src/core/platform/database.types.ts` with the `app_devices` table
  appended. When the schema changes, re-copy and re-append. A shared types
  package (workspace) would remove this duplication.
- No test runner (matches the rest of the repo); `npm run typecheck` +
  `npm run lint` are the gates.
- Shipping outside Expo Go needs EAS Build config (`eas.json`) — not set up yet.
