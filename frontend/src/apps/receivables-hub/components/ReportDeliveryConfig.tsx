import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { useDirectory } from "@/core/platform/store";
import { useToast } from "@hub/hooks/use-toast";
import {
  NO_SCHEDULE,
  fetchReportEmailRecipients, fetchReportEmailSchedule,
  saveReportEmailRecipients, saveReportEmailSchedule,
  type ReportEmailFrequency, type ReportEmailSchedule, type ReportRecipientRow,
} from "@hub/lib/reportEmail";
import { cn } from "@/shared/lib/cn";

/**
 * WHEN one report goes out, and WHO it goes to.
 *
 * ⚠ NOTHING SENDS ON THIS SCHEDULE YET, and the panel says so on screen rather than only here.
 *   The report is built in the BROWSER (jsPDF over the receivables project), so there is nothing
 *   for a scheduler to call at 08:00 — that builder is the next piece of work. This exists first
 *   on purpose: the distribution list is the part a human has to get right, and the salesperson
 *   mapping is the part most likely to be wrong. Setting it up now means it can be READ and
 *   corrected long before anything is capable of posting it.
 *
 * ── THE TWO LISTS ARE DIFFERENT KINDS OF THING ──────────────────────────────────────
 *   Full report  — typed addresses. Whoever is on this list gets the CONSOLIDATED book: every
 *                  salesperson, the league table, the appendices.
 *   Salespeople  — names, ticked. Each ticked name's OWN extract goes to whichever portal users
 *                  carry that name in Admin > Users. The address is resolved at send time, not
 *                  stored, so a rep who changes address or loses the tag cannot keep receiving.
 *
 *   A name with no portal user is shown and NOT silently dropped. It is the one failure that
 *   otherwise looks like success: the report gets built for them and reaches nobody.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FREQUENCIES: { value: ReportEmailFrequency; label: string }[] = [
  { value: "off", label: "Not scheduled" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** The stored schedule as one sentence, so the admin reads back what they set, not a form. */
function describe(s: ReportEmailSchedule): string {
  const at = `${pad(s.hourIst)}:${pad(s.minuteIst)} IST`;
  if (s.frequency === "daily") return `Every day at ${at}`;
  if (s.frequency === "weekly") return `Every ${DAYS[s.dayOfWeek ?? 1]} at ${at}`;
  if (s.frequency === "monthly") {
    const d = s.dayOfMonth ?? 1;
    const suffix = d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
    return `On the ${d}${suffix} of each month at ${at}`;
  }
  return "Not scheduled";
}

const selectCls =
  "rounded-input border border-line bg-white px-2 py-1 text-xs text-navy focus:outline-none focus:ring-2 focus:ring-orange/40";

export default function ReportDeliveryConfig({ reportKey }: { reportKey: string }) {
  const { toast } = useToast();
  const { profiles } = useDirectory();

  const schedQ = useQuery({
    queryKey: ["receivables", "reportEmailSchedule", reportKey],
    queryFn: () => fetchReportEmailSchedule(reportKey),
  });
  const recipQ = useQuery({
    queryKey: ["receivables", "reportEmailRecipients", reportKey],
    queryFn: () => fetchReportEmailRecipients(reportKey),
  });

  /**
   * The salesperson names in the DATA, not the names somebody has been tagged with.
   *
   * Dynamically imported for the same reason UserForm does it: a static import would pull the
   * receivables fetcher into the admin chunk for the sake of one string list.
   */
  const namesQ = useQuery({
    queryKey: ["receivables", "salespersonNames"],
    queryFn: () =>
      import("@hub/lib/connectwaveFetcher").then((m) => m.fetchSalespersonNames()),
    staleTime: 10 * 60 * 1000,
  });

  const [sched, setSched] = useState<ReportEmailSchedule>(NO_SCHEDULE);
  const [book, setBook] = useState<{ email: string; name?: string | null }[]>([]);
  const [reps, setReps] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (schedQ.data) setSched(schedQ.data); }, [schedQ.data]);
  useEffect(() => {
    if (!recipQ.data) return;
    setBook(recipQ.data.filter((r) => r.scope === "book").map((r) => ({ email: r.email ?? "", name: r.name })));
    setReps(new Set(recipQ.data.filter((r) => r.scope === "salesperson").map((r) => r.salesperson ?? "")));
  }, [recipQ.data]);

  /** salesperson name -> the portal users tagged with it. Same mapping the send dialog uses. */
  const addressBook = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of profiles) {
      for (const raw of p.receivablesSalespersons ?? []) {
        const key = raw.trim();
        if (!key || !p.email) continue;
        const list = m.get(key);
        if (list) list.push(p.email); else m.set(key, [p.email]);
      }
    }
    return m;
  }, [profiles]);

  /** Every name worth showing: what the data holds, plus anything already saved. */
  const allNames = useMemo(() => {
    const s = new Set<string>(namesQ.data ?? []);
    for (const n of reps) if (n) s.add(n);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [namesQ.data, reps]);

  /** Ticked, but nobody carries the tag — the failure that otherwise looks like success. */
  const unclaimed = useMemo(
    () => [...reps].filter((n) => !(addressBook.get(n)?.length)),
    [reps, addressBook],
  );

  const addBook = () => {
    const parts = draft.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setBook((prev) => {
      const seen = new Set(prev.map((p) => p.email.toLowerCase()));
      return [...prev, ...parts.filter((e) => !seen.has(e.toLowerCase())).map((email) => ({ email }))];
    });
    setDraft("");
  };

  const toggleRep = (name: string) =>
    setReps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const rows: ReportRecipientRow[] = [
        ...book.map((b) => ({ scope: "book" as const, email: b.email, name: b.name ?? null, enabled: true })),
        ...[...reps].map((n) => ({ scope: "salesperson" as const, salesperson: n, enabled: true })),
      ];
      await saveReportEmailSchedule(reportKey, sched);
      await saveReportEmailRecipients(reportKey, rows);
      await Promise.all([schedQ.refetch(), recipQ.refetch()]);
      toast({ title: "Delivery settings saved", description: "Nothing is sent until the scheduler is built." });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (schedQ.isLoading || recipQ.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-grey">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading delivery settings…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-line bg-page px-3 py-3">
      {/* Said on screen, not just in the code: an admin who fills this in deserves to know it
          will not fire yet, rather than waiting for a mail that never comes. */}
      <p className="flex items-start gap-2 rounded-input border border-yellow/50 bg-yellow/10 px-2.5 py-2 text-[11px] leading-snug text-[#8a6400]">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Saved but <span className="font-semibold">not yet active</span>. The report is built in
          your browser, so nothing can send it while you are away. Set the list up now and it will
          be waiting when the scheduler is built.
        </span>
      </p>

      {/* ── When ─────────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-grey-2">When</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectCls}
            value={sched.frequency}
            onChange={(e) => {
              const frequency = e.target.value as ReportEmailFrequency;
              setSched((s) => ({
                ...s,
                frequency,
                // Give the field the chosen frequency needs a value, so a weekly schedule can
                // never be saved without a day. The RPC nulls out the one it does not use.
                dayOfWeek: frequency === "weekly" ? (s.dayOfWeek ?? 1) : s.dayOfWeek,
                dayOfMonth: frequency === "monthly" ? (s.dayOfMonth ?? 1) : s.dayOfMonth,
              }));
            }}
          >
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          {sched.frequency === "weekly" && (
            <select
              className={selectCls}
              value={sched.dayOfWeek ?? 1}
              onChange={(e) => setSched((s) => ({ ...s, dayOfWeek: Number(e.target.value) }))}
            >
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}

          {sched.frequency === "monthly" && (
            <select
              className={selectCls}
              value={sched.dayOfMonth ?? 1}
              onChange={(e) => setSched((s) => ({ ...s, dayOfMonth: Number(e.target.value) }))}
            >
              {/* Stops at 28 so a month can never be skipped — see the migration. */}
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}

          {sched.frequency !== "off" && (
            <>
              <input
                type="time"
                className={selectCls}
                value={`${pad(sched.hourIst)}:${pad(sched.minuteIst)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) {
                    setSched((s) => ({ ...s, hourIst: h, minuteIst: m }));
                  }
                }}
              />
              <span className="text-[11px] text-grey">IST</span>
            </>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-grey">{describe(sched)}</p>
      </div>

      {/* ── Who: the whole book ──────────────────────────────────────────── */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-navy">
          Admin version &mdash; the whole book
        </p>
        <p className="mb-1.5 text-[11px] text-grey">
          Every salesperson, the league table and both appendices. For directors and credit control.
          Type any address; they do not have to be a portal user.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {book.map((b) => (
            <span
              key={b.email}
              className="inline-flex items-center gap-1 rounded-pill border border-line bg-white px-2 py-0.5 text-[11px] text-navy"
            >
              {b.email}
              <button
                type="button"
                onClick={() => setBook((prev) => prev.filter((x) => x.email !== b.email))}
                aria-label={`Remove ${b.email}`}
                className="text-grey-2 hover:text-ryg-red focus-visible:outline focus-visible:outline-1 focus-visible:outline-orange"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {book.length === 0 && <span className="text-[11px] text-grey-2">Nobody yet.</span>}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBook(); } }}
            placeholder="name@orangeotec.com"
            className="min-w-0 flex-1 rounded-input border border-line bg-white px-2 py-1 text-xs text-navy placeholder:text-grey-2 focus:outline-none focus:ring-2 focus:ring-orange/40"
          />
          <button
            type="button"
            onClick={addBook}
            className="inline-flex items-center gap-1 rounded-button border border-line bg-white px-2 py-1 text-xs text-navy hover:bg-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>

      {/* ── Who: one book each ──────────────────────────────────────────── */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-navy">
          Salesperson version &mdash; their own customers only
        </p>
        <p className="mb-1.5 text-[11px] text-grey">
          Each ticked salesperson gets a report of their customers and nobody else's. It goes to
          whoever is tagged with that name in Admin &rsaquo; Users, so the address is never out of
          date and somebody who loses the tag stops receiving it.
        </p>

        {namesQ.isLoading ? (
          <p className="flex items-center gap-2 text-[11px] text-grey">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading salespeople…
          </p>
        ) : namesQ.error ? (
          <p className="text-[11px] text-ryg-red">
            {namesQ.error instanceof Error ? namesQ.error.message : "Could not load salespeople."}
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-input border border-line bg-white">
            {allNames.length === 0 ? (
              <p className="px-2.5 py-3 text-[11px] text-grey-2">No salespeople in the data.</p>
            ) : allNames.map((n) => {
              const to = addressBook.get(n) ?? [];
              const on = reps.has(n);
              return (
                <label
                  key={n}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-b-0 hover:bg-page"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleRep(n)}
                    className="h-3.5 w-3.5 accent-[#FF6A1F]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-navy">{n}</span>
                    <span className={cn("block truncate text-[11px]", to.length ? "text-grey" : "text-ryg-red")}>
                      {to.length ? to.join(", ") : "No portal user tagged with this salesperson"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {unclaimed.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-ryg-red">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {unclaimed.join(", ")} {unclaimed.length === 1 ? "has" : "have"} nobody to receive it.
              Tag a user in Admin &rsaquo; Users, or untick the name.
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-button bg-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-2 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save delivery settings
        </button>
        <span className="text-[11px] text-grey">
          {book.length + reps.size} recipient{book.length + reps.size === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
