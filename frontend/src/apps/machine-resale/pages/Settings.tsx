import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { TextInput } from "@/shared/components/ui/Form";
import { FormActions, FormField, FormSection } from "../components/FormLayout";
import { saveSettings } from "../data/mrWrites";
import { PageHeader } from "../components/Pills";
import { useMrStore } from "../store";

interface Values {
  brand_name: string;
  tagline: string;
  support_phone: string;
  whatsapp_number: string;
  support_email: string;
  banner_text: string;
  alert_1: string;
  alert_2: string;
  hub_admin_url: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asText = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * The website's own details, and who is copied on every inquiry alert.
 *
 * Seeded from the loaded settings on every render until something is typed
 * (`edited ?? loaded`), so a form opened before the load lands can never save
 * blanks over the real values. Nothing here is pre-filled with the parent
 * company's name: the website must not carry it.
 */
export default function Settings() {
  const s = useMrStore();
  const alerts = Array.isArray(s.setting("alert_emails")) ? (s.setting("alert_emails") as unknown[]).map(asText) : [];
  const loaded: Values = {
    brand_name: asText(s.setting("brand_name")),
    tagline: asText(s.setting("tagline")),
    support_phone: asText(s.setting("support_phone")),
    whatsapp_number: asText(s.setting("whatsapp_number")),
    support_email: asText(s.setting("support_email")),
    banner_text: asText(s.setting("banner_text")),
    alert_1: alerts[0] ?? "",
    alert_2: alerts[1] ?? "",
    hub_admin_url: asText(s.setting("hub_admin_url")),
  };
  const [edited, setEdited] = useState<Values | null>(null);
  const v = edited ?? loaded;
  const dirty = edited !== null;
  const set = (k: keyof Values, val: string) => setEdited((cur) => ({ ...(cur ?? loaded), [k]: val }));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ro = !s.canEdit;

  const list = [v.alert_1, v.alert_2].map((x) => x.trim().toLowerCase()).filter(Boolean);
  const errors: Record<string, string> = {};
  if (!v.brand_name.trim()) errors.brand_name = "Cannot be blank";
  if (v.support_email.trim() && !EMAIL.test(v.support_email.trim())) errors.support_email = "That address does not look right";
  if (v.alert_1.trim() && !EMAIL.test(v.alert_1.trim())) errors.alert_1 = "An email address";
  if (v.alert_2.trim() && !EMAIL.test(v.alert_2.trim())) errors.alert_2 = "An email address";
  else if (list.length === 2 && list[0] === list[1]) errors.alert_2 = "Same as the first";
  if (v.hub_admin_url.trim() && !/^https?:\/\/\S+$/.test(v.hub_admin_url.trim())) errors.hub_admin_url = "Starts with https://";
  const err = (k: string) => (tried ? errors[k] : undefined);
  const ORDER = ["brand_name", "support_email", "alert_1", "alert_2", "hub_admin_url"];

  const save = async () => {
    setTried(true);
    setMsg(null);
    const first = ORDER.find((k) => errors[k]);
    if (first) {
      setMsg({ ok: false, text: "Check the fields marked in red." });
      formRef.current?.querySelector(`[data-field="${first}"]`)?.querySelector<HTMLElement>("input, textarea")?.focus();
      return;
    }
    if (busy || !dirty) return;
    setBusy(true);
    try {
      await saveSettings({
        brand_name: v.brand_name.trim(),
        tagline: v.tagline.trim(),
        support_phone: v.support_phone.trim(),
        whatsapp_number: v.whatsapp_number.trim(),
        support_email: v.support_email.trim().toLowerCase(),
        banner_text: v.banner_text.trim(),
        alert_emails: list,
        hub_admin_url: v.hub_admin_url.trim().replace(/\/+$/, ""),
      });
      await s.refresh();
      setEdited(null);
      setTried(false);
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Enter in a box moves on; Ctrl+Enter saves. */
  const onKeyDown = (ev: ReactKeyboardEvent<HTMLFormElement>) => {
    const t = ev.target as HTMLElement;
    if (ev.key !== "Enter" || !formRef.current?.contains(t)) return;
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      void save();
      return;
    }
    if (t.tagName === "INPUT") {
      ev.preventDefault();
      const all = Array.from(formRef.current.querySelectorAll<HTMLElement>("input:not([disabled]), textarea:not([disabled]), button:not([disabled])")).filter((x) => x.offsetParent !== null);
      all[all.indexOf(t) + 1]?.focus();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub="The website's own name and contact details, and who is copied on every inquiry alert." />
      <form
        ref={formRef}
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={ro || busy}>
          <Card className="space-y-6 p-5">
            <FormSection title="On the website">
              <FormField label="Brand name" required name="brand_name" error={err("brand_name")}>
                <TextInput value={v.brand_name} maxLength={60} onChange={(e) => set("brand_name", e.target.value)} />
              </FormField>
              <FormField label="Tagline" span={2} name="tagline" note="Shown under the brand name">
                <TextInput value={v.tagline} maxLength={120} onChange={(e) => set("tagline", e.target.value)} />
              </FormField>
              <FormField label="Support phone" name="support_phone" note="The Call button and the footer">
                <TextInput value={v.support_phone} maxLength={30} inputMode="tel" onChange={(e) => set("support_phone", e.target.value)} />
              </FormField>
              <FormField label="WhatsApp number" name="whatsapp_number" note="The WhatsApp button">
                <TextInput value={v.whatsapp_number} maxLength={30} inputMode="tel" onChange={(e) => set("whatsapp_number", e.target.value)} />
              </FormField>
              <FormField label="Support email" name="support_email" error={err("support_email")} note="Contact page; every email is sent from it">
                <TextInput value={v.support_email} maxLength={200} inputMode="email" onChange={(e) => set("support_email", e.target.value)} />
              </FormField>
              <FormField label="Banner text" span={3} name="banner_text" note="An optional notice across the top of the website. Leave blank for none.">
                <TextInput value={v.banner_text} maxLength={200} onChange={(e) => set("banner_text", e.target.value)} />
              </FormField>
            </FormSection>

            <FormSection title="Inquiry alerts (not shown on the website)">
              <FormField label="First copy to" name="alert_1" error={err("alert_1")} note="Copied on every website inquiry alert">
                <TextInput value={v.alert_1} maxLength={200} inputMode="email" onChange={(e) => set("alert_1", e.target.value)} />
              </FormField>
              <FormField label="Second copy to" name="alert_2" error={err("alert_2")} note="Optional">
                <TextInput value={v.alert_2} maxLength={200} inputMode="email" onChange={(e) => set("alert_2", e.target.value)} />
              </FormField>
              <FormField
                label="Link into this module"
                name="hub_admin_url"
                error={err("hub_admin_url")}
                hint="The alert's button adds /inquiries/<number>"
                note="The machine's salesperson also gets every alert"
              >
                <TextInput value={v.hub_admin_url} maxLength={300} onChange={(e) => set("hub_admin_url", e.target.value)} placeholder="https://..." />
              </FormField>
            </FormSection>

            {!ro && (
              <FormActions
                left={
                  msg ? (
                    <span className={`font-medium ${msg.ok ? "text-[#1E7B3C]" : "text-ryg-red"}`}>{msg.text}</span>
                  ) : dirty ? (
                    <span className="text-grey-2">Unsaved changes. Ctrl+Enter saves.</span>
                  ) : null
                }
              >
                <Button type="submit" disabled={busy || !dirty}>
                  {busy ? "Saving..." : "Save settings"}
                </Button>
                {dirty && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEdited(null);
                      setTried(false);
                      setMsg(null);
                    }}
                  >
                    Undo changes
                  </Button>
                )}
              </FormActions>
            )}
          </Card>
        </fieldset>
      </form>
    </div>
  );
}
