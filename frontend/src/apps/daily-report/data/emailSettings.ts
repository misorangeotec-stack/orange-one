/**
 * Daily Report — the evening send's settings (DR-3): the switch, the frequency, the list.
 *
 * ⚠ THE SCHEDULE AND RECIPIENT WRITES ARE IMPORTED FROM `@hub/lib/reportEmail`, NOT REWRITTEN.
 *   `report_email_settings`, `report_email_schedule` and `report_email_recipients` are keyed on a
 *   free-text `report_key` and are not receivables-specific; the Collection report simply got there
 *   first, so the client wrappers live in its folder. Re-implementing them here would give the two
 *   screens two ways to write one table — and the multi-day overload, the sort-and-dedupe and the
 *   "the RPC keeps the older single-day column in step" detail would then exist in one of them only.
 *
 *   This module adds the two things that ARE this report's own: reading its gate, and its send log.
 *
 * ⚠ THIS REPORT HAS NO SALESPERSON VERSION. `ReportRecipientRow.scope` allows 'salesperson', and
 *   nothing here ever writes one: that scope resolves a name through
 *   `profiles.receivables_salespersons`, which is a receivables visibility scope rather than an
 *   identity. `daily_report_email_due()` reads only `scope='book'` and reports any salesperson row
 *   it finds under this key as a "stray", which the screen surfaces so a row that receives nothing
 *   cannot sit in the list looking configured.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/core/platform/supabase";
import {
  NO_SCHEDULE,
  fetchReportEmailRecipients,
  fetchReportEmailSchedule,
  fetchReportEmailSettings,
  saveReportEmailRecipients,
  saveReportEmailSchedule,
  setReportEmailEnabled,
  type ReportEmailFrequency,
  type ReportEmailSchedule,
  type ReportRecipientRow,
} from "@hub/lib/reportEmail";

export type { ReportEmailFrequency, ReportEmailSchedule, ReportRecipientRow };
export { NO_SCHEDULE };

/** The one key this report is filed under. Per-location copies would be sibling keys. */
export const DAILY_REPORT_KEY = "daily-report";

const QK = {
  enabled: ["daily-report", "email", "enabled"] as const,
  schedule: ["daily-report", "email", "schedule"] as const,
  recipients: ["daily-report", "email", "recipients"] as const,
  status: ["daily-report", "email", "status"] as const,
};

/* ─────────────────────────────────────────────────────────── the switch ── */

export function useEmailEnabled() {
  return useQuery({
    queryKey: QK.enabled,
    queryFn: async () => (await fetchReportEmailSettings())[DAILY_REPORT_KEY] ?? false,
  });
}

export function useSetEmailEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: boolean) => setReportEmailEnabled(DAILY_REPORT_KEY, next),
    /**
     * The switch moves on click, before the server answers.
     *
     * ⚠ A CORRECTNESS FIX, NOT POLISH, AND IT IS COPIED FROM THE MISTAKE THE RECEIVABLES PANEL MADE
     *   ON 17-AUG-2026. Without it the switch shows its old value for the whole round trip, which
     *   reads as "that didn't work" and invites a second click — and the second click computes
     *   `!on` from the STALE value, turning the report straight back off. It happened there: a
     *   report was switched on, clicked again, and the next send failed with "emailing is switched
     *   off for this report". A control that quietly undoes itself is worse than a slow one.
     */
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: QK.enabled });
      const previous = qc.getQueryData<boolean>(QK.enabled);
      qc.setQueryData<boolean>(QK.enabled, next);
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(QK.enabled, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK.enabled });
      void qc.invalidateQueries({ queryKey: QK.status });
    },
  });
}

/* ───────────────────────────────────────────────────────── the schedule ── */

export function useEmailSchedule() {
  return useQuery({
    queryKey: QK.schedule,
    queryFn: () => fetchReportEmailSchedule(DAILY_REPORT_KEY),
  });
}

export function useSaveEmailSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: ReportEmailSchedule) => saveReportEmailSchedule(DAILY_REPORT_KEY, s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.schedule });
      void qc.invalidateQueries({ queryKey: QK.status });
    },
  });
}

/* ─────────────────────────────────────────────────────── the recipients ── */

/** One address on the list. Book scope only — see the header. */
export interface BookRecipient {
  email: string;
  name: string;
  enabled: boolean;
}

export function useEmailRecipients() {
  return useQuery({
    queryKey: QK.recipients,
    queryFn: async () => {
      const rows = await fetchReportEmailRecipients(DAILY_REPORT_KEY);
      return {
        book: rows
          .filter((r) => r.scope === "book" && r.email)
          .map((r): BookRecipient => ({
            email: r.email ?? "",
            name: r.name ?? "",
            enabled: r.enabled,
          }))
          .sort((a, b) => a.email.localeCompare(b.email)),
        /**
         * Salesperson rows filed under this key. They receive nothing. Surfaced rather than
         * filtered away: a row an admin can see in a list but that never receives anything is the
         * failure that looks exactly like success.
         */
        strays: rows
          .filter((r) => r.scope === "salesperson")
          .map((r) => r.salesperson ?? "")
          .filter(Boolean),
      };
    },
  });
}

export function useSaveEmailRecipients() {
  const qc = useQueryClient();
  return useMutation({
    /**
     * ⚠ SAVES THE WHOLE LIST, AND THEREFORE CARRIES THE STRAYS THROUGH UNTOUCHED.
     *   `set_report_email_recipients` REPLACES every row for the key. Saving only the book rows
     *   would silently delete a salesperson row an admin had not asked to remove — a destructive
     *   side effect of pressing Save on a different part of the form. They are passed back as they
     *   came; the screen offers an explicit button to clear them.
     */
    mutationFn: ({ book, strays }: { book: BookRecipient[]; strays: string[] }) => {
      const rows: ReportRecipientRow[] = [
        ...book
          .filter((r) => r.email.trim())
          .map((r) => ({
            scope: "book" as const,
            email: r.email.trim(),
            name: r.name.trim() || null,
            salesperson: null,
            enabled: r.enabled,
          })),
        ...strays.map((s) => ({
          scope: "salesperson" as const,
          email: null,
          name: null,
          salesperson: s,
          enabled: true,
        })),
      ];
      return saveReportEmailRecipients(DAILY_REPORT_KEY, rows);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.recipients });
      void qc.invalidateQueries({ queryKey: QK.status });
    },
  });
}

/* ─────────────────────────────────────────────────────────── is it live ── */

/**
 * Whether the chain will actually send, in the gate's own words.
 *
 * ⚠ READ FROM THE DATABASE, NEVER ASSERTED IN THE COMPONENT, and the receivables panel paid for
 *   that lesson: it carried a hard-coded "saved but not yet active" warning written while the
 *   report could only be built in a browser. The runner shipped, the warning did not move, and for
 *   a while the screen told an admin their working schedule was inert — the most expensive kind of
 *   stale copy, because it sends someone hunting a fault that is not there.
 *
 *   `daily_report_email_due` is the same call the runner makes, so whatever this says is by
 *   construction what happens at the next tick.
 */
export interface DailySendStatus {
  /** True when the whole chain is armed and scheduled — the banner's headline. */
  live: boolean;
  /** The gate's own words. */
  reason: string | null;
  dueNow: boolean;
  /** How many addresses the next send resolves to, when the gate is willing to say. */
  bookCount: number | null;
  /** Salesperson rows under this key. They reach nobody. */
  strays: string[];
  /** How complete the hand-typed bank figures are for the day being considered. */
  balances: { expected: number; entered: number } | null;
  lastSentFor: string | null;
  lastSentAt: string | null;
  /** What the last send actually had, which is unrecoverable afterwards. */
  lastBalances: { expected: number | null; entered: number | null } | null;
}

/**
 * States where "not due" is correct and nothing is wrong.
 *
 * "no schedule is set" is deliberately NOT here — that one is answered by the form directly below
 * the banner. Anything unrecognised counts as NOT live, so a gate condition added later surfaces
 * rather than hides.
 */
const BENIGN_REASONS = [/^not a send day/i, /^not yet/i, /^already sent/i, /^missed/i, /^nobody to send to/i];

export function useDailySendStatus() {
  return useQuery({
    queryKey: QK.status,
    queryFn: async (): Promise<DailySendStatus> => {
      const [gate, log] = await Promise.all([
        supabase.rpc("daily_report_email_due", { p_report_key: DAILY_REPORT_KEY }),
        supabase
          .from("daily_report_email_send_log")
          .select("sent_for_date, run_at, balances_entered, balances_expected")
          .eq("report_key", DAILY_REPORT_KEY)
          .order("run_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (gate.error) throw new Error(gate.error.message);

      const g = (gate.data ?? {}) as {
        due?: boolean; reason?: string;
        book?: unknown[]; strays?: string[];
        balances?: { expected: number; entered: number };
      };
      const reason = g.reason ?? null;
      const live = g.due === true || (!!reason && BENIGN_REASONS.some((r) => r.test(reason)));

      return {
        live,
        reason,
        dueNow: g.due === true,
        bookCount: Array.isArray(g.book) ? g.book.length : null,
        strays: g.strays ?? [],
        balances: g.balances ?? null,
        lastSentFor: log.data?.sent_for_date ?? null,
        lastSentAt: log.data?.run_at ?? null,
        lastBalances: log.data
          ? { expected: log.data.balances_expected, entered: log.data.balances_entered }
          : null,
      };
    },
  });
}
