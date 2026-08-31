import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";

/**
 * Which bands need which approvals (§3.2).
 *
 * ⚠ THIS SCREEN EXISTS BECAUSE THE POLICY LEFT A QUESTION OPEN. §3.2 sends
 *   bands 6–9 to a Director and then writes, in the document itself,
 *   "[⚠ CONFIRM if HOD is also needed]" for bands 6–8. That is H1's smaller
 *   sibling, H10: nobody has answered it, and the answer changes who signs off
 *   roughly a third of the company's travel. The default here is BOTH — the
 *   reading that cannot silently drop an approval nobody meant to drop — and
 *   answering it the other way is a setting rather than a deploy.
 *
 * ⚠ IT ROUTES ON THE BAND NUMBER, NOT THE TRAVEL CATEGORY. That is deliberate
 *   and it de-risks the whole approval chain: §3.2 is unambiguous about band
 *   numbers even though the band → category mapping is still disputed for bands
 *   3 and 8 (H1). Nothing on this screen waits on that answer.
 *
 * ⚠ CHANGING IT DOES NOT RE-ROUTE TRIPS ALREADY IN FLIGHT. The skip flags were
 *   written onto each trip when it was submitted, and `fms_travel_next_stop`
 *   reads those flags rather than re-deriving them. A trip that started without
 *   a Director does not acquire one halfway through, which is the same freeze
 *   doctrine the rate card follows.
 */
export default function ApprovalMatrixSection() {
  const s = useTravelStore();
  const { profiles, bands, bandById } = useDirectory();

  const [from, setFrom] = useState(String(s.config.approvalMatrix.directorFromBand));
  const [also, setAlso] = useState(s.config.approvalMatrix.managerAlsoForDirectorBands);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const threshold = Number(from);
  const valid = Number.isFinite(threshold) && threshold >= 1 && threshold <= 10;

  /**
   * How many real people each side of the line.
   *
   * ⚠ SHOWN BECAUSE A THRESHOLD IS MEANINGLESS WITHOUT A HEADCOUNT. "Bands 6 and
   *   above" is an abstraction; "37 of 59 people, so most travel goes to a
   *   Director" is the decision. Bands 1 and 5 are empty in the live directory,
   *   so moving the line by one can change nothing at all — worth seeing before
   *   you move it.
   */
  const counts = useMemo(() => {
    let above = 0;
    let below = 0;
    let unbanded = 0;
    for (const p of profiles) {
      const b = bandById(p.bandId)?.bandNo;
      if (b === undefined) unbanded += 1;
      else if (valid && b >= threshold) above += 1;
      else below += 1;
    }
    return { above, below, unbanded };
  }, [profiles, bandById, threshold, valid]);

  const dirty =
    Number(from) !== s.config.approvalMatrix.directorFromBand ||
    also !== s.config.approvalMatrix.managerAlsoForDirectorBands;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setApprovalMatrix({
        directorFromBand: threshold,
        managerAlsoForDirectorBands: also,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-bold text-navy">Approval matrix</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        Which bands need a Director as well as their reporting manager. Policy §3.2 sets the
        threshold and then leaves the second question open for bands 6–8.
      </p>

      <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        <FieldLabel label="A Director is needed from band" hint="§3.2 says 6">
          <TextInput
            type="number"
            min={1}
            max={10}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FieldLabel>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
            Those bands also need their manager
          </div>
          <label className="flex items-center gap-2 py-2 text-[13px] text-navy">
            <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} />
            Both signatures
          </label>
          <p className="text-[11.5px] text-grey-2">
            Unticked, bands at or above the threshold go straight to a Director and skip the
            reporting manager entirely.
          </p>
        </div>
      </div>

      {valid && (
        <p className="mt-3 rounded-lg bg-page px-3 py-2 text-[12.5px] text-grey">
          On today's directory that is <strong className="text-navy">{counts.above}</strong>{" "}
          {counts.above === 1 ? "person" : "people"} needing a Director and{" "}
          <strong className="text-navy">{counts.below}</strong> needing only their manager
          {counts.unbanded > 0 && (
            <>
              . {counts.unbanded} {counts.unbanded === 1 ? "profile has" : "profiles have"} no band
              at all and cannot raise a trip until an administrator sets one
            </>
          )}
          .{" "}
          {bands.filter((b) => !profiles.some((p) => p.bandId === b.id)).length > 0 && (
            <span className="text-grey-2">
              Some bands hold nobody, so moving the line by one may change nothing.
            </span>
          )}
        </p>
      )}

      <p className="mt-2 text-[12px] text-grey-2">
        Changing this does not re-route trips already in flight — each trip froze its own answer
        when it was submitted.
      </p>

      {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={busy || !valid || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!valid && <span className="text-[12.5px] text-ryg-red">Band must be between 1 and 10.</span>}
        {saved && <span className="text-[12.5px] font-medium text-ryg-green">✓ Saved</span>}
      </div>
    </Card>
  );
}
