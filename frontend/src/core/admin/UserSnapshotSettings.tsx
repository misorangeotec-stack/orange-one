/**
 * Admin → the PERSONAL daily snapshot: one mail per employee about their own work.
 *
 * Sits under the Master Report on the same page on purpose. They are the two
 * scheduled mails this portal sends and they share every mechanism — an
 * email_module gate, an hour picker that must really move the cron job, and a
 * test send — so putting them side by side is what makes the pair legible.
 *
 * ⚠ THE PREVIEW IS THE POINT OF THIS SCREEN. Every previous round of this feature
 *   shipped a number that disagreed with My Work Today, and the only way that was
 *   ever caught was a person comparing a mail to their screen. So the preview
 *   shows the same four tiles and the same per-module rows the mail will carry,
 *   next to SQL's independent Task Management count — if those two disagree, the
 *   report is lying and the screen says so rather than averaging them.
 */
import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import Toggle from "@/shared/components/ui/SettingToggle";
import {
  fetchUserSnapshotEmailEnabled,
  fetchUserSnapshotSchedule,
  fetchUserSnapshotSettings,
  previewUserSnapshot,
  saveUserSnapshotSettings,
  setUserSnapshotEmailEnabled,
  type UserSnapshotPreview,
  type UserSnapshotSchedule,
} from "@/core/platform/userSnapshot";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => {
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
};

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-page px-3 py-2.5 text-center">
      <div className={`text-[20px] font-extrabold leading-none ${value > 0 ? tone : "text-grey-2"}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-grey-2">{label}</div>
    </div>
  );
}

export default function UserSnapshotSettings() {
  const { user } = useSession();
  const { profiles } = useDirectory();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [emailModuleOn, setEmailModuleOn] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sendHour, setSendHour] = useState(9);
  const [skipWhenEmpty, setSkipWhenEmpty] = useState(true);
  const [includeUsers, setIncludeUsers] = useState<string[] | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [schedule, setSchedule] = useState<UserSnapshotSchedule | null>(null);

  const [previewFor, setPreviewFor] = useState("");
  const [preview, setPreview] = useState<UserSnapshotPreview | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, mod, sched] = await Promise.all([
          fetchUserSnapshotSettings(),
          fetchUserSnapshotEmailEnabled(),
          fetchUserSnapshotSchedule(),
        ]);
        if (!alive) return;
        setEnabled(s.enabled);
        setSendHour(s.sendHourIst);
        setSkipWhenEmpty(s.skipWhenEmpty);
        setIncludeUsers(s.includeUsers);
        setEmailModuleOn(mod);
        setSchedule(sched);
        if (user.id) setPreviewFor(user.id);
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
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 5000);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveUserSnapshotSettings({ enabled, sendHourIst: sendHour, skipWhenEmpty, includeUsers });
      // Read the LIVE job back rather than assuming the save moved it. The save
      // reschedules in the same transaction, so these must agree — and checking
      // is exactly what would have caught the Master Report's dead hour picker.
      setSchedule(await fetchUserSnapshotSchedule());
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
      await setUserSnapshotEmailEnabled(v);
      setEmailModuleOn(v);
      flash(v ? "Email switched on for the personal snapshot." : "Email switched off — nothing will be sent.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const userOptions = useMemo(
    () =>
      profiles
        .filter((p) => !!p.email)
        .map((p) => ({
          value: p.id,
          label: p.name,
          sublabel: [p.email, p.designation].filter(Boolean).join(" · "),
        })),
    [profiles],
  );

  const addOptions = useMemo(
    () => userOptions.filter((o) => !(includeUsers ?? []).includes(o.value)),
    [userOptions, includeUsers],
  );

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;

  const runPreview = async (sendTo?: string) => {
    if (!previewFor) { setError("Pick whose snapshot to look at."); return; }
    setBusy(true);
    setError(null);
    try {
      const p = await previewUserSnapshot(previewFor, sendTo ?? null);
      setPreview(p);
      if (sendTo) flash(`Queued a copy to ${sendTo}. It sends within about 3 minutes.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const recipients = includeUsers === null ? "everyone with a login" : `${includeUsers.length} chosen`;
  const live = enabled && emailModuleOn;

  // The one check this screen exists to make. SQL counts Task Management on its
  // own; the queue code counts it through the app's rules. They must agree.
  const taskRow = preview?.sources.find((s) => s.appId === "task-management");
  const mismatch =
    preview?.tasksSql && taskRow
      ? preview.tasksSql.open !== taskRow.items || preview.tasksSql.overdue !== taskRow.overdue
      : false;

  if (loading) return <Card className="p-6 text-[14px] text-grey">Loading…</Card>;

  return (
    <div className="space-y-5">
      <div className="border-t border-line pt-6">
        <h1 className="text-[22px] font-bold text-navy">Personal daily snapshot</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          One mail per employee each morning, showing what is on their own plate — the same figures
          as their My Work Today screen, worked out by the same code.
        </p>
      </div>

      {error && <Card className="border-ryg-red/30 bg-[#FDECEC] p-3.5 text-[13px] text-[#B3322F]">{error}</Card>}
      {notice && <Card className="border-[#bfe3cd] bg-[#E8F5EC] p-3.5 text-[13px] text-[#0F7A45]">{notice}</Card>}

      <Card className={`p-4 text-[13px] ${live ? "border-[#bfe3cd] bg-[#E8F5EC] text-[#0F7A45]" : "border-[#f0dcb4] bg-[#FDF3E2] text-[#9A6512]"}`}>
        {live ? (
          <>
            {/* The LIVE hour, not the picker's — the picker may hold an unsaved
                edit, and a banner naming a time the job does not run at is the
                exact failure this pair of screens has already had once. */}
            <b>Personal snapshots are live.</b> They go to {recipients} at{" "}
            {hourLabel(schedule?.hourIst ?? sendHour)} IST.
          </>
        ) : (
          <>
            <b>Nothing is being sent.</b>{" "}
            {!emailModuleOn
              ? "The email switch for this report is off — mail is dropped silently while it is."
              : "The daily send is switched off."}
          </>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Delivery</h2>
        <Toggle
          checked={emailModuleOn}
          onChange={(v) => void toggleEmailModule(v)}
          label="Email module"
          hint="This report's own mail switch — it does not affect the Master Report or any other module. Saved immediately. While it is off nothing mails, not even the test below, and it fails silently."
        />
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Send the daily snapshot"
          hint="The automatic morning send. One mail per person; a re-run on the same day will not mail anyone twice."
        />
        <Toggle
          checked={skipWhenEmpty}
          onChange={setSkipWhenEmpty}
          label="Skip people with nothing open"
          hint="Recommended. Mailing 'you have nothing to do' every morning is how a daily report gets filtered to trash by the people it is for."
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
            <span className="mt-1 block text-[12px] text-grey-2">
              {schedule?.schedule
                ? `Installed job: ${schedule.schedule} UTC${schedule.active ? "" : " (paused)"}`
                : "No job installed yet — save to create it."}
            </span>
          </label>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Who gets it</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            Everyone with a login, or a chosen few while you are trying it out.
          </p>
        </div>

        <Toggle
          checked={includeUsers === null}
          onChange={(v) => setIncludeUsers(v ? null : [])}
          label="Everyone with a login"
          hint="Off means only the people listed below receive it."
        />

        {includeUsers !== null && (
          <div className="space-y-3">
            <div className="max-w-md">
              <Combobox
                value={addUserId}
                onChange={(id) => {
                  if (!id) return;
                  setIncludeUsers((xs) => [...(xs ?? []), id]);
                  setAddUserId("");
                }}
                options={addOptions}
                placeholder="Add a person…"
              />
            </div>
            {includeUsers.length === 0 ? (
              <p className="text-[13px] text-grey-2">
                Nobody chosen yet, so nothing will be sent.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {includeUsers.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-page px-3 py-1 text-[13px] text-navy"
                  >
                    {nameOf(id)}
                    <button
                      type="button"
                      onClick={() => setIncludeUsers((xs) => (xs ?? []).filter((x) => x !== id))}
                      className="text-grey-2 hover:text-ryg-red"
                      aria-label={`Remove ${nameOf(id)}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Check one person's snapshot</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            Shows exactly what their mail will say. Open their My Work Today beside it — the four
            tiles and the per-module rows must read the same.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Combobox value={previewFor} onChange={setPreviewFor} options={userOptions} placeholder="Pick a person…" />
          </div>
          <Button variant="outline" disabled={busy} onClick={() => void runPreview()}>
            {busy ? "Working…" : "Show"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !emailModuleOn}
            onClick={() => void runPreview(user.email ?? undefined)}
            title={emailModuleOn ? "" : "Switch the email module on first"}
          >
            Email me a copy
          </Button>
        </div>

        {preview && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <div className="text-[13px] font-semibold text-navy">
              {preview.userName} — {preview.forDate} · {preview.totalItems} item
              {preview.totalItems === 1 ? "" : "s"}
            </div>

            <div className="flex gap-2">
              <Tile label="Overdue" value={preview.tiles.overdue} tone="text-ryg-red" />
              <Tile label="Due today" value={preview.tiles.dueToday} tone="text-[#B7791F]" />
              <Tile label="Next 2 days" value={preview.tiles.next2} tone="text-navy" />
              <Tile label="No date" value={preview.tiles.noDate} tone="text-grey" />
            </div>

            {preview.sources.length === 0 ? (
              <p className="text-[13px] text-grey-2">Nothing open for this person.</p>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {preview.sources.map((s) => (
                    <tr key={s.key} className="border-t border-line">
                      <td className="py-2 font-semibold text-navy">{s.module}</td>
                      <td className="py-2 text-right text-navy">{s.items} items</td>
                      <td className="py-2 pl-3 text-right">
                        {s.overdue > 0 ? (
                          <span className="rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11px] font-bold uppercase text-ryg-red">
                            {s.overdue} overdue
                          </span>
                        ) : (
                          <span className="text-[12px] text-grey-2">none overdue</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.uncounted.length > 0 && (
              <p className="text-[12.5px] text-grey-2">
                Not counted yet: {preview.uncounted.map((m) => m.label).join(", ")}. Their totals on
                My Work Today will be higher than this until those modules are wired in.
              </p>
            )}

            {mismatch && (
              <p className="rounded-lg bg-[#FDECEC] p-2.5 text-[12.5px] text-[#B3322F]">
                <b>These figures disagree with the database.</b> SQL counts {preview.tasksSql?.open}{" "}
                open and {preview.tasksSql?.overdue} overdue in Task Management. Two different
                answers means one of the two filters has drifted — do not send this until it is
                resolved.
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
