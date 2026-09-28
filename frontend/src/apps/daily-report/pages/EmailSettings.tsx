import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, Select, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";

import {
  NO_SCHEDULE, useDailySendStatus, useEmailEnabled, useEmailRecipients, useEmailSchedule,
  useSaveEmailRecipients, useSaveEmailSchedule, useSetEmailEnabled,
  type BookRecipient, type ReportEmailFrequency, type ReportEmailSchedule,
} from "../data/emailSettings";
import { dmy } from "../lib/format";

/**
 * Daily Report → Settings: who gets the evening report, and when (DR-3).
 *
 * ── WHY THIS SCREEN EXISTS RATHER THAN A ROW ON THE RECEIVABLES SETTINGS PAGE ─────────
 * The Collection report's switch, schedule and list live on Receivables → Settings →
 * Permissions, because that is the screen an admin already opens to answer "who can see
 * which report". This report is not in that catalogue and is not that module's: access to
 * it is one `app_access` row of its own, and a CFO holding it must not need the
 * Outstanding Dashboard to change who receives their own report.
 *
 * The three tables underneath ARE the same ones (`report_email_settings`,
 * `report_email_schedule`, `report_email_recipients`, keyed `daily-report`) and the write
 * path is the same admin-only RPC. One store, two screens, because they answer to two
 * different holders.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OFFER ───────────────────────────────────────────────
 *   · The ARMING switch. That lever is `private.daily_report_email_config.armed`, set with
 *     `select set_daily_report_email_armed(true);`. It is the one control that turns an
 *     unattended nightly send ON, and it is deliberately not a button somebody can reach
 *     while exploring a settings page. The banner says plainly when it is off.
 *   · A salesperson list. This report has no per-salesperson version — see the data module.
 *   · A "send it now" button. The way to send by hand is the workflow's `sample` mode,
 *     which does not claim the slot; a button here would either double-send or need its own
 *     idempotency, and there is already one place that owns that decision.
 */

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FREQUENCIES: { value: ReportEmailFrequency; label: string }[] = [
  { value: "off", label: "Paused" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** The schedule as a sentence, so an admin reads back what they set rather than four controls. */
function describe(s: ReportEmailSchedule): string {
  const at = `${pad(s.hourIst)}:${pad(s.minuteIst)} IST`;
  if (s.frequency === "off") return "Paused. Nothing is sent.";
  if (s.frequency === "daily") return `Every evening at ${at}.`;
  if (s.frequency === "weekly") {
    const days = [...s.daysOfWeek].sort((a, b) => a - b).map((d) => DAYS_SHORT[d]);
    return days.length ? `Every ${days.join(", ")} at ${at}.` : `Weekly at ${at}, but no day is chosen.`;
  }
  return `On day ${s.dayOfMonth ?? "—"} of each month at ${at}.`;
}

/** A switch that reads as on/off at a glance, matching the receivables panel's. */
function Toggle({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border transition",
        on ? "border-orange bg-orange" : "border-grey-2 bg-white",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      <span
        className={[
          "h-3.5 w-3.5 rounded-pill bg-white shadow transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px] border border-line",
        ].join(" ")}
      />
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────── the banner ── */

/**
 * Whether the chain will actually send, in the gate's own words.
 *
 * ⚠ IT NEVER ASSERTS ANYTHING THE DATABASE HAS NOT SAID. The receivables panel once carried a
 *   hard-coded "saved but not yet active" note that outlived the runner shipping, and told admins
 *   their working schedule was inert for weeks. Every sentence below comes from the gate.
 */
function StatusBanner() {
  const { data, isLoading, error } = useDailySendStatus();

  if (isLoading) {
    return <p className="px-4 py-3 text-xs text-grey">Checking whether the evening send is live…</p>;
  }
  if (error) {
    return (
      <p className="px-4 py-3 text-xs text-ryg-red">
        Could not read the schedule: {error instanceof Error ? error.message : "unknown error"}
        {/* The most likely cause by far, said out loud rather than left to be guessed. */}
        <span className="mt-1 block text-grey">
          If this says the function is missing, the DR-3 migration has not been applied to this
          project yet.
        </span>
      </p>
    );
  }
  if (!data) return null;

  const tone = data.live ? "text-ryg-green" : "text-ryg-yellow";
  return (
    <div className="space-y-1.5 px-4 py-3">
      <p className={`text-sm font-semibold ${tone}`}>
        {data.live ? "The evening send is live." : "Nothing will be sent."}
      </p>
      {!data.live && data.reason && (
        <p className="text-xs text-grey">
          The scheduler says: <span className="text-navy">{data.reason}</span>
          {/* Only this reason has its fix somewhere a screen cannot reach. */}
          {/^automatic sending is not armed/i.test(data.reason) && (
            <span className="mt-1 block">
              Arming is a deliberate act and is not a control on this page. Run{" "}
              <code className="rounded bg-page px-1 py-0.5 text-[11px]">
                select set_daily_report_email_armed(true);
              </code>{" "}
              once everything below has been checked.
            </span>
          )}
        </p>
      )}
      {data.live && data.reason && (
        <p className="text-xs text-grey">
          Right now: <span className="text-navy">{data.reason}</span>
        </p>
      )}
      {data.bookCount !== null && (
        <p className="text-xs text-grey">
          The next send resolves to {data.bookCount}{" "}
          {data.bookCount === 1 ? "address" : "addresses"}.
        </p>
      )}
      {data.balances && data.balances.expected > 0 && (
        <p className="text-xs text-grey">
          Bank balances for the day being considered: {data.balances.entered} of{" "}
          {data.balances.expected} entered.{" "}
          {data.balances.entered < data.balances.expected && (
            <>
              The report goes out at its fixed time regardless and says so on the mail.{" "}
              <Link to="/daily-report/bank-balances" className="text-orange underline">
                Type them
              </Link>
              .
            </>
          )}
        </p>
      )}
      {data.lastSentFor && (
        <p className="text-xs text-grey">
          Last sent for {dmy(data.lastSentFor)}
          {data.lastBalances?.expected
            ? ` with ${data.lastBalances.entered ?? 0} of ${data.lastBalances.expected} bank balances entered`
            : ""}
          .
        </p>
      )}
      {data.strays.length > 0 && (
        <p className="text-xs text-ryg-yellow">
          {data.strays.length} salesperson {data.strays.length === 1 ? "entry" : "entries"} on this
          report's list reach nobody: {data.strays.join(", ")}. This report has no per-salesperson
          version.
        </p>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── the page ── */

export default function EmailSettings() {
  const { isAdmin } = useSession();

  const enabledQ = useEmailEnabled();
  const scheduleQ = useEmailSchedule();
  const recipQ = useEmailRecipients();

  const flip = useSetEmailEnabled();
  const saveSchedule = useSaveEmailSchedule();
  const saveRecipients = useSaveEmailRecipients();

  const [draft, setDraft] = useState<ReportEmailSchedule | null>(null);
  const [book, setBook] = useState<BookRecipient[] | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  /**
   * ⚠ SEEDED FROM THE SERVER, NOT INITIALISED FROM IT.
   *   `useState(query.data)` captures whatever was there on the first render — which, on a tab
   *   opened before the fetch lands, is `undefined`. Saving then writes an EMPTY list over a real
   *   one. The local copy stays null until the data actually arrives, and the form is not offered
   *   before that.
   */
  useEffect(() => {
    if (scheduleQ.data && draft === null) setDraft(scheduleQ.data);
  }, [scheduleQ.data, draft]);
  useEffect(() => {
    if (recipQ.data && book === null) setBook(recipQ.data.book);
  }, [recipQ.data, book]);

  const scheduleDirty = useMemo(
    () => !!draft && !!scheduleQ.data && JSON.stringify(draft) !== JSON.stringify(scheduleQ.data),
    [draft, scheduleQ.data],
  );
  const bookDirty = useMemo(
    () => !!book && !!recipQ.data && JSON.stringify(book) !== JSON.stringify(recipQ.data.book),
    [book, recipQ.data],
  );

  const on = enabledQ.data ?? false;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card className="p-4">
          <p className="text-sm text-navy">Only an admin can change who receives the Daily Report.</p>
          <p className="mt-1 text-xs text-grey">
            These settings decide where the company's daily cash position is sent.
          </p>
        </Card>
      </div>
    );
  }

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());
  const alreadyListed = (book ?? []).some(
    (r) => r.email.toLowerCase() === newEmail.trim().toLowerCase(),
  );

  const addRecipient = () => {
    if (!emailLooksValid || alreadyListed) return;
    setBook([...(book ?? []), { email: newEmail.trim(), name: newName.trim(), enabled: true }]);
    setNewEmail("");
    setNewName("");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-navy">Daily Report email</h1>
        <p className="mt-0.5 text-xs leading-relaxed text-grey">
          The report goes out as a PDF covering all locations. It is built on a server from the same
          figures this app shows, so the mail and the screen cannot disagree.
        </p>
      </div>

      {/* ── Is it live? ── */}
      <Card className="p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">Status</h2>
        </div>
        <StatusBanner />
      </Card>

      {/* ── The switch ── */}
      <Card className="p-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            disabled={flip.isPending || enabledQ.isLoading}
            onClick={() => flip.mutate(!on)}
            aria-label={on ? "Stop the Daily Report being emailed" : "Allow the Daily Report to be emailed"}
            className="shrink-0 rounded-button p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
          >
            <Toggle on={on} disabled={flip.isPending} />
          </button>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-navy">Emailing is switched {on ? "on" : "off"}</span>
            <span className="block text-[11px] text-grey">
              With this off the send refuses, whatever the schedule says.
            </span>
          </span>
        </div>
      </Card>

      {/* ── When ── */}
      <Card className="p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">When it goes out</h2>
        </div>
        {draft === null ? (
          <p className="px-4 py-6 text-xs text-grey">Loading…</p>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <p className="text-xs text-grey">{describe(draft)}</p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <FieldLabel label="How often">
                  <Select
                    value={draft.frequency}
                    onChange={(e) => {
                      const frequency = e.target.value as ReportEmailFrequency;
                      // Null out what the chosen frequency does not use, so a schedule switched
                      // weekly -> daily cannot keep a stale day hanging off it. The RPC does the
                      // same server-side; this keeps the form honest about what it will save.
                      setDraft({
                        ...draft,
                        frequency,
                        daysOfWeek: frequency === "weekly" ? (draft.daysOfWeek.length ? draft.daysOfWeek : [1]) : [],
                        dayOfMonth: frequency === "monthly" ? (draft.dayOfMonth ?? 1) : null,
                      });
                    }}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </Select>
                </FieldLabel>
              </div>

              {draft.frequency === "monthly" && (
                <div className="w-28">
                  <FieldLabel label="Day" hint="1 to 28">
                    <TextInput
                      type="number"
                      min={1}
                      max={28}
                      value={draft.dayOfMonth ?? 1}
                      onChange={(e) =>
                        setDraft({ ...draft, dayOfMonth: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })
                      }
                    />
                  </FieldLabel>
                </div>
              )}

              <div className="w-28">
                <FieldLabel label="Hour" hint="IST, 0-23">
                  <TextInput
                    type="number"
                    min={0}
                    max={23}
                    value={draft.hourIst}
                    onChange={(e) =>
                      setDraft({ ...draft, hourIst: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })
                    }
                  />
                </FieldLabel>
              </div>
              <div className="w-28">
                <FieldLabel label="Minute">
                  <TextInput
                    type="number"
                    min={0}
                    max={59}
                    value={draft.minuteIst}
                    onChange={(e) =>
                      setDraft({ ...draft, minuteIst: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })
                    }
                  />
                </FieldLabel>
              </div>
            </div>

            {draft.frequency === "weekly" && (
              // ⚠ NOT WRAPPED IN A FieldLabel. That component renders a real <label>, so a click
              //   anywhere inside it activates its FIRST control — which would toggle Sunday
              //   whichever day was pressed.
              <div>
                <p className="mb-1 text-[11px] font-medium text-grey">Days</p>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_SHORT.map((label, d) => {
                    const picked = draft.daysOfWeek.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            daysOfWeek: picked
                              ? draft.daysOfWeek.filter((x) => x !== d)
                              : [...draft.daysOfWeek, d].sort((a, b) => a - b),
                          })
                        }
                        className={[
                          "rounded-pill border px-2.5 py-1 text-[11.5px] transition",
                          picked ? "border-orange bg-orange text-white" : "border-line bg-white text-navy",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {draft.daysOfWeek.length === 0 && (
                  <p className="mt-1 text-[11px] text-ryg-yellow">
                    A weekly schedule needs at least one day, or it will not save.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                disabled={
                  !scheduleDirty ||
                  saveSchedule.isPending ||
                  (draft.frequency === "weekly" && draft.daysOfWeek.length === 0)
                }
                onClick={() => {
                  setNote(null);
                  saveSchedule.mutate(draft, {
                    onSuccess: () => setNote("Schedule saved."),
                    onError: (e) => setNote(e instanceof Error ? e.message : "Could not save the schedule."),
                  });
                }}
              >
                {saveSchedule.isPending ? "Saving…" : "Save schedule"}
              </Button>
              {scheduleDirty && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(scheduleQ.data ?? NO_SCHEDULE)}>
                  Discard
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Who ── */}
      <Card className="p-0">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">
            Who receives it
            {book && (
              <span className="ml-2 text-[11px] font-normal normal-case text-grey">
                {book.filter((r) => r.enabled).length} of {book.length} on
              </span>
            )}
          </h2>
        </div>
        {book === null ? (
          <p className="px-4 py-6 text-xs text-grey">Loading…</p>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <p className="text-xs text-grey">
              Each address receives its own copy. Anyone can be listed; they do not have to be a
              portal user.
            </p>

            {book.length === 0 ? (
              <p className="rounded-card border border-dashed border-line px-3 py-4 text-xs text-grey">
                Nobody is on the list, so nothing will be sent. The schedule and the switch can be
                set up first and will simply wait.
              </p>
            ) : (
              <div className="divide-y divide-line rounded-card border border-line">
                {book.map((r, i) => (
                  <div key={r.email} className="flex items-center gap-3 px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setBook(book.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
                      }
                      aria-label={r.enabled ? `Stop sending to ${r.email}` : `Send to ${r.email}`}
                      className="shrink-0 rounded-button p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
                    >
                      <Toggle on={r.enabled} />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-navy">{r.email}</span>
                      {r.name && <span className="block truncate text-[11px] text-grey">{r.name}</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setBook(book.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[15rem] flex-1">
                <FieldLabel label="Add an address">
                  <TextInput
                    type="email"
                    placeholder="name@orangeotec.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addRecipient(); }
                    }}
                  />
                </FieldLabel>
              </div>
              <div className="w-44">
                <FieldLabel label="Name" hint="optional">
                  <TextInput
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addRecipient(); }
                    }}
                  />
                </FieldLabel>
              </div>
              <Button size="sm" variant="ghost" disabled={!emailLooksValid || alreadyListed} onClick={addRecipient}>
                Add
              </Button>
            </div>
            {newEmail.trim() !== "" && !emailLooksValid && (
              <p className="text-[11px] text-ryg-yellow">That does not look like an email address.</p>
            )}
            {alreadyListed && <p className="text-[11px] text-ryg-yellow">That address is already on the list.</p>}

            {recipQ.data && recipQ.data.strays.length > 0 && (
              <p className="rounded-card border border-line bg-page px-3 py-2 text-[11px] text-grey">
                This report's list also holds {recipQ.data.strays.length} salesperson{" "}
                {recipQ.data.strays.length === 1 ? "entry" : "entries"} ({recipQ.data.strays.join(", ")}),
                left over from the shared table. They receive nothing, because the Daily Report has no
                per-salesperson version. Saving below keeps them; remove them in SQL if they are not
                wanted.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                disabled={!bookDirty || saveRecipients.isPending}
                onClick={() => {
                  setNote(null);
                  saveRecipients.mutate(
                    { book, strays: recipQ.data?.strays ?? [] },
                    {
                      onSuccess: () => setNote("Distribution list saved."),
                      onError: (e) => setNote(e instanceof Error ? e.message : "Could not save the list."),
                    },
                  );
                }}
              >
                {saveRecipients.isPending ? "Saving…" : "Save list"}
              </Button>
              {bookDirty && (
                <Button variant="ghost" size="sm" onClick={() => setBook(recipQ.data?.book ?? [])}>
                  Discard
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {note && <p className="text-xs text-grey">{note}</p>}
    </div>
  );
}
