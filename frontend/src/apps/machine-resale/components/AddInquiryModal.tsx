import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Button from "@/shared/components/ui/Button";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import { TextArea, TextInput } from "@/shared/components/ui/Form";
import { insertInquiry } from "../data/mrWrites";
import { useMrStore } from "../store";
import type { InquirySource } from "../types";
import { ControlRow, FormActions, FormField, FormSection } from "./FormLayout";

const EMPTY = { machineId: "", source: "phone" as InquirySource, buyerName: "", company: "", phone: "", email: "", city: "", message: "" };
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]):not([type="hidden"]), textarea:not([disabled]):not([tabindex="-1"])';
const ORDER = ["buyerName", "phone", "email"];

/**
 * A lead that came in by phone or WhatsApp, typed in by staff. It sends no email:
 * the automatic thank-you and alert belong to website inquiries only.
 *
 * The machine's listing number, title and salesperson are copied onto the inquiry
 * (the portal does that for website inquiries; here it is ours to do), so the
 * inquiry still reads correctly after the machine is edited or sold.
 *
 * Keys: it opens on the Machine picker; Enter in a box moves on, Ctrl+Enter saves.
 */
export default function AddInquiryModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const s = useMrStore();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLFormElement>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, val: (typeof EMPTY)[K]) => setV((cur) => ({ ...cur, [k]: val }));

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const machineOptions: ComboOption[] = [...s.machines]
    .sort((a, b) => b.listingNo.localeCompare(a.listingNo))
    .map((m) => ({ value: m.id, label: `${m.listingNo} · ${m.title}`, sublabel: m.status === "active" ? undefined : m.status === "sold" ? "Sold" : "Inactive" }));
  const machine = s.machineById(v.machineId);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const digits = v.phone.replace(/\D/g, "");
    if (v.buyerName.trim().length < 2) e.buyerName = "The buyer's name";
    if (digits.length < 10 || digits.length > 15) e.phone = "10 to 15 digits";
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "That address does not look right";
    return e;
  }, [v]);
  const err = (k: string) => (tried ? errors[k] : undefined);

  const close = () => {
    if (busy) return;
    setV(EMPTY);
    setTried(false);
    setProblem(null);
    onClose();
  };

  const submit = async () => {
    setTried(true);
    setProblem(null);
    const first = ORDER.find((k) => errors[k]);
    if (first) {
      box.current?.querySelector(`[data-field="${first}"]`)?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const r = await insertInquiry({
        machineId: machine?.id ?? null,
        listingNoSnapshot: machine?.listingNo ?? null,
        machineTitleSnapshot: machine?.title ?? null,
        source: v.source,
        buyerName: v.buyerName,
        company: v.company.trim() || null,
        phone: v.phone,
        email: v.email.trim() || null,
        city: v.city.trim() || null,
        message: v.message.trim() || null,
        salespersonId: machine?.salespersonId ?? null,
        salespersonName: machine?.salespersonName ?? null,
        salespersonEmail: machine?.salespersonEmail ?? null,
      });
      await s.refresh();
      setV(EMPTY);
      setTried(false);
      onAdded(r.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (ev: ReactKeyboardEvent<HTMLFormElement>) => {
    const t = ev.target as HTMLElement;
    if (!box.current?.contains(t)) return; // a picker's portalled search box
    if (ev.key !== "Enter") return;
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      void submit();
      return;
    }
    if (t.tagName === "INPUT") {
      ev.preventDefault();
      const all = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      all[all.indexOf(t) + 1]?.focus();
    }
  };

  return (
    <Modal open={open} onClose={close} title="Add an inquiry" subtitle="For a buyer who phoned or sent a WhatsApp message. No email is sent." size="lg">
      <form
        ref={box}
        className="space-y-4"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormSection cols={1}>
          <FormField
            label="Machine"
            group
            name="machineId"
            note={machine ? `Salesperson: ${machine.salespersonName ?? "none set"}` : "Leave blank for a general inquiry"}
          >
            <Combobox value={v.machineId} options={machineOptions} onChange={(x) => set("machineId", x)} placeholder="Search by listing ID or title" searchable clearable autoAdvance />
          </FormField>
          <FormField label="How it came in" required group name="source">
            <ControlRow>
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
            </ControlRow>
          </FormField>
          <FormField label="Buyer name" required name="buyerName" error={err("buyerName")}>
            <TextInput value={v.buyerName} maxLength={100} onChange={(e) => set("buyerName", e.target.value)} />
          </FormField>
          <FormField label="Phone" required name="phone" error={err("phone")}>
            <TextInput value={v.phone} maxLength={30} inputMode="tel" onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Company" name="company">
            <TextInput value={v.company} maxLength={150} onChange={(e) => set("company", e.target.value)} />
          </FormField>
          <FormField label="Email" name="email" error={err("email")}>
            <TextInput value={v.email} maxLength={200} inputMode="email" onChange={(e) => set("email", e.target.value)} />
          </FormField>
          <FormField label="City" name="city">
            <TextInput value={v.city} maxLength={100} onChange={(e) => set("city", e.target.value)} />
          </FormField>
          <FormField label="What they asked" name="message">
            <TextArea value={v.message} maxLength={2000} rows={3} onChange={(e) => set("message", e.target.value)} />
          </FormField>
        </FormSection>
        <FormActions left={problem ? <span className="font-medium text-ryg-red">{problem}</span> : <span className="text-grey-2">Ctrl+Enter adds it</span>}>
          <Button type="submit" disabled={busy}>{busy ? "Adding..." : "Add inquiry"}</Button>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
