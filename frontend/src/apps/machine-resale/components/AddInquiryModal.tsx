import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import { FieldHeading, FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { insertInquiry } from "../data/mrWrites";
import { useMrStore } from "../store";
import type { InquirySource } from "../types";

const EMPTY = { machineId: "", source: "phone" as InquirySource, buyerName: "", company: "", phone: "", email: "", city: "", message: "" };

/**
 * A lead that came in by phone or WhatsApp, typed in by staff. It sends no email:
 * the automatic thank-you and alert belong to website inquiries only.
 *
 * The machine's listing number, title and salesperson are copied onto the inquiry
 * (the portal does that for website inquiries; here it is ours to do), so the
 * inquiry still reads correctly after the machine is edited or sold.
 */
export default function AddInquiryModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const s = useMrStore();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, val: (typeof EMPTY)[K]) => setV((cur) => ({ ...cur, [k]: val }));

  const machineOptions: ComboOption[] = [...s.machines]
    .sort((a, b) => b.listingNo.localeCompare(a.listingNo))
    .map((m) => ({ value: m.id, label: `${m.listingNo} · ${m.title}`, sublabel: m.status === "active" ? undefined : m.status === "sold" ? "Sold" : "Inactive" }));

  const close = () => {
    if (busy) return;
    setV(EMPTY);
    setErr(null);
    onClose();
  };

  const submit = async () => {
    const digits = v.phone.replace(/\D/g, "");
    if (v.buyerName.trim().length < 2) return setErr("Enter the buyer's name.");
    if (digits.length < 10 || digits.length > 15) return setErr("Enter a phone number of 10 to 15 digits.");
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return setErr("That email address does not look right.");
    setErr(null);
    setBusy(true);
    try {
      const m = s.machineById(v.machineId);
      const r = await insertInquiry({
        machineId: m?.id ?? null,
        listingNoSnapshot: m?.listingNo ?? null,
        machineTitleSnapshot: m?.title ?? null,
        source: v.source,
        buyerName: v.buyerName,
        company: v.company.trim() || null,
        phone: v.phone,
        email: v.email.trim() || null,
        city: v.city.trim() || null,
        message: v.message.trim() || null,
        salespersonId: m?.salespersonId ?? null,
        salespersonName: m?.salespersonName ?? null,
        salespersonEmail: m?.salespersonEmail ?? null,
      });
      await s.refresh();
      setV(EMPTY);
      onAdded(r.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add an inquiry"
      subtitle="For a buyer who phoned or sent a WhatsApp message. No email is sent."
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          {err && <span className="mr-auto text-[12.5px] text-ryg-red">{err}</span>}
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Adding..." : "Add inquiry"}</Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <FieldHeading label="Machine" hint="Leave blank for a general inquiry" />
          <Combobox
            value={v.machineId}
            options={machineOptions}
            onChange={(x) => set("machineId", x)}
            placeholder="Search by listing ID or title"
            searchable
            clearable
            autoAdvance
          />
        </div>
        <div>
          <FieldHeading label="How it came in" required />
          <ChoiceButtons
            options={[
              { value: "phone", label: "Phone" },
              { value: "whatsapp", label: "WhatsApp" },
              { value: "manual", label: "Other" },
            ]}
            value={v.source}
            onChange={(x) => set("source", x as InquirySource)}
            autoAdvance
            ariaLabel="How it came in"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Buyer name" required>
            <TextInput value={v.buyerName} maxLength={100} onChange={(e) => set("buyerName", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Phone" required>
            <TextInput value={v.phone} maxLength={30} inputMode="tel" onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" />
          </FieldLabel>
          <FieldLabel label="Company">
            <TextInput value={v.company} maxLength={150} onChange={(e) => set("company", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Email">
            <TextInput value={v.email} maxLength={200} type="email" onChange={(e) => set("email", e.target.value)} />
          </FieldLabel>
          <FieldLabel label="City">
            <TextInput value={v.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="What they asked">
          <TextArea value={v.message} maxLength={2000} rows={3} onChange={(e) => set("message", e.target.value)} />
        </FieldLabel>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
