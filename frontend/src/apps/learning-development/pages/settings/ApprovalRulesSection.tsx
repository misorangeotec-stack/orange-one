import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { inr } from "../../lib/format";

/**
 * Approval Rules (admin) — whether a request needs Management approval as well as
 * the HR Head's, and above what amount.
 *
 * The client asked for this as a setting rather than a fixed second gate:
 * "We should be able to configure in the settings whether both have to approve or
 * just one approval will be required."
 *
 * ⚠ CHANGING IT DOES NOT MOVE A REQUEST THAT IS ALREADY IN FLIGHT, and the screen
 *   says so. Each request freezes `mgmt_required` at proposal time. Without that,
 *   lowering the threshold this afternoon would push requests that already
 *   cleared HR Head approval back into a queue they had passed — and raising it
 *   would quietly let one through a gate somebody had already decided it needed.
 */
export default function ApprovalRulesSection() {
  const s = useLdStore();
  const [mgmt, setMgmt] = useState<string>(s.approvalRule.mgmt);
  const [amount, setAmount] = useState<string>(String(s.approvalRule.aboveAmount || ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.writes.setApprovalRule({
        mgmt: mgmt as "never" | "always" | "above",
        aboveAmount: amount === "" ? 0 : Number(amount),
      });
      await s.refresh();
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = s.requests.filter((r) => r.status === "hr_approved").length;

  return (
    <Card className="p-5 space-y-5 max-w-2xl">
      <div>
        <h2 className="text-[15px] font-semibold text-navy">Management approval</h2>
        <p className="text-[13px] text-grey-2 mt-1">
          The HR Head always approves. This decides whether Management approves as well.
        </p>
      </div>

      <FieldLabel label="When is Management approval needed?">
        <Combobox
          value={mgmt}
          onChange={setMgmt}
          options={[
            { value: "never", label: "Never — the HR Head's approval is final" },
            { value: "always", label: "Always — every request, whatever it costs" },
            { value: "above", label: "Only above an amount" },
          ]}
        />
      </FieldLabel>

      {mgmt === "above" && (
        <FieldLabel label="Above this amount" hint="A request costing more than this also goes to Management.">
          <TextInput
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="25000"
          />
        </FieldLabel>
      )}

      <p className="rounded-lg bg-[#F8FAFD] px-3 py-2 text-[12.5px] text-navy">
        {mgmt === "never" && "Requests will go straight from the HR Head to trainer selection."}
        {mgmt === "always" && "Every request will wait for Management after the HR Head."}
        {mgmt === "above" &&
          `A request costing more than ${inr(amount === "" ? 0 : Number(amount))} will wait for Management after the HR Head.`}
      </p>

      <p className="rounded-lg bg-[#FFF7E6] px-3 py-2 text-[12.5px] text-navy">
        <strong>This applies to requests proposed from now on.</strong> Anything already moving keeps the
        rule it was proposed under
        {pending > 0 ? ` — ${pending} request${pending === 1 ? " is" : "s are"} waiting for Management right now and will stay there.` : "."}
      </p>

      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      {saved && <p className="text-[13px] text-ryg-green">Saved.</p>}

      <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
    </Card>
  );
}
