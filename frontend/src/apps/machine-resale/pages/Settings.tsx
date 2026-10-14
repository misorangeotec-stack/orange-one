import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = !s.canEdit;

  const save = async () => {
    const problems: string[] = [];
    if (!v.brand_name.trim()) problems.push("Brand name cannot be blank.");
    if (v.support_email.trim() && !EMAIL.test(v.support_email.trim())) problems.push("The support email does not look right.");
    const list = [v.alert_1, v.alert_2].map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (list.some((x) => !EMAIL.test(x))) problems.push("Each alert copy must be an email address.");
    if (list.length === 2 && list[0] === list[1]) problems.push("The two alert copies are the same address.");
    if (v.hub_admin_url.trim() && !/^https?:\/\/\S+$/.test(v.hub_admin_url.trim())) problems.push("The admin link must start with https://");
    if (problems.length) {
      setMsg({ ok: false, text: problems.join(" ") });
      return;
    }
    setBusy(true);
    setMsg(null);
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
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" sub="The website's own name and contact details, and who is copied on every inquiry alert." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={ro || busy} className="space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="text-[15px] font-bold text-navy">On the website</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Brand name" required>
                <TextInput value={v.brand_name} maxLength={60} onChange={(e) => set("brand_name", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Tagline">
                <TextInput value={v.tagline} maxLength={120} onChange={(e) => set("tagline", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Support phone" hint="For the Call button and the footer">
                <TextInput value={v.support_phone} maxLength={30} onChange={(e) => set("support_phone", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="WhatsApp number" hint="For the WhatsApp button">
                <TextInput value={v.whatsapp_number} maxLength={30} onChange={(e) => set("whatsapp_number", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Support email" hint="Shown on the contact page; every email is sent from it">
                <TextInput value={v.support_email} type="email" maxLength={200} onChange={(e) => set("support_email", e.target.value)} />
              </FieldLabel>
            </div>
            <FieldLabel label="Banner text" hint="An optional notice across the top of the website. Leave blank for none.">
              <TextArea value={v.banner_text} maxLength={200} rows={2} onChange={(e) => set("banner_text", e.target.value)} />
            </FieldLabel>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-[15px] font-bold text-navy">Inquiry alerts</h2>
            <p className="text-[13px] text-grey-2">
              Every website inquiry alerts the machine&apos;s salesperson. These one or two people get a copy of every alert. Not shown on the website.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="First copy to">
                <TextInput value={v.alert_1} type="email" maxLength={200} onChange={(e) => set("alert_1", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Second copy to">
                <TextInput value={v.alert_2} type="email" maxLength={200} onChange={(e) => set("alert_2", e.target.value)} />
              </FieldLabel>
            </div>
            <FieldLabel label="Link into this module" hint="The alert email's button opens an inquiry here; it adds /inquiries/<inquiry number>. Not shown on the website.">
              <TextInput value={v.hub_admin_url} maxLength={300} onChange={(e) => set("hub_admin_url", e.target.value)} placeholder="https://..." />
            </FieldLabel>
          </Card>
        </fieldset>

        {!ro && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? "Saving..." : "Save settings"}
            </Button>
            {dirty && (
              <Button variant="ghost" disabled={busy} onClick={() => setEdited(null)}>
                Undo changes
              </Button>
            )}
            {msg && <span className={`text-[13px] ${msg.ok ? "text-[#1E7B3C]" : "text-ryg-red"}`}>{msg.text}</span>}
          </div>
        )}
      </form>
    </div>
  );
}
