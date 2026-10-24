import { useState, type ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { useLdStore } from "../../store";

/**
 * The shell every session panel shares: a heading, an optional "this isn't
 * yours" line, and the busy/error plumbing.
 *
 * Eight panels would otherwise each carry their own copy of `run()`, and they
 * would drift — one would forget to refresh the store after a write, which looks
 * exactly like the write having failed.
 */
export function Panel({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">{title}</h2>
          {hint && <p className="text-[12.5px] text-grey-2 mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

/**
 * ⚠ SAYS WHOSE STEP IT IS RATHER THAN DISABLING THE CONTROLS. A greyed-out
 *   button invites "why doesn't this work?"; the honest answer is that the step
 *   belongs to somebody else, and a sentence says that better than a dead form.
 */
export function NotYours({ stepKey, what }: { stepKey: string; what: string }) {
  const s = useLdStore();
  const owners = s.stepOwnerIds(stepKey).map((id) => s.personName(id)).filter((n) => n !== "—");
  return (
    <p className="text-[13px] text-grey-2">
      {owners.length > 0
        ? `${what} is ${owners.join(", ")}'s to do.`
        : `${what} has no owner configured yet — an admin sets that in Setup → Step Owners.`}
    </p>
  );
}

/** Busy + error + refresh, once. */
export function useRun(onError: (m: string | null) => void) {
  const s = useLdStore();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    onError(null);
    setBusy(true);
    try {
      await fn();
      await s.refresh();
      after?.();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** A 1–5 rating, as buttons. Nothing preselected — 3 is an opinion, not a default. */
export function Stars({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={
            "h-8 w-8 rounded-lg border text-[13px] font-semibold transition " +
            (value === n
              ? "border-orange bg-orange text-white"
              : "border-line bg-white text-grey hover:border-orange")
          }
        >
          {n}
        </button>
      ))}
    </div>
  );
}
