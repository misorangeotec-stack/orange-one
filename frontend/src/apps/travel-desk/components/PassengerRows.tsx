import { useMemo } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput, Select } from "@/shared/components/ui/Form";
import { useDirectory } from "@/core/platform/store";
import type { PassengerInput } from "../data/travelTripWrites";

/**
 * Who is on the ticket.
 *
 * ⚠ A PASSENGER IS NOT A CLAIMANT, and the form says so rather than assuming the
 *   reader knows. Reimbursement is personal — Policy §11 pays into one
 *   employee's account — so a second EMPLOYEE travelling alongside raises their
 *   own trip. What this list is for is the airline: a booking needs a name, a
 *   gender and a date of birth for every seat, including a customer or a spouse
 *   who will never be a portal user.
 *
 * ⚠ PICKING A COLLEAGUE FILLS THE ROW FROM THEIR PROFILE. That is the entire
 *   reason `profiles.gender` and `profiles.date_of_birth` were added: the source
 *   PRD's answer was "passenger details are always entered manually for every
 *   traveller", which means somebody retypes their own date of birth on every
 *   trip they ever take, and one typo is a denied boarding at the gate.
 *
 *   The copied values stay EDITABLE. A profile may be blank or wrong, and the
 *   person standing at the counter needs to be able to fix it here without
 *   waiting for an administrator.
 */
export default function PassengerRows({
  rows,
  onChange,
  max,
  disabled,
}: {
  rows: PassengerInput[];
  onChange: (rows: PassengerInput[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const { profiles } = useDirectory();

  const peopleOptions = useMemo(
    () => profiles.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [profiles],
  );

  const set = (i: number, patch: Partial<PassengerInput>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const pickEmployee = (i: number, userId: string) => {
    const p = profiles.find((x) => x.id === userId);
    if (!p) {
      set(i, { employeeId: null });
      return;
    }
    set(i, {
      employeeId: p.id,
      fullName: p.name,
      // Only overwrite what the profile actually knows: a blank profile must not
      // wipe a gender somebody has already typed into the row by hand.
      gender: p.gender ?? rows[i].gender,
      dateOfBirth: p.dateOfBirth ?? rows[i].dateOfBirth,
      mobile: p.phone ?? rows[i].mobile,
      email: p.email ?? rows[i].email,
    });
  };

  const add = () =>
    onChange([
      ...rows,
      {
        employeeId: null,
        fullName: "",
        gender: null,
        dateOfBirth: null,
        mobile: null,
        email: null,
        isPrimary: false,
      },
    ]);

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-[12.5px] text-grey-2">
          Nobody else is travelling. Add a row only for a co-passenger who needs to be on the same
          booking — a colleague who also needs to claim raises their own request.
        </p>
      )}

      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">
              Passenger {i + 1}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="text-[12px] font-medium text-ryg-red hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                From the portal
              </div>
              <Combobox
                value={r.employeeId ?? ""}
                onChange={(v) => pickEmployee(i, v)}
                options={peopleOptions}
                clearable
                disabled={disabled}
                placeholder="— Not a colleague —"
                wrapLabel
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                Name as on the ID *
              </div>
              <TextInput
                value={r.fullName}
                onChange={(e) => set(i, { fullName: e.target.value })}
                disabled={disabled}
                placeholder="exactly as printed on the ID"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                Gender
              </div>
              <Select
                value={r.gender ?? ""}
                onChange={(e) => set(i, { gender: (e.target.value || null) as PassengerInput["gender"] })}
                disabled={disabled}
              >
                <option value="">— Not given —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                Date of birth
              </div>
              <TextInput
                type="date"
                value={r.dateOfBirth ?? ""}
                onChange={(e) => set(i, { dateOfBirth: e.target.value || null })}
                disabled={disabled}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                Mobile
              </div>
              <TextInput
                value={r.mobile ?? ""}
                onChange={(e) => set(i, { mobile: e.target.value || null })}
                disabled={disabled}
                inputMode="tel"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                Email
              </div>
              <TextInput
                type="email"
                value={r.email ?? ""}
                onChange={(e) => set(i, { email: e.target.value || null })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ))}

      {!disabled && (
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={add} disabled={rows.length >= max}>
            Add a passenger
          </Button>
          <span className="text-[12px] text-grey-2">
            {rows.length >= max
              ? `A trip carries at most ${max} passengers — raise a second request for the rest.`
              : `${max - rows.length} more allowed`}
          </span>
        </div>
      )}
    </div>
  );
}
