import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { StepOwnersWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { recordServiceCheck } from "../data/ocpiWrites";
import { isServiceOpen } from "../lib/queues";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/** A tick box with its label, the whole row clickable. */
function Tick({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-[13.5px] text-navy">
      <input
        type="checkbox"
        className="h-4 w-4 accent-orange"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}

/**
 * The service team's Service Check.
 *
 * ⚠ PARALLEL TO FINANCE. It opens with the countersignature, beside "Hand Over
 *   to Finance", and neither waits for the other — so this panel keys off the
 *   svc_* columns, never off `status`.
 *
 * ⚠ IT SELF-HIDES. Nothing shows for a deal that was never sent to Service.
 *   Once completed it stays on the deal as a read-only record.
 */
export default function ServiceCheckPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const personById = useOrgPersonById();
  const activePoints = s.serviceCheckpoints.filter((c) => c.active);

  const [installationDate, setInstallationDate] = useState("");
  const [engineer, setEngineer] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [siteReady, setSiteReady] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!deal.svcOpenedAt) return null;

  // ── Completed: the record ────────────────────────────────────────────────
  if (deal.svcAt) {
    const by = deal.svcBy ? personById(deal.svcBy)?.name ?? "Someone" : "Someone";
    const facts: [string, string][] = [
      ["Installation date", dmy(deal.svcInstallationDate)],
      ["Service engineer", deal.svcEngineer ?? "—"],
      ["Site contact", [deal.svcSiteContactName, deal.svcSiteContactPhone].filter(Boolean).join(" · ") || "—"],
      ["Site ready", deal.svcSiteReady === null ? "—" : deal.svcSiteReady ? "Yes" : "No"],
    ];
    return (
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Service Check</h2>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            Completed by {by} on {dmy(deal.svcAt)}.
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</dt>
              <dd className="mt-0.5 text-[13.5px] font-medium text-navy">{value}</dd>
            </div>
          ))}
        </dl>
        {deal.svcSiteRemark && (
          <p className="text-[13px] text-grey">Site remark: {deal.svcSiteRemark}</p>
        )}
        {deal.svcChecks.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {deal.svcChecks.map((c) => (
              <li key={c.name} className="flex items-start justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <span className="text-navy">
                  {c.name}
                  {c.remark && <span className="block text-[12.5px] text-grey-2">{c.remark}</span>}
                </span>
                <span className={`shrink-0 font-semibold ${c.ok ? "text-ryg-green" : "text-ryg-red"}`}>
                  {c.ok ? "Yes" : "No"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {deal.svcNote && <p className="text-[13px] text-grey">Note: {deal.svcNote}</p>}
      </Card>
    );
  }

  if (!isServiceOpen(deal)) return null;

  const mayAct = s.canActOn("service_check");
  const allTicked = siteReady && activePoints.every((c) => ticked[c.name]);
  const filled =
    !!installationDate && !!engineer.trim() && !!contactName.trim() && !!contactPhone.trim();

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await recordServiceCheck(deal.id, {
        installationDate,
        engineer,
        siteContactName: contactName,
        siteContactPhone: contactPhone,
        siteReady,
        siteRemark: "",
        checks: activePoints.map((c) => ({ name: c.name, ok: !!ticked[c.name], remark: "" })),
        note,
      });
      await s.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The RPC is missing until migration 20270119120000 is on the database.
      setError(
        /fms_ocpi_record_service_check|Could not find the function/i.test(msg)
          ? "The Service Check is not switched on in the database yet, so it cannot be saved. Ask the admin to apply the Service Check update."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <StepOwnersWarning step="service_check" />
      {mayAct ? (
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Service Check</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Sent to the service team on {dmy(deal.svcOpenedAt)}, together with the Finance handover.
              Fill the four fields and tick every box, then submit. This completes the service
              team&rsquo;s part and changes nothing else on the deal.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Installation date" required>
              <TextInput
                type="date"
                value={installationDate}
                onChange={(e) => setInstallationDate(e.target.value)}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Service engineer" required>
              <TextInput
                value={engineer}
                onChange={(e) => setEngineer(e.target.value)}
                placeholder="Engineer assigned to this machine"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Customer site contact — name" required>
              <TextInput
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Customer site contact — phone" required>
              <TextInput
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                inputMode="tel"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <div className="space-y-2">
            <h3 className="text-[13.5px] font-bold text-navy">Tick every box</h3>
            <div className="divide-y divide-line rounded-xl border border-line">
              <Tick label="Site is ready for installation" checked={siteReady} onChange={setSiteReady} disabled={busy} />
              {activePoints.map((c) => (
                <Tick
                  key={c.id}
                  label={c.name}
                  checked={!!ticked[c.name]}
                  onChange={(v) => setTicked((t) => ({ ...t, [c.name]: v }))}
                  disabled={busy}
                />
              ))}
            </div>
            {activePoints.length === 0 && (
              <p className="text-[12.5px] text-grey-2">
                More check points can be added under Masters → Service check points.
              </p>
            )}
          </div>

          <FieldLabel label="Note" hint="optional">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </FieldLabel>

          <div>
            <Button onClick={() => void complete()} disabled={busy || !allTicked || !filled}>
              {busy ? "Submitting…" : "Submit"}
            </Button>
            {(!allTicked || !filled) && (
              <span className="ml-3 text-[12.5px] text-grey-2">
                Fill all four fields and tick every box to submit.
              </span>
            )}
          </div>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This deal is waiting for the service team&rsquo;s Service Check. Nothing for you to do here.
          </p>
        </Card>
      )}
    </div>
  );
}
