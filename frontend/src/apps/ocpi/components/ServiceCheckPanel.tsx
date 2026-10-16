import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { StepOwnersWarning } from "./SetupWarnings";
import ServiceChecklistLink from "./ServiceChecklistLink";
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
  // ⚠ THE CHECK POINTS ARE THE MACHINE'S CHECKLIST PDF, read into lines when it
  //   was uploaded (Masters → Service checklists). The old manual master
  //   (fms_ocpi_service_checkpoints) is no longer used.
  const points = s.serviceChecklistFor(deal.machineId)?.items ?? [];

  const [installationDate, setInstallationDate] = useState("");
  const [engineer, setEngineer] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [siteReady, setSiteReady] = useState(false);
  /** Per point: Ready (true) / Not Ready (false), and an optional remark for Not Ready. */
  const [answers, setAnswers] = useState<Record<string, { ok: boolean; remark: string }>>({});
  const answer = (name: string, patch: Partial<{ ok: boolean; remark: string }>) =>
    setAnswers((a) => ({ ...a, [name]: { ...(a[name] ?? { ok: true, remark: "" }), ...patch } }));
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
      <div className="space-y-4">
      <ServiceChecklistLink
        machineId={deal.machineId}
        note="The checklist for this machine, for the installation visit."
      />
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
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-[#F7F9FC] text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                  <th className="w-14 px-3 py-2 text-center">Sr. No</th>
                  <th className="px-3 py-2 text-left">Particulars</th>
                  <th className="w-28 px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deal.svcChecks.map((c, i) => (
                  <tr key={c.name}>
                    <td className="px-3 py-2 text-center align-top text-grey-2">{i + 1}</td>
                    <td className="px-3 py-2 align-top text-navy">
                      {c.name}
                      {c.remark && <span className="block text-[12.5px] text-grey-2">Remark: {c.remark}</span>}
                    </td>
                    <td className={`px-3 py-2 text-center align-top font-semibold ${c.ok ? "text-ryg-green" : "text-ryg-red"}`}>
                      {c.ok ? "Ready" : "Not Ready"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deal.svcNote && <p className="text-[13px] text-grey">Note: {deal.svcNote}</p>}
      </Card>
      </div>
    );
  }

  if (!isServiceOpen(deal)) return null;

  const mayAct = s.canActOn("service_check");
  // Every checklist point marked Ready or Not Ready.
  const allTicked = siteReady && points.every((p) => !!answers[p]);
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
        checks: points.map((p) => ({
          name: p,
          ok: !!answers[p]?.ok,
          remark: answers[p]?.ok ? "" : (answers[p]?.remark ?? "").trim(),
        })),
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
      <ServiceChecklistLink
        machineId={deal.machineId}
        note="Download it and confirm with the customer that the site meets it before installation."
      />
      {mayAct ? (
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Service Check</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Sent to the service team on {dmy(deal.svcOpenedAt)}, together with the Finance handover.
              Fill the four fields, tick &ldquo;Site is ready&rdquo;, and mark every point of the
              machine&rsquo;s service checklist Ready or Not Ready, then submit. This completes the service
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
            <div className="divide-y divide-line rounded-xl border border-line">
              <Tick label="Site is ready for installation" checked={siteReady} onChange={setSiteReady} disabled={busy} />
            </div>

            <h3 className="pt-2 text-[13.5px] font-bold text-navy">
              Service checklist{points.length > 0 && ` — ${points.length} points`}
            </h3>
            {points.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-[#F7F9FC] text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                      <th className="w-14 px-3 py-2 text-center">Sr. No</th>
                      <th className="px-3 py-2 text-left">Particulars</th>
                      <th className="w-20 px-2 py-2 text-center">Ready</th>
                      <th className="w-24 px-2 py-2 text-center">Not Ready</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {points.map((p, i) => {
                      const a = answers[p];
                      const pick = (ok: boolean) => (
                        <input
                          type="radio"
                          name={`svc-${i}`}
                          className={`h-4 w-4 ${ok ? "accent-ryg-green" : "accent-ryg-red"}`}
                          checked={a?.ok === ok}
                          onChange={() => answer(p, { ok })}
                          disabled={busy}
                          aria-label={`${p} — ${ok ? "Ready" : "Not Ready"}`}
                        />
                      );
                      return (
                        <tr key={p} className={a && !a.ok ? "bg-[#FFF6F5]" : undefined}>
                          <td className="px-3 py-2 text-center align-top text-grey-2">{i + 1}</td>
                          <td className="px-3 py-2 align-top text-navy">
                            {p}
                            {a && !a.ok && (
                              <div className="mt-1.5">
                                <TextInput
                                  value={a.remark}
                                  onChange={(e) => answer(p, { remark: e.target.value })}
                                  placeholder="Remark — what is pending (optional)"
                                  disabled={busy}
                                />
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center align-top">{pick(true)}</td>
                          <td className="px-2 py-2 text-center align-top">{pick(false)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-grey-2">
                No service checklist with check points is uploaded for this machine. Upload its PDF
                on Masters → Service checklists (PDF).
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
                Fill all four fields, tick &ldquo;Site is ready&rdquo; and mark every checklist
                point Ready or Not Ready to submit.
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
