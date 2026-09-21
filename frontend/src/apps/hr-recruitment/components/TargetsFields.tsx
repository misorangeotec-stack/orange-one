import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";

/**
 * NR-7 — the four numbers the HR Head sets on a position.
 *
 * Shared by the approval dialog (where they are asked for the first time) and
 * the Targets dialog on an already-approved position, so the two can never
 * drift into asking for different things.
 *
 * They are held as STRINGS: a number input that stores a number cannot hold the
 * empty state while somebody is retyping it, and "" is exactly what an unset
 * target is.
 */
export interface TargetsDraft {
  days: string;
  cvs: string;
  shortlist: string;
  director: string;
}

export const draftFrom = (r: {
  targetCloseDays: number | null;
  cvTarget: number | null;
  shortlistTarget: number;
  directorCvTarget: number;
}): TargetsDraft => ({
  days: String(r.targetCloseDays ?? ""),
  cvs: String(r.cvTarget ?? ""),
  shortlist: String(r.shortlistTarget),
  director: String(r.directorCvTarget),
});

/** null for anything that is not a usable whole number — including "". */
export const numberOf = (v: string): number | null => {
  const x = Number(v.trim());
  return v.trim() === "" || !Number.isFinite(x) ? null : Math.round(x);
};

export const draftComplete = (d: TargetsDraft): boolean =>
  numberOf(d.days) !== null &&
  numberOf(d.cvs) !== null &&
  numberOf(d.shortlist) !== null &&
  numberOf(d.director) !== null;

export function TargetsFields({
  draft,
  onChange,
  heading = "Targets for this position",
}: {
  draft: TargetsDraft;
  onChange: (next: TargetsDraft) => void;
  heading?: string | null;
}) {
  const set = (k: keyof TargetsDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [k]: e.target.value });

  return (
    <div className="space-y-3.5">
      {heading && <SectionHeading>{heading}</SectionHeading>}

      {/* The explanations sit UNDER each input, not in FieldLabel's `hint`: the hint
          shares the label's own line, so at this width "calendar days, counted from
          the day the job is posted" wrapped to four lines, pushed the two inputs out
          of alignment with each other and overflowed the dialog sideways. */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <FieldLabel label="Close within" required>
            <TextInput
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              value={draft.days}
              onChange={set("days")}
              placeholder="e.g. 30"
            />
          </FieldLabel>
          <p className="mt-1 text-[11px] text-grey-2">Days, from the day the job is posted</p>
        </div>

        <div>
          <FieldLabel label="New CVs wanted" required>
            <TextInput
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={draft.cvs}
              onChange={set("cvs")}
              placeholder="e.g. 10"
            />
          </FieldLabel>
          <p className="mt-1 text-[11px] text-grey-2">For the whole position, not per seat</p>
        </div>

        <div>
          <FieldLabel label="Shortlist to the HOD" required>
            <TextInput
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={draft.shortlist}
              onChange={set("shortlist")}
            />
          </FieldLabel>
          <p className="mt-1 text-[11px] text-grey-2">Minimum profiles handed over</p>
        </div>

        <div>
          <FieldLabel label="Must reach the directors" required>
            <TextInput
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={draft.director}
              onChange={set("director")}
            />
          </FieldLabel>
          <p className="mt-1 text-[11px] text-grey-2">Minimum candidates in the R3 round</p>
        </div>
      </div>

      <p className="text-[12px] text-grey-2 leading-relaxed">
        The clock runs from the day the job is <strong>posted</strong> to the day the first offer is{" "}
        <strong>accepted</strong> — the position itself still closes when the person joins. A CV counts
        only if the hub has never seen that person before; a rejected candidate still counts.
      </p>
    </div>
  );
}
