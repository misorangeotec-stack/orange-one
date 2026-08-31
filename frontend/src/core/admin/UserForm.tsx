import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import { grantableModules, levelsForModule, NO_VIEW_ONLY_APP_IDS } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import { MODULE_LEVEL_LABEL, type AppRole, type ModuleLevel } from "@/core/platform/types";
import {
  PERMISSION_MENUS, menuAccessLevel, setMenuAccessLevel, levelsForMenu, type MenuAccessLevel,
} from "@/apps/receivables-hub/lib/menus";
import ReportAccessTree from "@/apps/receivables-hub/components/ReportAccessTree";
import ShareLoginModal from "./ShareLoginModal";

const RECEIVABLES_APP_ID = "outstanding-dashboard";

/**
 * Split a category's modules by their optional sub-group, preserving order and
 * keeping ungrouped ones in a leading unlabelled block — the same two-level split
 * the home menu renders (FMS → Purchase / HR).
 */
function bySubGroup<T extends { subGroup?: string }>(rows: T[]): { label: string | null; rows: T[] }[] {
  // Merge by label GLOBALLY, not just consecutively: apps in the same sub-group
  // (e.g. FMS → Purchase) need not be adjacent in registry order — General Purchase
  // sorts after the HR apps — and a consecutive-only merge would render a second
  // "Purchase" heading. Keep each sub-group in first-appearance order, matching the
  // sidebar's buildNodes (shared/components/layout/Sidebar.tsx).
  const out: { label: string | null; rows: T[] }[] = [];
  const byLabel = new Map<string | null, { label: string | null; rows: T[] }>();
  for (const row of rows) {
    const label = row.subGroup ?? null;
    let bucket = byLabel.get(label);
    if (!bucket) {
      bucket = { label, rows: [] };
      byLabel.set(label, bucket);
      out.push(bucket);
    }
    bucket.rows.push(row);
  }
  return out;
}

/**
 * One choice in a level row. Shared by the module-access block and the
 * Outstanding Dashboard menu block below it — the two are the same control
 * answering different questions, and they used to be two copies of this markup.
 */
function LevelPill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-pill border px-2.5 py-1 text-[12px] transition",
        on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-grey-2 hover:border-orange/40",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Labels for the receivables menu access levels. WHICH of them a given menu offers is decided
 * by `levelsForMenu` in lib/menus, not here — Settings has no standard tier and most menus have
 * no full tier, and offering a level a menu doesn't have would be a lie.
 */
const MENU_LEVEL_LABEL: Record<MenuAccessLevel, string> = {
  hidden: "Hidden",
  standard: "Visible",
  full: "Full access",
};

const ROLES: { value: AppRole; label: string; hint: string }[] = [
  { value: "employee", label: "Employee", hint: "Own tasks only" },
  { value: "sub_hod", label: "Sub-HOD", hint: "Team visibility, limited" },
  { value: "hod", label: "HOD / Manager", hint: "Team-level access" },
  { value: "admin", label: "Admin", hint: "Full access" },
];

export default function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profiles, departments, designations, bands, subDepartmentsFor, subDepartmentById, profileById, addUser, updateUser, addDepartment, canEditUser, canAddUser } = useDirectory();
  const editing = id ? profileById(id) : undefined;
  const canSave = editing ? canEditUser : canAddUser;
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [mobile, setMobile] = useState(editing?.phone ?? "");
  const [designationId, setDesignationId] = useState(editing?.designationId ?? "");
  const [role, setRole] = useState<AppRole>(editing?.role ?? "employee");
  const [departmentId, setDepartmentId] = useState(editing?.departmentId ?? "");
  const [subDepartmentId, setSubDepartmentId] = useState(editing?.subDepartmentId ?? "");
  const [bandId, setBandId] = useState(editing?.bandId ?? "");
  const [employeeCode, setEmployeeCode] = useState(editing?.employeeCode ?? "");
  // Ticketing details (Travel Desk). An airline will not issue a ticket without
  // both, and the alternative was every traveller retyping their own date of
  // birth on every trip - where one typo becomes a denied boarding.
  const [gender, setGender] = useState<string>(editing?.gender ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(editing?.dateOfBirth ?? "");
  const [hodIds, setHodIds] = useState<string[]>(editing?.hodIds ?? []);
  // ONE piece of state for both questions "which apps" and "how much of each" —
  // an id is granted iff it has a key here. Two collections (a granted list plus
  // a level map) is how the two drift apart, and a save built from a disagreeing
  // pair is unrecoverable from the UI.
  const [moduleLevels, setModuleLevels] = useState<Record<string, ModuleLevel>>(
    editing?.moduleLevels ?? { "task-management": "edit" },
  );
  const moduleAccess = Object.keys(moduleLevels);
  const [receivablesSalespersons, setReceivablesSalespersons] = useState<string[]>(editing?.receivablesSalespersons ?? []);
  // Outstanding Dashboard menu access — the two columns behind lib/menus:
  // hidden = deny-list ("may not see"), admin = allow-list ("may use at admin depth").
  const [receivablesHiddenMenus, setReceivablesHiddenMenus] = useState<string[]>(editing?.receivablesHiddenMenus ?? []);
  const [receivablesAdminMenus, setReceivablesAdminMenus] = useState<string[]>(editing?.receivablesAdminMenus ?? []);
  // Per-report grants (profiles.receivables_allowed_reports). An ALLOW-list — empty means the
  // user can open no report at all, which is the correct default for a new user.
  const [receivablesAllowedReports, setReceivablesAllowedReports] = useState<string[]>(editing?.receivablesAllowedReports ?? []);
  const [spNames, setSpNames] = useState<string[]>([]);
  const [spLoading, setSpLoading] = useState(false);
  const [spError, setSpError] = useState("");
  const [error, setError] = useState("");
  // After a successful save we land on a confirmation panel offering to share the
  // login details (instead of jumping straight back to the list). Holds the saved
  // identity + the mobile we pinned as the password so we can pre-fill the message.
  const [saved, setSaved] = useState<null | { name: string; email: string; password: string }>(null);
  const [shareOpen, setShareOpen] = useState(false);

  /**
   * Pickers offer ACTIVE master rows only — plus whatever this user is already
   * on, even if it has since been retired. Without that second half, opening a
   * user who sits on a switched-off department shows an empty box, and saving
   * would quietly move them to "no department".
   */
  const withCurrent = <T extends { id: string; active?: boolean }>(rows: T[], currentId: string, label: (r: T) => string) =>
    rows
      .filter((r) => (r.active ?? true) || r.id === currentId)
      .map((r) => ({ value: r.id, label: label(r), sublabel: (r.active ?? true) ? undefined : "switched off" }));

  const departmentOptions = withCurrent(departments, departmentId, (d) => d.name);
  const subDepartmentOptions = withCurrent(
    // subDepartmentsFor returns active rows under the chosen parent; the user's
    // own sub-department is added back below even if it has been retired.
    subDepartmentsFor(departmentId || null),
    subDepartmentId,
    (s) => s.name,
  ).concat(
    subDepartmentId && !subDepartmentsFor(departmentId || null).some((s) => s.id === subDepartmentId)
      ? [{ value: subDepartmentId, label: subDepartmentById(subDepartmentId)?.name ?? "(retired)", sublabel: "switched off" }]
      : [],
  );
  const designationOptions = withCurrent(designations, designationId, (d) => d.name);
  const bandOptions = withCurrent(bands, bandId, (b) => `Band ${b.bandNo} · ${b.name}`);

  /**
   * The designation text this user carries that no master row matches — e.g.
   * "Genral Manager", from before the master existed. Shown so an admin can see
   * what is there; the save keeps it untouched unless they actually pick a row.
   */
  const unmappedDesignation = !designationId && editing?.designation ? editing.designation : "";

  const candidateHods = profiles.filter((p) => (p.role === "hod" || p.role === "sub_hod") && p.id !== id);
  const toggleHod = (hid: string) => setHodIds((prev) => (prev.includes(hid) ? prev.filter((h) => h !== hid) : [...prev, hid]));
  /** Set one module's level, or revoke it with `null`. */
  const setModuleLevel = (mid: string, level: ModuleLevel | null) =>
    setModuleLevels((prev) => {
      const next = { ...prev };
      if (level === null) delete next[mid];
      else next[mid] = level;
      return next;
    });
  /**
   * Put a set of modules on one level, or revoke them all with `null`.
   *
   * ⚠ Modules with no view-only tier (`NO_VIEW_ONLY_APP_IDS` — the mobile app) are
   *   SKIPPED by a "View only" bulk action rather than being silently granted at
   *   full. "Give this person read access to everything" must never hand out a
   *   writable app as a side effect, and quietly revoking one they already hold
   *   would be just as surprising. So bulk-view leaves them exactly as they are.
   */
  const setLevelFor = (ids: string[], level: ModuleLevel | null) =>
    setModuleLevels((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (level === null) delete next[id];
        else if (level === "view" && NO_VIEW_ONLY_APP_IDS.has(id)) continue;
        else next[id] = level;
      }
      return next;
    });

  /** Grant or revoke a whole category at once — the "all the purchase apps" case. */
  const setGroupModules = (ids: string[], level: ModuleLevel | null) => setLevelFor(ids, level);

  const allModuleIds = grantableModules.map((m) => m.id);
  const setAllModules = (level: ModuleLevel | null) => setLevelFor(allModuleIds, level);

  /**
   * The one level every module in `ids` is on, or `undefined` when they differ —
   * which is what leaves all three bulk pills unhighlighted on a mixed set, rather
   * than lying that one of them is active.
   *
   * Modules with no view-only tier are excluded from the "view" verdict for the
   * same reason `setLevelFor` skips them: bulk-view never touches them, so their
   * state must not stop the row reading as "View only".
   */
  const uniformLevel = (ids: string[]): ModuleLevel | null | undefined => {
    if (!ids.length) return undefined;
    if (ids.every((id) => !moduleLevels[id])) return null;
    if (ids.every((id) => moduleLevels[id] === "edit")) return "edit";
    const viewable = ids.filter((id) => !NO_VIEW_ONLY_APP_IDS.has(id));
    if (viewable.length && viewable.every((id) => moduleLevels[id] === "view")) return "view";
    return undefined;
  };

  const allLevel = uniformLevel(allModuleIds);
  const toggleSalesperson = (n: string) =>
    setReceivablesSalespersons((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  // One helper for both lists: "hidden" must also drop the full-access grant, or a menu
  // re-shown later would silently come back elevated.
  const setMenuLevel = (menuKey: string, level: MenuAccessLevel) => {
    const next = setMenuAccessLevel(menuKey, level, receivablesHiddenMenus, receivablesAdminMenus);
    setReceivablesHiddenMenus(next.hidden);
    setReceivablesAdminMenus(next.admin);
  };

  // The email is a free-text username and nothing validates it, so a slip in the DOMAIN
  // creates an account that reads correctly on every screen but rejects the address its
  // owner believes is theirs — one user sat on "@orangotec.com" (missing the 'e') for a
  // month, signing in only because a live session spared him from ever typing it.
  //
  // Derived from the directory rather than hard-coded: the workspace domain is whatever
  // the other users are on, so this can't rot if the company ever moves domains. Needs a
  // few accounts to agree before it claims to know one, and it WARNS rather than blocks —
  // an external address (a gmail contractor, a shared vendor mailbox) is legitimate.
  const workspaceDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of profiles) {
      const d = p.email?.split("@")[1]?.trim().toLowerCase();
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
    return bestN >= 3 ? best : "";
  }, [profiles]);

  const typedDomain = email.trim().split("@")[1]?.toLowerCase() ?? "";
  const domainWarning = workspaceDomain && typedDomain && typedDomain !== workspaceDomain;

  /**
   * The menu-access and per-report pickers are RESTRICTIONS — "which parts may this person not
   * see". Meaningless for an admin, who sees all of it at full depth, so they stay hidden and are
   * cleared on save.
   */
  const showReceivablesLimits = role !== "admin" && moduleAccess.includes(RECEIVABLES_APP_ID);

  /**
   * The salesperson tag is shown to ADMINS TOO, and that is not an oversight.
   *
   * ⚠ IT IS NOW TWO QUESTIONS WEARING ONE FIELD.
   *   Originally `receivables_salespersons` meant only "whose figures may this person SEE", which
   *   an admin never needs — hence the old `role !== "admin"` gate, which also wiped the field on
   *   save. Then the scheduled collection email started resolving a salesperson NAME to an inbox
   *   through the same tag (`collections_report_due`). So the field now also answers "which
   *   salesperson's report is mailed to this person", and that one applies to everybody.
   *
   *   The cost of the old gate was invisible and total: Aayush and Karan are admins, so they could
   *   not be tagged with AAYUSH SIR / KARAN SIR, so their own reports went to credit control and
   *   never to them. There was no way to fix it from this screen — the field would not save.
   *
   * ⚠ TAGGING AN ADMIN CANNOT SHRINK WHAT THEY SEE. Checked every reader before changing this:
   *   `lib/scope.tsx` returns `isAdmin ? null : tags`, so the admin test comes first and the tag is
   *   never consulted for them. `useAppData` scopes off that context alone. The only other live
   *   readers are delivery (`EmailReportDialog`, `ReportDeliveryConfig`) — which is the point —
   *   and `useDefaultSalesperson`, where it merely pre-fills a dropdown the user can change.
   */
  const showSalespersonScope = moduleAccess.includes(RECEIVABLES_APP_ID);

  // Lazy-load the live salesperson names (ConnectWave ext_ledger_tags) the first
  // time the scope picker is shown, so the admin tags exact-matching values.
  //
  // ⚠ IMPORTED DYNAMICALLY, and it has to stay that way. connectwaveFetcher is a
  //   code-split chunk (useAppData / CustomerDetail / TallyPanel all import() it);
  //   a static import here is in the CORE admin form, so it would pull the entire
  //   hub fetcher and its second Supabase client into the entry bundle for every
  //   user — for the sake of one string list. Vite says so out loud if you try:
  //   "dynamically imported by … but also statically imported by … UserForm.tsx".
  useEffect(() => {
    if (!showSalespersonScope || spNames.length || spLoading) return;
    setSpLoading(true);
    setSpError("");
    import("@/apps/receivables-hub/lib/connectwaveFetcher")
      .then((m) => m.fetchSalespersonNames())
      .then(setSpNames)
      .catch((e) => setSpError((e as Error).message))
      .finally(() => setSpLoading(false));
  }, [showSalespersonScope, spNames.length, spLoading]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter a name.");
    // Normalise the mobile: strip all whitespace so the value used as the password
    // is predictable (a number entered as "90333 01207" must log in as "9033301207",
    // not with the literal space).
    const mobileNorm = mobile.replace(/\s+/g, "");
    if (!mobileNorm) return setError("Please enter a mobile number — it's the user's initial password.");
    if (mobileNorm.length < 6) return setError("Mobile number must be at least 6 digits (it's used as the password).");
    if (busy) return;
    // `designation` (text) is the mirror list_org_people() returns for @mention
    // pickers, so it travels with designation_id on every save. With nothing
    // picked, an existing unmapped value is preserved rather than blanked.
    const pickedDesignation = designations.find((d) => d.id === designationId);
    const base = {
      name: name.trim(),
      email: email.trim() || undefined,
      designation: pickedDesignation ? pickedDesignation.name : (editing?.designation ?? null),
      designationId: designationId || null,
      role,
      departmentId: departmentId || null,
      subDepartmentId: subDepartmentId || null,
      bandId: bandId || null,
      employeeCode: employeeCode.trim() || null,
      gender: (gender || null) as "male" | "female" | "other" | null,
      dateOfBirth: dateOfBirth || null,
      hodIds,
      moduleLevels,
      // The tag survives for an admin — it decides which report is MAILED to them, a question
      // that has nothing to do with what they may open. The three restriction lists do not:
      // clearing them is what keeps an admin's access unconditional.
      receivablesSalespersons: showSalespersonScope ? receivablesSalespersons : [],
      receivablesHiddenMenus: showReceivablesLimits ? receivablesHiddenMenus : [],
      receivablesAdminMenus: showReceivablesLimits ? receivablesAdminMenus : [],
      receivablesAllowedReports: showReceivablesLimits ? receivablesAllowedReports : [],
    };
    setBusy(true);
    setError("");
    try {
      // Saving always re-pins the password to the mobile number (workspace policy).
      if (editing) await updateUser(editing.id, { ...base, phone: mobileNorm });
      else await addUser({ ...base, mobile: mobileNorm });
      // Show the confirmation panel (with the "Share login details" action) rather
      // than bouncing back to the list — the mobile we just pinned is the password.
      setSaved({ name: base.name, email: base.email ?? "", password: mobileNorm });
      setBusy(false);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // Post-save confirmation: offer to share the login details before returning.
  if (saved) {
    return (
      <div className="max-w-2xl space-y-5">
        <h3 className="text-[18px] font-bold text-navy">{editing ? "User saved" : "User created"}</h3>
        <Card className="p-6">
          <div className="flex items-start gap-3.5">
            <span className="mt-0.5 w-10 h-10 rounded-full bg-orange-soft text-orange flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-navy">{saved.name} is all set.</p>
              <p className="text-[13px] text-grey mt-1 leading-relaxed">
                Their login password is their mobile number{saved.email ? <> and their username is <span className="font-medium text-navy">{saved.email}</span></> : ""}. Share the login details so they can sign in.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-5">
            <Button variant="ghost" onClick={() => navigate("/admin/users")}>Done</Button>
            <Button onClick={() => setShareOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></svg>
              Share login details
            </Button>
          </div>
        </Card>

        <ShareLoginModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          name={saved.name}
          email={saved.email}
          defaultPassword={saved.password}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <button onClick={() => navigate("/admin/users")} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to users
      </button>
      <h3 className="text-[18px] font-bold text-navy">{editing ? "Edit User" : "Add User"}</h3>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Full name" required><TextInput value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Priya Sharma" autoFocus /></FieldLabel>
            <FieldLabel label="Email / username" hint={editing ? "this is what they log in with" : undefined}>
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={workspaceDomain ? `name@${workspaceDomain}` : "name@orangeotec.com"} />
              {domainWarning && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-[#B26B00]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span>
                    <span className="font-medium">@{typedDomain}</span> isn't the usual <span className="font-medium">@{workspaceDomain}</span> — check for a typo. This is the exact address they'll have to type to log in.
                  </span>
                </p>
              )}
            </FieldLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Mobile number" required hint={editing ? "saving resets the login password to this" : "the user's initial password"}>
              <TextInput value={mobile} onChange={(e) => { setMobile(e.target.value); setError(""); }} placeholder="e.g. 9876543210" inputMode="tel" />
            </FieldLabel>
            <FieldLabel label="Employee code" hint="optional">
              <TextInput value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. OTPL-S-10092" />
            </FieldLabel>
          </div>
          {/*
            Gender and date of birth are what an airline or a rail operator needs
            to issue a ticket, and the portal held neither. Unlike department,
            designation and band - which the `guard_profile_org_fields` trigger
            reserves to an administrator because they decide entitlement - these
            decide nothing, so the person they describe can also correct their own
            under Account.
          */}
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Gender" hint="for travel bookings">
              <Combobox
                value={gender}
                onChange={setGender}
                clearable
                placeholder="— Not recorded —"
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                ]}
              />
            </FieldLabel>
            <FieldLabel label="Date of birth" hint="for travel bookings">
              <TextInput type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </FieldLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Department">
              <Combobox
                value={departmentId}
                onChange={(v) => {
                  setDepartmentId(v);
                  // The sub-department belongs to the OLD parent — keeping it would
                  // save a pairing the master says is impossible.
                  setSubDepartmentId("");
                }}
                placeholder="— None —"
                searchable
                options={[{ value: "", label: "— None —" }, ...departmentOptions]}
                onCreate={async (name) => await addDepartment({ name })}
                createLabel={(q) => `Add department “${q}”`}
              />
            </FieldLabel>
            <FieldLabel label="Sub-department" hint={departmentId ? undefined : "pick a department first"}>
              <Combobox
                value={subDepartmentId}
                onChange={setSubDepartmentId}
                placeholder={
                  !departmentId ? "pick a department first"
                    : subDepartmentOptions.length === 0 ? "none set up under this department"
                    : "— None —"
                }
                disabled={!departmentId}
                searchable
                options={[{ value: "", label: "— None —" }, ...subDepartmentOptions]}
              />
            </FieldLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel
              label="Designation"
              hint={unmappedDesignation ? undefined : "from the Organisation master"}
            >
              <Combobox
                value={designationId}
                onChange={setDesignationId}
                placeholder="— None —"
                searchable
                options={[{ value: "", label: "— None —" }, ...designationOptions]}
              />
              {unmappedDesignation && (
                <p className="mt-1.5 text-[11.5px] text-orange">
                  Currently recorded as “{unmappedDesignation}”, which isn’t on the designation list yet.
                  Leave this blank and it is kept as-is; pick one and it replaces it.
                </p>
              )}
            </FieldLabel>
            {/* Band is picked independently. Nothing about the designation above
                restricts it, and several designations may share a band. */}
            <FieldLabel label="Band" hint="independent of designation">
              <Combobox
                value={bandId}
                onChange={setBandId}
                placeholder="— None —"
                searchable
                options={[{ value: "", label: "— None —" }, ...bandOptions]}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Role">
            <div className="grid sm:grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={cn(
                    "text-left rounded-xl border px-3.5 py-2.5 transition",
                    role === r.value ? "border-orange bg-orange-soft/50 ring-2 ring-orange/15" : "border-line hover:border-orange/40"
                  )}
                >
                  <div className="text-[13px] font-semibold text-navy">{r.label}</div>
                  <div className="text-[11px] text-grey-2">{r.hint}</div>
                </button>
              ))}
            </div>
          </FieldLabel>

          {(role === "employee" || role === "sub_hod") && (
            <FieldLabel label="Reporting HOD(s)" hint="an employee can report to more than one">
              {candidateHods.length === 0 ? (
                <p className="text-[12.5px] text-grey-2">No HODs yet — add a HOD first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {candidateHods.map((h) => {
                    const on = hodIds.includes(h.id);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => toggleHod(h.id)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[12.5px] transition",
                          on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-navy hover:border-orange/40"
                        )}
                      >
                        <Avatar name={h.name} color={h.avatarColor} size={20} />
                        {h.name}
                        {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                      </button>
                    );
                  })}
                </div>
              )}
            </FieldLabel>
          )}

          <FieldLabel label="Module access" hint={role === "admin" ? "admins can open every app" : "which apps this user can open, and how much of each"}>
            {role === "admin" ? (
              <p className="text-[12.5px] text-grey-2">Admins have full access to all current and future apps.</p>
            ) : (
              /* Grouped by the SAME categories as the home menu (apps/categories.ts).
                 A flat list of every module was already hard to scan at ten; the
                 portal is heading for dozens. Per-group select-all is here because
                 "give this person all the FMS apps" is the common admin action. */
              <div className="space-y-4">
                <p className="text-[12px] text-grey-2">
                  View only can open the app and read everything in it, but cannot add, edit or
                  action anything.
                </p>

                {/* Set EVERY module at once. Setting fifteen modules one pill at a
                    time was the actual complaint: "give this person read access to
                    the whole portal" is a single decision, not fifteen. The
                    per-category row below stays for the narrower "all the purchase
                    apps" case. */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-grey-5/40 px-3 py-2.5">
                  <span className="text-[12.5px] font-medium text-navy">All modules</span>
                  <div className="flex shrink-0 gap-1.5">
                    <LevelPill on={allLevel === null} label="No access" onClick={() => setAllModules(null)} />
                    <LevelPill on={allLevel === "view"} label="View only" onClick={() => setAllModules("view")} />
                    <LevelPill on={allLevel === "edit"} label="Full access" onClick={() => setAllModules("edit")} />
                  </div>
                </div>

                {groupByCategory(grantableModules).map((group) => {
                  const ids = group.rows.map((a) => a.id);
                  const groupLevel = uniformLevel(ids);
                  return (
                    <div key={group.key}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-grey-2">
                          {group.label}
                        </span>
                        {/* Same three choices as a module row, applied to the whole
                            category — so "all of Purchase, read-only" is one click
                            rather than three. */}
                        <div className="flex shrink-0 gap-1.5">
                          <LevelPill on={groupLevel === null} label="No access" onClick={() => setGroupModules(ids, null)} />
                          <LevelPill on={groupLevel === "view"} label="View only" onClick={() => setGroupModules(ids, "view")} />
                          <LevelPill on={groupLevel === "edit"} label="Full access" onClick={() => setGroupModules(ids, "edit")} />
                        </div>
                      </div>
                      {/* Second level (FMS → Purchase / HR), same split as the menu. */}
                      {bySubGroup(group.rows).map((sub) => (
                      <div key={sub.label ?? "_"} className={sub.label ? "mt-2" : undefined}>
                      {sub.label && (
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-grey-2/70 mb-1">
                          {sub.label}
                        </div>
                      )}
                      {/* One row per module, name left and level pills right — the same
                          shape as the Outstanding Dashboard menu-access block further
                          down this form, so the two read alike. Single column rather
                          than the old two: three pills and a name do not fit twice
                          across at this width. */}
                      <div className="rounded-xl border border-line divide-y divide-line">
                        {sub.rows.map((a) => {
                          const level = moduleLevels[a.id];
                          const soon = a.status !== "live";
                          return (
                            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                              <div className="min-w-0">
                                <span className="block text-[13px] font-medium text-navy truncate">{a.name}</span>
                                {soon && <span className="block text-[10.5px] text-grey-2">Coming soon</span>}
                                {NO_VIEW_ONLY_APP_IDS.has(a.id) && (
                                  <span className="block text-[10.5px] text-grey-2">No view-only tier yet</span>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                <LevelPill on={!level} label="No access" onClick={() => setModuleLevel(a.id, null)} />
                                {levelsForModule(a.id).map((l) => (
                                  <LevelPill
                                    key={l}
                                    on={level === l}
                                    label={MODULE_LEVEL_LABEL[l]}
                                    onClick={() => setModuleLevel(a.id, l)}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </FieldLabel>

          {showReceivablesLimits && (
            <FieldLabel
              label="Outstanding Dashboard — menu access"
              hint="which left-nav menus this user gets, and how much of each"
            >
              <p className="text-[12px] text-grey-2 mb-2.5">
                Menus start at <span className="font-medium text-navy">Visible</span> unless you
                change them. <span className="font-medium text-navy">Full access</span> appears
                only where a menu has an admin-level tier, and gives the user that tier — the same
                depth an admin sees. <span className="font-medium text-navy">Settings</span> has no
                standard tier: it is Hidden until you grant it. Which reports the{" "}
                <span className="font-medium text-navy">Reports</span> menu then shows is set
                separately below — the menu alone grants nothing.
              </p>
              <div className="rounded-xl border border-line divide-y divide-line">
                {PERMISSION_MENUS.map((m) => {
                  const level = menuAccessLevel(m.key, receivablesHiddenMenus, receivablesAdminMenus);
                  const levels = levelsForMenu(m);
                  return (
                    <div key={m.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <span className="block text-[13px] font-medium text-navy">{m.title}</span>
                        {m.fullAccessNote && (
                          <span className="block text-[11.5px] text-grey-2">
                            Full access {m.fullAccessNote}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {levels.map((l) => (
                          <LevelPill
                            key={l}
                            on={level === l}
                            label={MENU_LEVEL_LABEL[l]}
                            onClick={() => setMenuLevel(m.key, l)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FieldLabel>
          )}

          {showReceivablesLimits && (
            <FieldLabel
              label="Outstanding Dashboard — report access"
              hint="which individual reports this user can open; nothing is granted by default"
            >
              <p className="text-[12px] text-grey-2 mb-2.5">
                Reports are granted one at a time, so a newly added report reaches nobody until you
                tick it here. Ticking a category is a shortcut for ticking everything inside it —
                it is not saved as a category, so a report added to that category later will
                <span className="font-medium text-navy"> not</span> be granted automatically.
              </p>
              <ReportAccessTree
                value={receivablesAllowedReports}
                onChange={setReceivablesAllowedReports}
              />
            </FieldLabel>
          )}

          {showSalespersonScope && (
            <FieldLabel
              label="Outstanding Dashboard — salesperson access"
              hint={
                role === "admin"
                  ? "admins see every salesperson; this only decides which reports are EMAILED to them"
                  : "which salesperson's data this user sees, and which reports are emailed to them"
              }
            >
              {spLoading ? (
                <p className="text-[12.5px] text-grey-2">Loading salespersons…</p>
              ) : spError ? (
                <p className="text-[12.5px] text-[#d4493f]">Couldn't load salespersons: {spError}</p>
              ) : spNames.length === 0 ? (
                <p className="text-[12.5px] text-grey-2">No salespersons found in the receivables data.</p>
              ) : (
                <>
                  {/* Two different warnings, because the same empty field means two different
                      things. For a non-admin it is a broken dashboard; for an admin the dashboard
                      is fine and only the emails are missing — saying "empty dashboard" there
                      would be simply false, and would push someone into tagging to fix a problem
                      they do not have. */}
                  {receivablesSalespersons.length === 0 && (
                    role === "admin" ? (
                      <p className="text-[12px] text-grey-2 mb-2">
                        Nothing tagged. This admin sees the whole dashboard either way, but no
                        salesperson's report will be emailed to them.
                      </p>
                    ) : (
                      <p className="text-[12px] text-[#d4493f] mb-2">
                        No salesperson selected — this user will see an empty dashboard until you tag at least one.
                      </p>
                    )
                  )}
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-auto p-0.5">
                    {spNames.map((n) => {
                      const on = receivablesSalespersons.includes(n);
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => toggleSalesperson(n)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12.5px] transition",
                            on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-navy hover:border-orange/40"
                          )}
                        >
                          {n}
                          {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </FieldLabel>
          )}

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {!canSave && (
              <span className="mr-auto text-[12.5px] text-grey-2">
                {editing ? "Read-only preview — saving is being wired next." : "Adding users needs an admin invite — coming soon."}
              </span>
            )}
            <Button variant="ghost" onClick={() => navigate("/admin/users")} disabled={busy}>{canSave ? "Cancel" : "Back"}</Button>
            <Button type="submit" disabled={!canSave || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
