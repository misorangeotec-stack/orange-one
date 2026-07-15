import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ExitCaseForm from "../../components/ExitCaseForm";
import { useExitStore } from "../../store";
import type { CaseInput } from "../../data/exitWrites";

/**
 * Raise an exit.
 *
 * **NOT GATED.** This is one of only two ungated screens in any FMS, and that is the
 * whole point of `hr-exit` being a universal app: an ordinary employee who owns no
 * step, is nobody's manager and works in no clearance department must still be able
 * to resign. `resignation` is deliberately not an owned step — if it were, the PII
 * read gate (`fms_exit_is_exit_staff`) would be true for the entire company.
 *
 * Who may raise it FOR WHOM is enforced in one place, `fms_exit_raise_case`. The form
 * mirrors that rule so it never offers a button the database will reject.
 */
export default function NewExit() {
  const s = useExitStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (input: CaseInput, letter: File | null) => {
    setBusy(true);
    setErr(null);
    try {
      const id = await s.raiseCase(input, letter);
      navigate(`/hr-exit/exits/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Resign / Raise an Exit</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          This goes to the reporting manager, then to HR, then to the HR Head. The manager's answer is a
          recommendation — it does not stop the exit.
        </p>
      </div>

      <ExitCaseForm
        busy={busy}
        error={err}
        submitLabel="Raise the exit"
        onSubmit={submit}
        onCancel={() => navigate("/hr-exit")}
      />
    </div>
  );
}
