# Orange One — Task Management Frontend · Build Tasks

Tracking the rebuild of the Task Management frontend as a unified React app.
**Workflow:** build one phase at a time → check it off → user audits in the browser → proceed.
Full plan: `C:\Users\etech\.claude\plans\now-the-main-thing-cached-rossum.md`

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · 🔍 = awaiting user audit

---

## STAGE A — Frontend (UI only, mock data, on-theme to index.html)

### Phase 1 — Foundation + entry screens  ✅ built · 🔍 awaiting audit
- [x] **0. Scaffold** Vite + React + TS + Tailwind in `frontend/`; clean module structure (core/shared/apps); theme ported from landing; configs minimized to root essentials
- [x] **1. Landing `/`** — faithful rebuild of index.html (palette, Poppins, animations); Login / Open Workspace / Task Management buttons wired
- [x] **2. Login** screen (+ link to Forgot Password)
- [x] ~~3. Forgot/Reset Password screens~~ — removed per user: password reset lives in-app (Profile, later) or via admin; no public reset/forgot on login
- [x] **4. Workspace Home** (registry-driven app launcher cards)
- [ ] ⏳ **Add dark-background logo file** → `frontend/public/assets/orange-one-logo-dark.png` (provided by user); wiring already done
- [x] 🔍 **Audit Phase 1** — approved by user ✅
- [x] _Committed + pushed to GitHub (backup)_

### Phase 2 — App shell + dashboard  ✅ built · 🔍 awaiting audit
- [x] **5. App Shell** — dark sidebar (role-aware nav), sticky topbar (notifications bell + user menu + dev "View as" role switcher), mobile drawer
- [x] **6. Dashboard** — employee / HOD / admin variants (stat cards, today/team/dept panels, RYG bar, status donut, activity feed)
- [x] _Mock data shaped like Supabase (real users/depts) + session context + selectors mirroring RLS_
- [x] 🔍 **Audit Phase 2** — approved by user ✅
- [x] _Committed + pushed to GitHub_

### Phase 3 — Core task screens  ✅ built · 🔍 awaiting audit
- [x] **Mock task store** — live mutations (create/start/revise/shift/complete/remark) + weekly revision-limit rule + mention fan-out
- [x] **7. Tasks list** — My Tasks with All/Today/Follow-ups/Pending tabs (counts) + search
- [x] **8. Create Task** — role-aware assignee options, dept auto-fill, due date
- [x] **9. Task Detail** — description, details sidebar (revisions left, follow-up, shift links), activity timeline + @mention remark composer
- [x] **10. Action modals** — Revise (follow-up + note, disabled at limit), Shift to next week (linked task), Mark Complete (note)
- [x] _Shared UI: Modal, Tabs, Form controls, EmptyState_
- [x] 🔍 **Audit Phase 3** — log in → Task Management → My Tasks. Try: open a task → Start / Revise / Shift / Complete; post an @mention remark; create a task. (`?role=` to switch views)
- [x] _Committed + pushed to GitHub_

### Phase 4 — Manager & admin task views  ✅ built · 🔍 awaiting audit
- [x] **Reusable TaskBrowser** — stats strip + filters (search / person / department / status / week) + list with assignee avatars
- [x] **11. Team Tasks** (HOD / sub-HOD) — direct reports' tasks, filter by team member
- [x] **12. All Tasks** (admin) — org-wide, filter by department + person
- [x] 🔍 **Audit Phase 4** (review with Phase 3) — `?role=hod` → Team Tasks; `?role=admin` → All Tasks
- [x] _Committed + pushed to GitHub_

### Phase 5 — Recurring tasks  ✅ built · 🔍 awaiting audit
- [x] **13. Recurring list** — daily/weekly templates, frequency text, assignee, active/pause toggle, edit + delete (confirm)
- [x] **Create/Edit Recurring** — title, description, assignee, Daily/Weekly toggle, weekday picker (weekly), active toggle
- [x] _Store extended with recurring CRUD; HOD/admin scoped_
- [x] 🔍 **Audit Phase 5** — `?role=hod` or `admin` → Recurring
- [x] _Committed + pushed to GitHub_

### Refinements (post Phase 3/4, applied)
- [x] Searchable dropdowns (Combobox) everywhere
- [x] Task actions: distinct buttons (Mark in progress / Revise / Mark complete); reschedule moved to Due date in Details (future-week date auto-shifts)

### Phase 6 — Reports (Red/Yellow/Green)  ✅ built · 🔍 awaiting audit
- [x] **14. Reports** — role-gated tabs Weekly / Employee / Team / Department; planned-vs-actual tiles, per-person RYG, status donut, avg RYG; contextual selectors (person/HOD/department)
- [x] **15. Activity History** — filterable audit trail (by action type + person), role-scoped, timeline with task links
- [x] _Report stat helpers (reportFor) in selectors_
- [x] 🔍 **Audit Phase 6** — `?role=admin` → Reports (try tabs) + Activity

### Phase 7 — Admin setup  ✅ built · 🔍 awaiting audit
- [x] **Directory promoted into store** — profiles + departments are now live/editable; admin mutators (add/edit/delete dept + user); directory helpers (profileById/directReportIds/assignableUsers/visibleTasks) moved to store; all consumers refactored
- [x] **16. Setup** — sub-nav shell + Onboarding checklist (live progress), Department Management (add/edit/delete), User Management (filters + role badges), Add/Edit User (role picker, department, multi-HOD reporting), Hierarchy mapping (teams + unmapped)
- [x] 🔍 **Audit Phase 7** — `?role=admin` → Setup
- [x] _Committed + pushed to GitHub_

### Phase 8 — Settings + utility  ✅ built · 🔍 awaiting audit
- [x] **17. Settings** — Profile (edit own details + in-app change password), Organization (workspace name / week-start / max-revisions, admin), Permissions (read-only role matrix, admin)
- [x] **18. Utility** — Empty states (reused), Access Denied (+ RequireRole guards on manager/admin routes), in-app 404
- [x] _Workspace settings promoted into store (live max-revisions feeds the revision rule)_
- [x] 🔍 **Audit Phase 8 / full frontend review**
- [x] _Committed + pushed to GitHub_

> 🎉 **STAGE A (frontend) COMPLETE** — all 34 screens built, on-theme, interactive with mock data. Next: Stage B (Supabase wiring).

---

## STAGE A.5 — Portal platform layer + per-user module access  ✅ built · 🔍 awaiting audit
Pulls identity/admin out of Task Management into the portal core so module access can be granted per user.
- [x] **Launcher trimmed** — workspace shows Task Management (live) + Outstanding Dashboard ("Coming soon", named) + one generic "More apps coming soon" tile; other named placeholders removed
- [x] **Identity lifted to `core/platform/`** — types, seed data, session, and a directory store (`useDirectory`) moved out of task-management; Task store now re-exposes the directory via pass-through so its existing consumers are unchanged; providers wrap the whole app in `main.tsx`
- [x] **`moduleAccess: string[]` on Profile** — denormalised read-model (like role/hodIds); `session.hasModule(appId)` (admins bypass)
- [x] **Core Admin area `/admin`** (admin-only) — Onboarding, Departments, Users + Add/Edit User (with module-access selector), Hierarchy, **Module Access matrix** (users × apps); reached via an Admin gear on the launcher
- [x] **Core account `/account`** — personal profile + password, for all users
- [x] **Access enforced** — launcher only shows apps the user can open; each live-app route is guarded (`RequireModule` → /home); admins see everything
- [x] _Task Management keeps only task-specific settings (Organization rules + Permissions matrix); its Setup screens were removed (moved to /admin)_
- [x] 🔍 **Audit Stage A.5** — log in → workspace (3 tiles) → Admin gear → manage users + module access; `?role=employee` to verify gating

---

## STAGE B — Backend wiring (in progress)
**Safety rule (user-critical): the live data is production. Only additive/read operations; never drop/alter/delete/truncate existing tables or rows without explicit per-action approval. Strategy: READ-ONLY first — migrate views to live data; defer all writes.**

### Phase B1 — Foundation ✅ done
- [x] `@supabase/supabase-js` + `@tanstack/react-query` installed
- [x] Env wiring — `frontend/.env.local` (gitignored) with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- [x] Single anon-key browser client `core/platform/supabase.ts` (RLS-gated; service-role key never in bundle)
- [x] **NEW table `app_access` created** `(id, user_id → profiles.id, app_id text, created_at, unique(user_id,app_id))` + RLS mirroring `user_roles`/`user_hods` (`app_access_select`: own rows OR `is_admin`; `app_access_admin_write`: admin-only ALL). Purely additive — no existing table/data touched.
- [ ] Generate TS DB types from schema (deferred — wiring per-entity types as we migrate)

### Phase B2 — Auth gate ✅ built · 🔍 awaiting full verify
- [x] `AuthProvider`/`useAuth` (real Supabase session) + `RequireAuth` guard on /home, /account, /admin, app routes
- [x] Login wired to `signInWithPassword` (real); Sign out wired everywhere; verified: bad creds → real "Invalid login credentials"; protected routes redirect to /login
- [x] 🔍 Successful login verified (yash@orangeotec.com) — lands on the workspace.

### Phase B3a — Live identity + directory (read-only) ✅ built · 🔍 awaiting audit
- [x] React Query wired; `core/platform/liveDirectory.ts` loads profiles + departments + roles + hierarchy + app_access from Supabase (RLS-gated) and maps to the `Profile`/`Department` read-model (role precedence, hex avatar colors, hodIds, moduleAccess)
- [x] Directory provider now loads LIVE and is READ-ONLY (`canWrite=false`; mutations are inert no-ops); session derives the current user from the auth session + live directory
- [x] Dev "View as" role switcher removed; you are who you log in as
- [x] Admin (Users/Departments/Hierarchy/Module Access) shows real data with a read-only banner + disabled write controls; Account page save disabled too
- [x] Task Management held behind a "connecting to live data" notice (its tasks are still mock; restored in B3b)
- [x] Verified live: logged in as Yash → /admin shows the real 13 users (roles, departments, reporting), avatars render, writes disabled, zero console errors, **no data written**

### Phase B3b — Live tasks/reports (read-only) ✅ built · 🔍 awaiting audit
- [x] `apps/task-management/data/fetchTaskData.ts` loads tasks / task_activity / notifications / recurring_tasks / weekly_plans / workspace_settings live (RLS-gated) and maps to the frontend types
- [x] Task store now loads LIVE via React Query and is READ-ONLY (`canWrite=false`; all task mutations inert no-ops); selectors (visibleTasks, revisionInfo, weeklyPlanFor) unchanged
- [x] Task Management module re-enabled (migration gate removed); module access already backed by live `app_access` (loaded into `moduleAccess` in B3a)
- [x] Read-only enforced across the app: banner in the task shell + hidden/disabled write controls (New Task, task actions, remark composer, reschedule, recurring CRUD, weekly-plan, organization save)
- [x] Verified live as Yash: dashboard shows the real 69 tasks (stats, dept performance, status donut); My Tasks + Task Detail show real tasks, activity and @mention remarks; writes disabled; no console errors; **nothing written to the DB**

### Phase B4 — Live mutations (option B: careful live writes) — IN PROGRESS
Backup taken before writes (`backups/`, gitignored; restore via RESTORE.md). Each flow: wire → test with a throwaway record I create + delete → verify row counts unchanged.
- [x] **Create task — LIVE & verified.** `data/taskWrites.ts insertTask` (RLS: created_by = auth.uid()); store `createTask` async + React-Query invalidation; per-flow flag `canCreateTask` (other task writes still read-only no-ops). Verified create→delete as Yash: 69→70→69, activity 264 (cascade clean), no real data touched. Found: a DB trigger auto-logs the `created` activity on insert.
- [x] **Task status actions: Start / Complete / Revise — LIVE & verified (+ 2/week revision limit).** `taskWrites.ts` adds `startTask`/`completeTask`/`reviseTask` (RLS update as signed-in user); store wires all three async + invalidation; per-flow flag `canStatusActions` (shift/remarks/recurring/etc. still read-only no-ops). Trigger-aware: the `log_task_activity` trigger auto-logs `completed`/`revised`/`shifted`/`followup`/`assigned` but NOT `started`, so the app logs `started` itself and skips manual logging for the others (no double-log); optional complete/revise notes are stored as a `remark`. Verified end-to-end as Yash on a throwaway: pending→in_progress (`started` row)→revise×2 (count 1→2, follow-up + trigger `followup`/`revised`, note→`remark`)→3rd revise blocked at 2/2→completed (`completed_at` + trigger `completed`); delete cascade-clean, counts 69/264/31 both before & after. **Bug found + fixed:** Revise/Complete modals stay mounted (`open=false`) so their note/date state persisted between opens and silently re-posted the prior note — added a reset-on-open `useEffect` to both; re-verified a 2nd note-less revise adds no stray `remark`.
- [x] **Reschedule / shift-to-next-week — LIVE & verified.** `taskWrites.ts rescheduleTask(task, newDueDate, actorId)`: same/earlier week → moves `due_date` (returns null); future week → inserts a *continuation* task (pending, fresh, `shifted_from_task_id`=original, `created_by`=shifter per RLS `with_check`, assignee/dept copied) and marks the original `shifted` with `shifted_to_task_id` (returns new id → UI navigates to it). Trigger auto-logs `shifted` (original) + `created` (continuation); no manual logging. Store `rescheduleTask` async + invalidation behind new `canReschedule` flag (gates the Due-date editor). Verified as Yash on a throwaway (due 06-03, week 06-01): same-week move → due 06-05, no new row, activity unchanged; next-week shift → continuation (due 06-12, week 06-08), original `shifted` + linked both ways, UI shows "Shifted from" link; counts 69→70→71→69 after deleting both (self-ref FKs are ON DELETE SET NULL, so delete continuation + original). Caveat noted in code: 2 writes, no transaction — atomic RPC is a candidate follow-up.
- [x] **@mention remarks + notification fan-out — LIVE & verified.** `notifications` has RLS on with no client INSERT policy, so a new **SECURITY DEFINER RPC** `add_task_remark(p_task_id, p_note, p_mentioned[])` (`db/migrations/0001_add_task_remark_rpc.sql`, applied via psql; user-approved DB change) does it atomically: inserts the `remark` activity (actor = auth.uid()), bumps `tasks.last_remark_at`, and inserts one `notifications` row per mentioned user (linked via `activity_id`) — guarded by a server-side visibility check mirroring the tasks SELECT policy; skips self-mentions; de-dups. Execute granted to `authenticated` only (revoked from public/anon). `taskWrites.addRemark` calls `supabase.rpc(...)`; store `addRemark` async + invalidation behind new `canRemark` flag; RemarkComposer gated + async with busy/error. Verified as Yash on a throwaway: @Aayush mention → 1 remark + 1 notification (unread, activity-linked); @self mention → remark only, no notification; delete task → notification cascades (`notifications.task_id` ON DELETE CASCADE); counts 69/264/31 before & after. NOTE: marking notifications read (bell) is a separate UPDATE flow, not yet wired.
- [x] **Recurring CRUD — LIVE & verified.** `taskWrites.ts`: `insertRecurring`/`updateRecurring`/`setRecurringActive`/`deleteRecurring` (RLS: insert created_by=auth.uid(); update created_by/admin/hod-of-assignee; delete created_by/admin). Store wires create/update/toggle/delete async + invalidation behind new `canRecurring` flag; RecurringList + RecurringForm gated on it with busy states. The live `recurrence_type` enum is **daily/weekly only** — removed the unsupported "monthly" option from the form + tidied copy (monthly collapses to daily defensively in the store). Verified as Yash on a throwaway (recurring_tasks started at 0): create weekly Mon/Wed → row with weekly_days [1,3]; edit title + switch to daily → weekly_days cleared to []; toggle → active false; delete → row gone. recurring_tasks back to 0; tasks/activity/notifs untouched (69/264/31).
- [x] **Weekly-plan upsert — LIVE & verified.** `taskWrites.ts upsertWeeklyPlan` branches update-vs-insert (keyed by the existing plan id) so an edit doesn't overwrite `created_by`; insert sets created_by=auth.uid(). Store `setWeeklyPlan` async (computes iso year/week + week_end via shared time helpers) + invalidation behind new `canWeeklyPlan` flag; WeeklyPlanModal async with busy/error; Reports "Set weekly plan" button gated on the flag. Constraints respected: UNIQUE(doer_id, iso_year, iso_week), CHECK red+yellow+green=100 (UI enforces before submit), RLS insert/update = admin OR hod-of-doer. Verified as Yash on a throwaway plan for **doer=Yash** (no existing plan → zero collision with the 3 real rows): insert wk24 R15/Y25/G60 → update same row to R20/Y30/G50 (same id, created_by preserved, count stayed 4) → delete (admin). weekly_plans back to 3 real rows unchanged; tasks/activity/notifs untouched.
- [x] **Department CRUD (admin) — LIVE & verified.** New `core/platform/directoryWrites.ts` (admin RLS `is_admin`); directory store wired async + invalidation with granular flags (`canManageDepartments` etc.); Departments.tsx async with busy/error. Verified as Yash on a throwaway dept: add (created_by=Yash) → edit (name+desc) → delete; back to the 5 real departments unchanged. **Architecture note:** `profiles.id → auth.users.id` with an `on_auth_user_created` trigger, so creating a brand-new user (and hard-deleting one) needs the auth admin API / a service-role Edge Function — not client-wireable. Add User / Delete User are therefore disabled with an explanatory tooltip (`canAddUser`/`canDeleteUser`=false).
- [ ] user edit (profile/role/reporting), module access (admin) — directoryWrites done; flags `canEditUser`/`canManageModules`/`canEditOwnProfile` flipped on after throwaway-user verification
- [ ] Business rules: revision limit (2/week), shift-to-next-week linkage, complete, @mention fan-out
- [ ] Recurring-instance generation strategy (confirm approach)
- [ ] RYG weekly plans + notifications (realtime bell)
- [ ] Decide + (with approval) add Postgres RPCs for atomic shift / mention writes
- [ ] End-to-end verification per screen

---

_Last updated: Stage B — B1/B2/B3a/B3b done (whole app reads live data). B4 in progress (option B, careful live writes): create-task, Start/Complete/Revise (2/week limit), reschedule/shift-to-next-week, and @mention remarks + notification fan-out (via the new add_task_remark SECURITY DEFINER RPC) all live & verified end-to-end via throwaway records (counts return to 69/264/31 each time; no real data touched). First production DB change made (additive RPC, user-approved, in db/migrations/). Recurring CRUD + weekly-plan upsert now live & verified too. Remaining writes (admin user/dept/role/module-access, mark-notifications-read) still read-only no-ops, rolling out next._
