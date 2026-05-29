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
- [ ] 🔍 **Audit Phase 1**  ← run `cd frontend && npm run dev` → http://localhost:5173
- [x] _Committed + pushed to GitHub (backup)_

### Phase 2 — App shell + dashboard
- [ ] **5. App Shell** (sidebar + topbar + notifications bell + user menu), role-aware nav
- [ ] **6. Dashboard** — employee / HOD / admin variants
- [ ] 🔍 **Audit Phase 2**

### Phase 3 — Core task screens
- [ ] **7. Tasks list** — My Tasks / Today / Follow-Up / Pending (tabbed)
- [ ] **8. Create Task**
- [ ] **9. Task Detail** (+ activity feed + remarks/@mention composer)
- [ ] **10. Action modals** — Revise / Shift to next week / Mark Complete (incl. revision-limit disabled state)
- [ ] 🔍 **Audit Phase 3**

### Phase 4 — Manager & admin task views
- [ ] **11. Team Tasks** (HOD / sub-HOD)
- [ ] **12. All Tasks** (admin)
- [ ] 🔍 **Audit Phase 4**

### Phase 5 — Recurring tasks
- [ ] **13. Recurring list** + **Create/Edit recurring**
- [ ] 🔍 **Audit Phase 5**

### Phase 6 — Reports (Red/Yellow/Green)
- [ ] **14. Reports** — Weekly (RYG), Employee, HOD, Department
- [ ] **15. Activity History**
- [ ] 🔍 **Audit Phase 6**

### Phase 7 — Admin setup
- [ ] **16. Setup** — Onboarding checklist, Departments, Users, Add/Edit User, Hierarchy mapping
- [ ] 🔍 **Audit Phase 7**

### Phase 8 — Settings + utility
- [ ] **17. Settings** — Profile, Organization, Permissions (read-only)
- [ ] **18. Utility** — reusable Empty states, Access Denied, 404
- [ ] 🔍 **Audit Phase 8 (full frontend review)**

---

## STAGE B — Backend wiring (after frontend approved)
- [ ] Add supabase-js (anon key + RLS) + TanStack Query; generate TS types from schema
- [ ] AuthProvider / useAuth + route guards (RequireAuth / RequireRole)
- [ ] Per-entity data modules + query/mutation hooks; replace mock data with live queries
- [ ] Business rules: revision limit (2/week), shift-to-next-week linkage, complete, @mention fan-out
- [ ] Recurring-instance generation strategy (confirm approach)
- [ ] RYG weekly plans + notifications (realtime bell)
- [ ] Decide + (with approval) add Postgres RPCs for atomic shift / mention writes
- [ ] Env wiring (`.env.local` VITE_ vars); end-to-end verification per screen

---

_Last updated: Phase 1 in progress._
