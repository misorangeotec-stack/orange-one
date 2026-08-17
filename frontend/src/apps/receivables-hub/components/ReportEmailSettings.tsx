import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import { REPORT_CATEGORIES, type ReportCategory, type ReportEntry } from "@hub/lib/reportCatalog";
import { EMAILABLE_REPORTS } from "@hub/lib/reportAccess";
import { fetchReportEmailSettings, setReportEmailEnabled } from "@hub/lib/reportEmail";
import ReportDeliveryConfig from "@hub/components/ReportDeliveryConfig";
import { useToast } from "@hub/hooks/use-toast";
import { cn } from "@/shared/lib/cn";

/**
 * Which reports may be emailed out — one switch per report.
 *
 * ── THIS IS A GLOBAL SETTING AND SITS ON A PER-USER SCREEN ──────────────────────────
 * The panel below it edits ONE selected user. This one does not: switching a report on here
 * arms it for everybody who can already reach its Email action. That is a genuinely confusing
 * neighbourhood to live in, so the heading says so in as many words and the panel is visually
 * separated rather than tucked inside the user's card. It lives here anyway because this is the
 * screen an admin already opens to answer "who can see which report", and "which reports can
 * leave the building" is the same question one step further on.
 *
 * ── WHY PER REPORT AND NOT PER MODULE ───────────────────────────────────────────────
 * Every other module in the portal has a single email switch (email_module_settings), which is
 * right for an FMS: those mails are step notifications belonging to the workflow as a whole. This
 * module is a catalogue of ~30 reports of very different sensitivity, and they get emailing one at
 * a time. A single switch would mean arming "Customers with Zero Collections" also arms every
 * future report the day its send path lands. See migration 20260903120300.
 *
 * ── WHAT IS AND IS NOT LISTED ───────────────────────────────────────────────────────
 * Only reports whose Email action actually exists (`emailable` in the catalogue). A switch over a
 * report with no send path is a control that does nothing, and an admin has no way to tell that
 * from a broken feature.
 *
 * Styling follows ReportAccessTree: Orange One's hex tokens, hand-rolled switch, so it renders the
 * same inside `.hub-root` and out of it.
 */

const QK = ["receivables", "reportEmailSettings"] as const;

/** A switch that reads as on/off at a glance and does not depend on the Hub's CSS variables. */
function Toggle({ on, busy, disabled }: { on: boolean; busy: boolean; disabled: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border transition",
        on ? "border-orange bg-orange" : "border-grey-2 bg-white",
        disabled && "opacity-50",
      )}
    >
      {busy ? (
        <Loader2 className="mx-auto h-3 w-3 animate-spin text-grey" />
      ) : (
        <span
          className={cn(
            "h-3.5 w-3.5 rounded-pill bg-white shadow transition-transform",
            on ? "translate-x-[18px]" : "translate-x-[3px]",
            on ? "" : "border border-line",
          )}
        />
      )}
    </span>
  );
}

export default function ReportEmailSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: fetchReportEmailSettings });

  /** The report currently being written, so only its own switch shows a spinner. */
  const [pending, setPending] = useState<string | null>(null);

  /**
   * The switch moves on click, before the server answers.
   *
   * ⚠ THIS IS A CORRECTNESS FIX, NOT POLISH. Without it the switch kept showing OFF for the whole
   *   round trip, which reads as "that didn't work" and invites a second click — and a second
   *   click sends `next: !on` computed from the STALE value, turning the report straight back off.
   *   It happened in testing on 17-Aug-2026: the report was switched on, clicked again, and the
   *   next send failed with "emailing is switched off for this report". A control that quietly
   *   undoes itself is worse than a slow one.
   *
   * The optimistic value is rolled back on failure, so a rejected write (a non-admin, a dropped
   * connection) does not leave the screen claiming a report is armed when it is not.
   */
  const flip = useMutation({
    mutationFn: ({ key, next }: { key: string; next: boolean }) => setReportEmailEnabled(key, next),
    onMutate: async ({ key, next }) => {
      setPending(key);
      await queryClient.cancelQueries({ queryKey: QK });
      const previous = queryClient.getQueryData<Record<string, boolean>>(QK);
      queryClient.setQueryData<Record<string, boolean>>(QK, { ...(previous ?? {}), [key]: next });
      return { previous };
    },
    onSuccess: (_v, { key, next }) => {
      const title = EMAILABLE_REPORTS.find((r) => r.id === key)?.title ?? key;
      toast({ title: next ? `${title} can now be emailed` : `Emailing switched off for ${title}` });
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QK, context.previous);
      toast({
        title: "Could not change the setting",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
    // Refetch once the dust settles, so the screen ends on the server's word rather than ours.
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: QK });
    },
  });

  /** Emailable reports grouped by catalogue category, in catalogue order. */
  const groups = useMemo(() => {
    const out: { category: ReportCategory; reports: ReportEntry[] }[] = [];
    for (const category of REPORT_CATEGORIES) {
      const reports = EMAILABLE_REPORTS.filter((r) => r.category === category.id);
      if (reports.length) out.push({ category, reports });
    }
    return out;
  }, []);

  const onCount = useMemo(
    () => EMAILABLE_REPORTS.filter((r) => data?.[r.id]).length,
    [data],
  );

  return (
    <div className="rounded-card border border-line bg-white">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-navy">Report email &mdash; who gets what, and when</p>
          <p className="mt-0.5 text-xs leading-relaxed text-grey">
            Each report goes out in two versions: the{" "}
            <span className="font-medium text-navy">admin version</span> (the whole book) and the{" "}
            <span className="font-medium text-navy">salesperson version</span> (their own customers
            only). Set the switch, the timing and both distribution lists below.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-grey-2">
            These settings apply to everyone, not to the user selected further down. A report
            switched off refuses to send, whoever presses Email. New reports start off.
          </p>
        </div>
        {!isLoading && (
          <span className="shrink-0 rounded-pill border border-line px-2 py-0.5 text-[11px] text-grey">
            {onCount} of {EMAILABLE_REPORTS.length} on
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-xs text-grey">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-xs text-ryg-red">
          {error instanceof Error ? error.message : "Could not load the settings."}
        </p>
      ) : groups.length === 0 ? (
        // Not an error state: it is what the screen SHOULD say before any report has a send path.
        <p className="px-4 py-6 text-xs text-grey">
          No report has an Email action yet. One appears here as soon as its send path is built.
        </p>
      ) : (
        <div className="divide-y divide-line">
          {groups.map(({ category, reports }) => (
            <div key={category.id} className="px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                {category.title}
              </p>
              <div className="flex flex-col gap-1">
                {reports.map((r) => {
                  const on = data?.[r.id] ?? false;
                  const busy = pending === r.id;
                  return (
                    <div key={r.id} className="overflow-hidden rounded-card border border-line">
                      <div className="flex items-center gap-3 bg-white px-2 py-1.5">
                        {/* The switch is its own control, not the whole row: a click meant for the
                            settings below must never arm the report by accident. */}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => flip.mutate({ key: r.id, next: !on })}
                          aria-label={on ? `Stop ${r.title} being emailed` : `Allow ${r.title} to be emailed`}
                          className="shrink-0 rounded-button p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
                        >
                          <Toggle on={on} busy={busy} disabled={busy} />
                        </button>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-navy">{r.title}</span>
                          <span className="block truncate text-[11px] text-grey">{r.purpose}</span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 pr-1 text-[11px] font-medium uppercase tracking-wide",
                            on ? "text-orange" : "text-grey-2",
                          )}
                        >
                          {on ? "On" : "Off"}
                        </span>
                      </div>

                      {/*
                        ALWAYS SHOWN, never behind a disclosure.

                        It was collapsed at first, on the reasoning that opening it fetches the
                        salesperson list. In practice the schedule and the distribution list ARE the
                        setup — an admin who came here to configure a report and found only a toggle
                        reasonably concluded the rest had not been built. A control nobody can find
                        is a control that does not exist. The salesperson query is keyed globally,
                        so several open panels still fetch it once.
                      */}
                      <ReportDeliveryConfig reportKey={r.id} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
