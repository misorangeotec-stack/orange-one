import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";

/**
 * The customer auto-mail switch — the ONLY thing in this portal that emails
 * outside the company, so it gets its own arm/disarm separate from the internal
 * step-alert toggle on the Notifications tab.
 *
 * Both must be considered: internal alerts can run with customer mail off, but
 * customer mail also needs the module's email gate on for anything to be sent at
 * all. The template itself is edited in Masters → Customer mail templates.
 */
export default function CustomerMailSection() {
  const s = useDispatchStore();
  const [enabled, setEnabled] = useState(s.customerMail.enabled);
  const [code, setCode] = useState(s.customerMail.templateCode);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const templates = s.activeOf(s.mailTemplates);
  const selected = s.mailTemplates.find((t) => t.code === code);

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try {
      await s.setConfig("customer_mail", { enabled, template_code: code });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = enabled !== s.customerMail.enabled || code !== s.customerMail.templateCode;

  return (
    <Card className="p-5 space-y-4 max-w-2xl">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Customer mail</h3>
        <p className="text-[12.5px] text-grey-2 mt-1 leading-relaxed">
          When armed, the store keeper gets the option to email the customer the planned dispatch date as they record the
          material-status check. It is never automatic — they see the exact recipient, subject and body first, and tick to
          send. A customer with no email on file is skipped and the reason is recorded on the order.
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!s.isAdmin || busy}
          onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
          className="mt-0.5 w-4 h-4 accent-orange"
        />
        <span>
          <span className="block text-[13.5px] font-medium text-navy">Offer the planned-dispatch mail to customers</span>
          <span className="block text-[11.5px] leading-snug text-grey-2 mt-0.5">
            Currently {s.customerMail.enabled ? "ARMED" : "OFF"}. The module email switch (Notifications tab) must also
            be on for anything to actually send.
          </span>
        </span>
      </label>

      <FieldLabel label="Template">
        <Combobox
          value={code}
          onChange={(v) => { setCode(v); setSaved(false); }}
          options={templates.map((t) => ({ value: t.code, label: t.name, sublabel: t.code }))}
          placeholder="Select template…"
          disabled={!s.isAdmin}
        />
      </FieldLabel>

      {selected && (
        <div className="rounded-xl border border-line bg-[#FBFCFE] p-3.5 space-y-1.5">
          <p className="text-[12.5px] text-grey-2">
            Subject: <span className="text-navy">{selected.subject || "—"}</span>
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[12.5px] text-grey">{selected.body || "—"}</pre>
          <p className="text-[11.5px] text-grey-2">
            Edit the wording in Masters → Customer mail templates. Tokens:{" "}
            {"{{customer}} {{order_no}} {{order_date}} {{planned_dispatch_date}} {{items}} {{type}}"}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={!s.isAdmin || !dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
        {saved && !dirty && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
