import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import SettingToggle from "@/shared/components/ui/SettingToggle";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import {
  fetchMasterReportSettings,
  fetchMasterReportRecipients,
  fetchMasterReportModules,
  fetchMasterReportSchedule,
  saveMasterReportSettings,
  saveMasterReportRecipients,
} from "@/apps/master-report/data/settings";
import type {
  MasterReportModuleRow, MasterReportRecipient, MasterReportSchedule,
} from "@/apps/master-report/data/settings";
import {
  fetchMasterReportEmailEnabled,
  setMasterReportEmailEnabled,
  emailSnapshot,
} from "@/apps/master-report/lib/emailSnapshot";
import type { SnapshotRecipient } from "@/apps/master-report/lib/emailSnapshot";
import { fetchMasterSnapshot } from "@/apps/master-report/data/snapshot";
import UserSnapshotSettings from "./UserSnapshotSettings";
import { snapshotPdfBlob, snapshotFileName } from "@/apps/master-report/lib/exportSnapshotPdf";

/**
 * Admin -> Master Report. Controls the 08:00 IST digest.
 *
 * ⚠ THERE ARE TWO SWITCHES AND BOTH MUST BE ON. That is not an oversight:
 *   · "Email module" is the standard per-module gate every app in this portal
 *     has (email_module_settings), and every enqueue in the codebase is gated on
 *     it. It ships OFF, and while it is off mail is dropped SILENTLY.
 *   · "Daily report" is this feature's own switch.
 *   Splitting them means an admin can stop the daily digest without disabling
 *   the module's mail altogether, and the screen says so rather than hiding it.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => {
  const suffix = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
};

/** The switch both settings screens use. Moved out to break an import cycle. */
const Toggle = SettingToggle;

export default function MasterReportSettings() {
  const { user } = useSession();
  // The user master. This screen is admin-only, so the directory is complete.
  const { profiles } = useDirectory();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [emailModuleOn, setEmailModuleOn] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sendHour, setSendHour] = useState(8);
  const [dormantDays, setDormantDays] = useState(7);
  const [modules, setModules] = useState<MasterReportModuleRow[]>([]);
  const [included, setIncluded] = useState<string[] | null>(null);
  const [recipients, setRecipients] = useState<MasterReportRecipient[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newUserId, setNewUserId] = useState("");
  // Who the "send now" test goes to: "user:<id>" or "email:<address>".
  const [testTarget, setTestTarget] = useState("");
  /** Addresses typed into the test picker. Session-only — nothing is stored. */
  const [adhocEmails, setAdhocEmails] = useState<string[]>([]);
  // The LIVE cron job, not the stored setting. Kept apart on purpose — see
  // fetchMasterReportSchedule for the bug that made this necessary.
  const [schedule, setSchedule] = useState<MasterReportSchedule | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, r, m, mod, sched] = await Promise.all([
          fetchMasterReportSettings(),
          fetchMasterReportRecipients(),
          fetchMasterReportModules(),
          fetchMasterReportEmailEnabled(),
          fetchMasterReportSchedule(),
        ]);
        if (!alive) return;
        setEnabled(s.enabled);
        setSendHour(s.sendHourIst);
        setDormantDays(s.dormantAfterDays);
        setIncluded(s.includeModules);
        setRecipients(r);
        setModules(m);
        setEmailModuleOn(mod);
        setSchedule(sched);
        // Default the test at yourself — the common case, and it means the
        // button works on arrival without a selection.
        if (user.id) setTestTarget(`user:${user.id}`);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Recipients FIRST, deliberately. These are two separate writes with no
      // transaction spanning them, so one can succeed and the other throw. If the
      // switch is written first and the recipient write then fails, the report is
      // left ENABLED with an empty recipient table — live in the database, sending
      // to nobody, and the banner above reads its count from this component's state
      // and cheerfully says "live, 1 recipient". That is exactly what happened when
      // `set_master_report_recipients` was rejected for its bare DELETE.
      // In this order the failure is the safe one: the recipients are stored and the
      // switch stays where it was, so nothing is ever on with no one to send to.
      await saveMasterReportRecipients(
        recipients.map((r) => ({ email: r.email, name: r.name, enabled: r.enabled, userId: r.userId })),
      );
      await saveMasterReportSettings({
        enabled,
        sendHourIst: sendHour,
        dormantAfterDays: dormantDays,
        includeModules: included,
      });
      // Re-read the LIVE job rather than assuming the save moved it. The save
      // reschedules in the same transaction, so this should always agree — and
      // reading it back is precisely what would have caught the original bug.
      setSchedule(await fetchMasterReportSchedule());
      flash("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEmailModule = async (v: boolean) => {
    setError(null);
    try {
      await setMasterReportEmailEnabled(v);
      setEmailModuleOn(v);
      flash(v ? "Email switched on for the Master Report." : "Email switched off — nothing will be sent.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * Everyone the test can be sent to: the user master, plus any address typed
   * into the picker this session.
   *
   * Deliberately NOT filtered by the recipient list — the whole point of a test
   * is to try it before committing anyone to the daily send.
   */
  const testOptions = useMemo(() => {
    const fromUsers = profiles
      .filter((p) => !!p.email)
      .map((p) => ({
        value: `user:${p.id}`,
        label: p.name,
        sublabel: p.email ?? undefined,
        group: "Users",
      }));
    const typed = adhocEmails.map((e) => ({
      value: `email:${e}`, label: e, sublabel: "Typed address", group: "Other",
    }));
    return [...fromUsers, ...typed];
  }, [profiles, adhocEmails]);

  /** Turn "user:<id>" / "email:<addr>" back into something mailable. */
  const resolveTarget = (key: string): SnapshotRecipient | null => {
    if (key.startsWith("email:")) {
      const email = key.slice(6);
      return email ? { email } : null;
    }
    if (key.startsWith("user:")) {
      const p = profiles.find((x) => x.id === key.slice(5));
      return p?.email ? { email: p.email, name: p.name } : null;
    }
    return null;
  };

  // Proves the WHOLE pipeline — snapshot, PDF, upload, RPC, outbox, Gmail —
  // without waiting until 08:00 tomorrow to find out a secret is missing.
  const sendTest = async () => {
    const to = resolveTarget(testTarget);
    if (!to) { setError("Pick who the test should go to."); return; }
    setTesting(true);
    setError(null);
    try {
      const snap = await fetchMasterSnapshot(30);
      const blob = await snapshotPdfBlob(snap);
      await emailSnapshot({
        recipients: [to],
        subject: "Orange One — Master Report (test)",
        body: "This is a test send from Admin → Master Report. The daily digest looks like this.",
        pdf: { blob, filename: snapshotFileName(snap) },
      });
      flash(`Queued to ${to.email}. It sends within about 3 minutes.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  /**
   * The user master, as picker options. Only people with an address on file:
   * adding someone without one would create a recipient that can never receive
   * anything, and the server drops such a row anyway.
   */
  const userOptions = useMemo(() => {
    const taken = new Set(recipients.map((r) => r.userId).filter(Boolean));
    return profiles
      .filter((p) => !!p.email && !taken.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: [p.email, p.designation].filter(Boolean).join(" · "),
      }));
  }, [profiles, recipients]);

  /** Add from the user master. The address comes from their profile, never typed. */
  const addUserRecipient = (userId: string) => {
    const p = profiles.find((x) => x.id === userId);
    if (!p?.email) return;
    const email = p.email.trim().toLowerCase();
    if (recipients.some((r) => r.email === email)) { setError(`${email} is already on the list.`); return; }
    setError(null);
    setRecipients((rs) => [...rs, { id: `new-${userId}`, email, name: p.name, enabled: true, userId }]);
    setNewUserId("");
  };

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError(`"${email}" is not an email address.`); return; }
    if (recipients.some((r) => r.email === email)) { setError(`${email} is already on the list.`); return; }
    setError(null);
    setRecipients((rs) => [
      ...rs,
      { id: `new-${email}`, email, name: newName.trim() || null, enabled: true, userId: null },
    ]);
    setNewEmail("");
    setNewName("");
  };

  const allModules = included === null;
  const activeRecipients = recipients.filter((r) => r.enabled).length;
  const live = enabled && emailModuleOn && activeRecipients > 0;

  if (loading) return <Card className="p-6 text-[14px] text-grey">Loading settings…</Card>;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Master Report</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          The daily one-pager showing which modules are being used. View it any time at{" "}
          <Link to="/master-report" className="text-orange hover:underline">/master-report</Link>.
        </p>
      </div>

      {error && (
        <Card className="border-ryg-red/30 bg-[#FDECEC] p-3.5 text-[13px] text-[#B3322F]">{error}</Card>
      )}
      {notice && (
        <Card className="border-[#bfe3cd] bg-[#E8F5EC] p-3.5 text-[13px] text-[#0F7A45]">{notice}</Card>
      )}

      <Card className={`p-4 text-[13px] ${live ? "border-[#bfe3cd] bg-[#E8F5EC] text-[#0F7A45]" : "border-[#f0dcb4] bg-[#FDF3E2] text-[#9A6512]"}`}>
        {live ? (
          <>
            {/* The LIVE hour, not the one in the picker: the picker may hold an
                unsaved edit, and this banner claiming a time the job does not
                run at is the exact failure this screen used to have. */}
            <b>The daily report is live.</b> It goes to {activeRecipients} recipient
            {activeRecipients === 1 ? "" : "s"} at{" "}
            {hourLabel(schedule?.hourIst ?? sendHour)} IST.
          </>
        ) : (
          <>
            <b>Nothing is being sent.</b>{" "}
            {!emailModuleOn
              ? "The email module is switched off — mail is dropped silently while it is."
              : !enabled
                ? "The daily report switch is off."
                : "There are no enabled recipients."}
          </>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Delivery</h2>
        <Toggle
          checked={emailModuleOn}
          onChange={(v) => void toggleEmailModule(v)}
          label="Email module"
          // "Portal-wide gate" read as "this switches off mail everywhere". It
          // does the opposite of that: one row per module, and this is the
          // Master Report's own. Every other module has its own switch on its
          // own settings page, untouched by this one.
          hint="Master Report's own mail switch — it does not affect any other module. Saved immediately. While it is off, nothing mails, not even the test below, and it fails silently."
        />
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Send the daily report"
          hint="The automatic morning send only. Turn it off and you can still email the snapshot by hand. One mail per recipient; a re-run on the same day sends nothing twice."
        />
        <div className="flex flex-wrap items-end gap-5 pt-1">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-navy">Send at (IST)</span>
            <select
              value={sendHour}
              onChange={(e) => setSendHour(Number(e.target.value))}
              className="rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-navy"
            >
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            {/*
              The installed job, read back from cron rather than echoed from the
              input above. This setting used to write to the database and move
              nothing — the scheduler was pinned to a hard-coded hour — and the
              screen could not show that because it only ever displayed its own
              value. Saving now rewrites the job in the same transaction, and
              this line is the proof.
            */}
            <span className="mt-1 block text-[11.5px] text-grey-2">
              {!schedule ? (
                " "
              ) : !schedule.scheduled ? (
                <span className="font-semibold text-ryg-red">
                  No scheduled job found — nothing will send automatically.
                </span>
              ) : !schedule.active ? (
                <span className="font-semibold text-ryg-red">
                  The scheduled job is paused ({schedule.cron} UTC).
                </span>
              ) : schedule.hourIst !== sendHour ? (
                <span className="font-semibold text-[#9A6512]">
                  Not saved yet — the job still runs at {hourLabel(schedule.hourIst ?? 0)} IST.
                </span>
              ) : (
                <>Scheduled: {hourLabel(schedule.hourIst ?? 0)} IST &middot; {schedule.cron} UTC</>
              )}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-navy">Call a module dormant after</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={dormantDays}
                onChange={(e) => setDormantDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
                className="w-20 rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-navy"
              />
              <span className="text-[13px] text-grey">days with no activity</span>
            </div>
          </label>
        </div>
        <p className="text-[12px] text-grey-2">
          Saving the hour rewrites the <code className="text-[11.5px]">master-report-daily</code> job itself, in the
          same transaction — so the time shown here is always the time it actually runs.
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Recipients</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            Pick people from the user master — their address comes from their profile, so changing it in{" "}
            <Link to="/admin/users" className="text-orange hover:underline">Users</Link> follows through here.
            Untick to pause someone without losing them.
          </p>
        </div>

        {recipients.length === 0 && (
          <p className="text-[13px] text-grey-2">Nobody yet — the report will not be sent.</p>
        )}

        <div className="space-y-2">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) =>
                  setRecipients((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))
                }
                className="h-4 w-4 accent-orange"
              />
              {/* Name leads for a user-backed row — that is who this is. An
                  external address has no name to lead with, so it keeps the
                  old shape and is labelled, so the two are never confused. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-navy">
                  {r.name || r.email}
                </span>
                <span className="block truncate text-[12px] text-grey-2">
                  {r.name ? r.email : "External address"}
                  {!r.userId && r.name && " · external address"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRecipients((rs) => rs.filter((x) => x.id !== r.id))}
                className="text-[12.5px] font-semibold text-ryg-red hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-line pt-3">
          <span className="mb-1 block text-[12.5px] font-semibold text-navy">Add from users</span>
          <div className="w-full max-w-md">
            {/* Searchable — the directory runs to 57 people and a scroll-only
                list would be unusable. Selecting adds immediately, so the
                picker never holds a value of its own. */}
            <Combobox
              value={newUserId}
              onChange={addUserRecipient}
              options={userOptions}
              searchable
              placeholder={
                userOptions.length ? "Search by name or email…" : "Everyone with an address is already on the list"
              }
              disabled={userOptions.length === 0}
            />
          </div>

          <details className="mt-3">
            {/* Folded away: picking a user is the right path, and a free-typed
                address is the exception — a typo here mails nobody, silently,
                and nothing in Users will ever correct it. */}
            <summary className="cursor-pointer text-[12.5px] text-grey-2 hover:text-navy">
              Or add an address outside the company
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-semibold text-navy">Email</span>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
                  placeholder="auditor@example.com"
                  className="w-64 rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-navy"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-semibold text-navy">Name (optional)</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
                  className="w-48 rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-navy"
                />
              </label>
              <Button variant="ghost" size="sm" onClick={addRecipient}>Add</Button>
            </div>
          </details>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Modules in the report</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            All of them by default — including the unused ones, which is rather the point.
          </p>
        </div>
        <Toggle
          checked={allModules}
          onChange={(v) => setIncluded(v ? null : modules.map((m) => m.appId))}
          label="Include every module"
          hint="Turn off to pick a subset."
        />
        {!allModules && (
          <div className="grid gap-2 sm:grid-cols-2">
            {modules.map((m) => {
              const on = included?.includes(m.appId) ?? false;
              return (
                <label key={m.appId} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setIncluded((cur) => {
                        const base = cur ?? [];
                        return e.target.checked
                          ? [...base, m.appId]
                          : base.filter((id) => id !== m.appId);
                      })
                    }
                    className="h-4 w-4 accent-orange"
                  />
                  <span className="text-[13.5px] text-navy">{m.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </Card>

      {/*
        A test send that goes to WHOEVER you choose, not just yourself. It runs
        the entire pipeline — snapshot, PDF, upload, RPC, outbox, Gmail — so a
        missing secret or a wrong address surfaces now rather than at 08:00
        tomorrow. It ignores the recipient list above on purpose: the point is
        to see the mail before committing anyone to receiving it daily.
      */}
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Send a test</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            Sends today's report immediately, with the PDF attached. Nothing here is saved, and the recipient
            list above is not touched.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-navy">Send to</span>
            <div className="w-full min-w-[300px]">
              <Combobox
                value={testTarget}
                onChange={setTestTarget}
                options={testOptions}
                searchable
                placeholder="Pick a person, or type any address…"
                // Typing an address that matches nobody offers it as an option,
                // so a one-off test to an outside mailbox needs no second field.
                onCreate={(label) => {
                  const email = label.trim().toLowerCase();
                  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                    setError(`"${label}" is not an email address.`);
                    return;
                  }
                  setError(null);
                  setAdhocEmails((es) => (es.includes(email) ? es : [...es, email]));
                  return `email:${email}`;
                }}
                createLabel={(q) => `Send to "${q}"`}
              />
            </div>
          </label>
          <Button variant="outline" onClick={() => void sendTest()} disabled={testing || !emailModuleOn || !testTarget}>
            {testing ? "Sending…" : "Send now"}
          </Button>
        </div>

        {!emailModuleOn && (
          <p className="text-[12.5px] font-semibold text-[#9A6512]">
            Switch the email module on above — while it is off this sends nothing, silently.
          </p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>

      {/* The other scheduled mail. Same page on purpose: the two share every
          mechanism, and an admin looking for "when does the daily mail go out"
          should not have to know which of two screens it lives on. */}
      <UserSnapshotSettings />
    </div>
  );
}
