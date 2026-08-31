import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import type { TravelPolicyConfig } from "../../types";

/**
 * The Domestic Travel Policy's own numbers, as settings.
 *
 * ⚠ EVERY FIGURE HERE IS FROM THE POLICY DOCUMENT, and the label says which
 *   section. That is the whole reason this screen exists rather than the numbers
 *   living in code: Annexure C says no rate is final until both Directors sign
 *   off, and roughly thirty figures in the source carry a literal
 *   "[⚠ CONFIRM]". A policy that changes annually cannot be a deploy.
 *
 * ⚠ TWO OF THESE ARE ENFORCED IN SQL AND THE REST ARE NOT, and the screen
 *   separates them, because an admin editing a number that stops somebody
 *   claiming deserves to know that is what it does:
 *     · the 30-day hard stop REFUSES a claim (§11.3)
 *     · the advance ceiling REFUSES a disbursement above it (§11.1)
 *   Everything else advises, warns or colours a cell.
 *
 * ⚠ THE RATES ARE NOT HERE. Hotel caps, DA and mileage live on the effective-
 *   dated RATE CARD, because they are what a Director signs off and what a
 *   January revision replaces wholesale. These are the process rules around
 *   them, which change on their own schedule.
 */

interface Row {
  key: keyof TravelPolicyConfig;
  label: string;
  section: string;
  unit: string;
  hint: string;
  /** Refused in SQL, not merely advised. */
  enforced?: boolean;
  money?: boolean;
}

const GROUPS: { title: string; blurb: string; rows: Row[] }[] = [
  {
    title: "Requesting and booking",
    blurb: "What the form asks for, and when it starts warning.",
    rows: [
      {
        key: "maxPassengers",
        label: "Co-passengers per trip",
        section: "PRD",
        unit: "people",
        hint: "How many other travellers can ride on one booking. Reimbursement is still personal — §11 is entirely per-employee.",
      },
      {
        key: "bookingWindowDays",
        label: "Request ahead of departure",
        section: "§3.3",
        unit: "days",
        hint: "How far ahead a trip should be raised. A shorter notice is allowed and simply flagged.",
      },
      {
        key: "advanceBookingWarnDays",
        label: "Warn when booking inside",
        section: "§4.1",
        unit: "days",
        hint: "Air fares rise sharply inside this window, so the booking screen says so.",
      },
      {
        key: "emergencyWindowHours",
        label: "Regularise emergency travel within",
        section: "§3.5",
        unit: "hours",
        hint: "Travel taken without prior approval must be regularised inside this window, or §3.5 prices the whole trip at TC-D. The two figures in the source (24h from departure, 48h from return) disagree — H4.",
      },
    ],
  },
  {
    title: "The advance",
    blurb: "Money that leaves before the journey does.",
    rows: [
      {
        key: "advanceMaxPct",
        label: "Advance ceiling",
        section: "§11.1",
        unit: "% of the estimate",
        hint: "An advance may not exceed this share of the estimated cost.",
        enforced: true,
      },
      {
        key: "advanceRecoveryDays",
        label: "Recover an unused advance within",
        section: "§11.2",
        unit: "days",
        hint: "How long after a cancelled or unclaimed trip the money should be back. It ages the Outstanding Advances report; it does not refuse anything.",
      },
    ],
  },
  {
    title: "The claim",
    blurb: "What the money engine refuses, and what it merely flags.",
    rows: [
      {
        key: "claimDeadlineDays",
        label: "File a claim within",
        section: "§11.1",
        unit: "working days of return",
        hint: "Drives the claim queue's due date. A late claim is red, not refused.",
      },
      {
        key: "claimHardStopDays",
        label: "Hard stop after travel",
        section: "§11.3",
        unit: "days",
        hint: "Past this, a claim line is allowed NOTHING without written Director approval. This one genuinely refuses.",
        enforced: true,
      },
      {
        key: "hotelCapHardMultiple",
        label: "§7.3 hard ceiling",
        section: "§7.3",
        unit: "× the hotel cap",
        hint: "Evidence plus HOD approval can take a hotel line above its cap, but never above this multiple. Beyond it needs written Director approval.",
        enforced: true,
      },
    ],
  },
  {
    title: "Turnaround and disputes",
    blurb:
      "§12's promise, and who decides when somebody disagrees with it. The per-step due dates above are what actually colour a queue; these are the figures the policy quotes.",
    rows: [
      {
        key: "hodReviewDays",
        label: "Manager decides within",
        section: "§12",
        unit: "working days",
        hint: "Past this the employee may escalate to the HR Head (§12.1).",
      },
      {
        key: "financeProcessDays",
        label: "Finance processes within",
        section: "§12",
        unit: "working days of HOD approval",
        hint: "Past this the employee may escalate to the CFO (§12.1).",
      },
      {
        key: "creditDays",
        label: "Money credited within",
        section: "§12",
        unit: "working days of HOD approval",
        hint: "Counted from the manager's approval, not from Finance's verification — so Finance taking its full window does not buy another week.",
      },
      {
        key: "disputeThreshold",
        label: "HR Head's decision is final below",
        section: "§12.2",
        unit: "",
        hint: "A disputed claim above this figure is decided by a Director instead.",
        money: true,
      },
    ],
  },
];

export default function PolicySection() {
  const s = useTravelStore();
  const p = s.config.policy;

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const g of GROUPS) for (const r of g.rows) out[r.key] = String(p[r.key] ?? "");
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const next = { ...p } as TravelPolicyConfig;
      for (const g of GROUPS) {
        for (const r of g.rows) {
          const n = Number(draft[r.key]);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`${r.label} has to be a number, and not a negative one.`);
          }
          (next as unknown as Record<string, number>)[r.key] = n;
        }
      }
      await s.setPolicy(next);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-3xl space-y-5 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Policy</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-grey">
          The Domestic Travel Policy&rsquo;s own process rules, as settings rather than as code
          &mdash; the source carries roughly thirty figures marked
          &ldquo;<span className="italic">CONFIRM</span>&rdquo;, and Annexure C says no rate is
          final until both Directors sign off. The <b className="text-navy">rates</b> (hotel caps,
          daily allowance, mileage) are not here: they live on the effective-dated rate card,
          because a January revision replaces them wholesale.
        </p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-3">
          <div>
            <div className="text-[13.5px] font-semibold text-navy">{g.title}</div>
            <div className="text-[11.5px] text-grey-2">{g.blurb}</div>
          </div>
          {g.rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-navy">
                  {r.label}
                  <span className="ml-2 text-[11px] font-normal text-grey-2">{r.section}</span>
                  {r.enforced && (
                    <span className="ml-2 rounded bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
                      Refused in SQL
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-grey-2">{r.hint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <TextInput
                  className="w-24 text-center"
                  inputMode="decimal"
                  value={draft[r.key] ?? ""}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, [r.key]: e.target.value }));
                    setSaved(false);
                  }}
                />
                <span className="w-[190px] text-[12px] text-grey-2">
                  {r.money ? money(Number(draft[r.key]) || 0) : r.unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={() => void save()} disabled={busy || !s.isAdmin}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
