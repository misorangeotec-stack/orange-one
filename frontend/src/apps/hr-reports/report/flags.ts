/**
 * The flags the form asks for, proposed from live data (KPI-3, read-only).
 *
 * The most useful paragraph in the whole document is its list of example flags:
 *
 *     "Position ageing beyond 45 days | Offer drop or no-show | BGV discrepancy |
 *      Buddy not assigned before Day 1 | Low-score session under review |
 *      Mandatory training overdue"
 *
 * Five of those six are things a database notices better than a person does, and the
 * form leaves them to somebody remembering on a Friday. So the page raises the ones it
 * can and says plainly which it cannot — that list is the specification for what to
 * build next, in the client's own words.
 *
 * ── Why a flag is never "clean" when the data is merely empty ─────────────────
 * "No offer drops this week" and "nobody records offer drops" produce the same zero, and
 * reporting the first when the second is true is the worst thing this page could do —
 * it would certify a control that does not exist. Every flag therefore carries a
 * `basis`: `raised`, `clear`, or `unknowable`. Only `clear` means checked and fine.
 */
import type { ReportData } from "./data";

export type FlagBasis = "raised" | "clear" | "unknowable";

export interface Flag {
  /** The field code on the form this flag answers to, so the two can be held together. */
  code: string;
  label: string;
  basis: FlagBasis;
  /** What was found, or why nothing could be. One sentence, printed as-is. */
  detail: string;
  /** Red for a flag that should stop the week being green; amber for a warning. */
  severity: "red" | "amber" | "none";
}

export function flagsOf(data: ReportData, asOf: string): Flag[] {
  const aged = data.positions.filter((p) => p.live && (p.daysOpen ?? 0) > 45);
  const declined = data.offers.filter((o) => o.offerStatus === "declined");
  const unconfirmed = data.offers.filter((o) => o.joiningUnconfirmed);

  return [
    {
      code: "Z.1",
      label: "Position ageing beyond 45 days",
      basis: aged.length > 0 ? "raised" : "clear",
      severity: aged.length > 0 ? "red" : "none",
      detail:
        aged.length > 0
          ? `${aged.length} live position${aged.length === 1 ? "" : "s"} past 45 days — the oldest at ${Math.max(
              ...aged.map((p) => p.daysOpen ?? 0),
            )} days: ${aged
              .slice(0, 3)
              .map((p) => p.title)
              .join(", ")}${aged.length > 3 ? ` and ${aged.length - 3} more` : ""}.`
          : `All ${data.week.openPositions} live positions are inside 45 days.`,
    },
    {
      code: "Z.2",
      label: "Offer drop or no-show",
      // A drop is readable. A no-show is not, because the joining tick is never used —
      // so this flag is split down the middle and the page must not claim the half it
      // cannot see.
      basis: declined.length > 0 ? "raised" : "unknowable",
      severity: declined.length > 0 ? "red" : unconfirmed.length > 0 ? "amber" : "none",
      detail:
        declined.length > 0
          ? `${declined.length} offer${declined.length === 1 ? "" : "s"} declined: ${declined.map((o) => o.candidate).join(", ")}.`
          : unconfirmed.length > 0
            ? `No offer has been declined. A no-show cannot be told apart from an untouched record: ${unconfirmed.length} joining date${
                unconfirmed.length === 1 ? " has" : "s have"
              } passed with no joining ticked (${unconfirmed.map((o) => o.candidate).join(", ")}).`
            : "No offer has been declined. A no-show would be invisible either way — nothing ticks a joining.",
    },
    {
      code: "Z.3",
      label: "BGV discrepancy",
      basis: "unknowable",
      severity: "none",
      detail:
        "`bgv_status` carries a real discrepancy state, so this is recordable — nobody has recorded a BGV result on a live " +
        "onboarding yet, which means a discrepancy can be neither raised nor ruled out.",
    },
    {
      code: "Z.4",
      label: "Buddy not assigned before Day 1",
      basis: "unknowable",
      severity: "none",
      detail:
        "The Buddy Program went live on 22-09-2026 and records both the buddy and the date allocated, so this flag is exact — " +
        "no buddy has been allocated yet, so nothing can be checked against Day 1.",
    },
    {
      code: "Z.5",
      label: "Low-score session under review",
      basis: "unknowable",
      severity: "none",
      detail: "Learning & Development is built and not yet released, so its feedback scores cannot be read from the hub today.",
    },
    {
      code: "Z.6",
      label: "Mandatory training overdue",
      basis: "unknowable",
      severity: "none",
      detail: "The mandatory programmes and their cycles exist in L&D. Until it is released, nothing here can be read as overdue.",
    },
    // Not on the form's list, and it is the loudest thing in the data — so it goes last
    // rather than being dropped. A report that stays silent about it is the reason the
    // closure and joining counts read zero every week.
    {
      code: "A1.4",
      label: "Closures and joinings are not being recorded",
      basis: data.ytd.positionsClosed === 0 && data.offers.length > 0 ? "raised" : "clear",
      severity: data.ytd.positionsClosed === 0 && data.offers.length > 0 ? "red" : "none",
      detail:
        data.ytd.positionsClosed === 0 && data.offers.length > 0
          ? `No requisition has been marked closed in ${asOf.slice(0, 4)} and no candidate has a joining ticked, while ${
              data.offers.filter((o) => o.offerStatus === "accepted").length
            } offer${data.offers.filter((o) => o.offerStatus === "accepted").length === 1 ? " is" : "s are"} accepted. ` +
            "Positions Closed, Offer-to-Join %, New Joiners and SK-1 will all read zero until the closure and the joining are ticked on the screens that already carry them."
          : "Closures are being recorded.",
    },
  ];
}

/**
 * The status the live flags argue for. The reader can overrule it — it is their
 * judgement on the form — but the page should not make them work it out.
 *
 * Red on any red flag, amber on any amber, green only when everything checkable is
 * clear. `unknowable` never earns green by itself: a week is not green because half the
 * controls do not exist, and the page says so rather than colouring it in.
 */
export function suggestedStatus(flags: Flag[]): { status: "green" | "amber" | "red"; why: string } {
  const red = flags.filter((f) => f.severity === "red");
  if (red.length > 0) {
    return { status: "red", why: `${red.length} flag${red.length === 1 ? "" : "s"} raised: ${red.map((f) => f.label).join("; ")}.` };
  }
  const amber = flags.filter((f) => f.severity === "amber");
  if (amber.length > 0) {
    return { status: "amber", why: `${amber.length} warning${amber.length === 1 ? "" : "s"}: ${amber.map((f) => f.label).join("; ")}.` };
  }
  const unknowable = flags.filter((f) => f.basis === "unknowable").length;
  return {
    status: "green",
    why:
      unknowable > 0
        ? `Nothing checkable is off track, but ${unknowable} of the form's ${flags.length} flags cannot be checked at all. Green here means "no problem found", not "no problem".`
        : "Every flag on the form was checked and is clear.",
  };
}
