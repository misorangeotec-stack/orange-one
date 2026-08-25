import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { saveCompanyProfile } from "../../data/ocpiWrites";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../../data/ocpiMasters";
import type { OcpiCompanyProfile } from "../../types";

/**
 * The selling entity's identity on a printed order confirmation.
 *
 * ⚠ THIS EXISTS BECAUSE THE PAPER DECKS HARDCODED ONE COMPANY. Every source
 *   template printed "M/s ORANGE O TEC PVT LTD · AXIS BANK · Branch: SACHIN ·
 *   A/C 919030077980346" and "Ex-Work Surat". The Tally master holds FIVE
 *   selling entities across three locations, and 1,878 of 1,888 customers
 *   already carry a company. A deal booked under Enterprises, Noida or Colorix
 *   would therefore have printed another company's bank account on the contract
 *   the customer pays against. That is not a formatting problem.
 *
 * ⚠ THIS LIST IS NOW THE GATE, NOT AN ANNOTATION. A company with no row here is
 *   not offered on the quotation form at all (`companyOptions` in
 *   QuotationForm.tsx), and `CustomerPicker` will not copy one onto a draft.
 *   It used to be selectable with a warning, and the document then printed the
 *   DEFAULT entity's bank account, CIN and registered address on a contract the
 *   customer pays against. A warning is the wrong instrument for that: it is
 *   read once and clicked past, and the consequence is money sent to the wrong
 *   company. So the choice is removed rather than annotated.
 *
 * ⚠ THE DEFAULT ROW IS STILL THE FALLBACK, and something must always be marked
 *   default — it covers the ~10 Tally customers with no company at all, for whom
 *   the field is legitimately blank. `CompanyProfileWarning` also stays, for the
 *   deals raised BEFORE this gate existed, which still carry an unconfigured
 *   company and must say so on the editor and the approval panel.
 *
 * ⚠ THE LETTERHEAD IS A PATH, NOT AN UPLOAD, and deliberately so for now. The
 *   footer on the artwork carries a registered address and a CIN, so a second
 *   entity needs its own image file placed in `public/assets/ocpi/` by whoever
 *   holds the artwork. An upload box here would invite somebody to put the
 *   Orange O Tec letterhead behind a Colorix contract.
 */

const BLANK: Omit<OcpiCompanyProfile, "id"> = {
  companyId: null,
  isDefault: false,
  legalName: null,
  cin: null,
  registeredAddress: null,
  bankName: null,
  bankBranch: null,
  bankAccountNo: null,
  bankIfsc: null,
  exWorksCity: null,
  letterheadPath: null,
  active: true,
  sortOrder: 0,
};

export default function CompanyProfilesSection() {
  const s = useOcpiStore();
  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<OcpiCompanyProfile, "id">>(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const companies = masters?.companies ?? [];
  const companyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.name ?? "(unknown company)" : "Default — any company";

  /** Selling entities that would currently print the default company's details. */
  const unconfigured = useMemo(
    () => companies.filter((c) => !s.companyProfiles.some((p) => p.companyId === c.id && p.active)),
    [companies, s.companyProfiles],
  );

  function open(p: OcpiCompanyProfile | null) {
    setErr(null);
    setEditing(p?.id ?? "new");
    setDraft(p ? { ...p } : { ...BLANK });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveCompanyProfile(editing === "new" ? null : editing, draft);
      await s.refresh();
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (p: Partial<Omit<OcpiCompanyProfile, "id">>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Selling entities</h3>
          <p className="mt-1 max-w-2xl text-[12.5px] text-grey">
            The legal name, bank block, Ex-Works city and letterhead printed on an order
            confirmation. <b className="text-navy">This list decides what may be quoted under</b> —
            a company with no row here is not offered on the quotation form at all.
          </p>
        </div>
        {s.isAdmin && editing === null && (
          <Button size="sm" onClick={() => open(null)}>
            Add an entity
          </Button>
        )}
      </div>

      {unconfigured.length > 0 && (
        <p className="rounded-xl border border-ryg-amber/40 bg-page/60 p-3 text-[12.5px] text-grey">
          <b className="text-navy">Cannot be quoted under:</b> {unconfigured.map((c) => c.name).join(", ")}.
          These have no bank details of their own, so the quotation form does not offer them. Add an
          entity for each one to make it selectable.
        </p>
      )}

      <ul className="divide-y divide-line rounded-xl border border-line">
        {s.companyProfiles.length === 0 && (
          <li className="p-4 text-[13px] text-grey-2">No entities configured yet.</li>
        )}
        {s.companyProfiles.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-navy">
                {p.legalName || companyName(p.companyId)}
                {p.isDefault && (
                  <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">
                    Default
                  </span>
                )}
                {!p.active && (
                  <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">
                    Inactive
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-grey-2">
                {companyName(p.companyId)} · {p.bankName || "no bank"}
                {p.bankAccountNo ? ` · A/C ${p.bankAccountNo}` : ""} ·{" "}
                {p.exWorksCity ? `Ex-Work ${p.exWorksCity}` : "no Ex-Works city"}
              </div>
            </div>
            {s.isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => open(p)}>
                Edit
              </Button>
            )}
          </li>
        ))}
      </ul>

      {editing !== null && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <h4 className="text-[13.5px] font-bold text-navy">
            {editing === "new" ? "New selling entity" : "Edit selling entity"}
          </h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Company (Tally)" hint="which customers this applies to">
              <Combobox
                value={draft.companyId ?? ""}
                onChange={(v) => set({ companyId: v || null })}
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose the company"
                searchable
                clearable
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Legal name" hint="as it should print">
              <TextInput
                value={draft.legalName ?? ""}
                onChange={(e) => set({ legalName: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="CIN">
              <TextInput
                value={draft.cin ?? ""}
                onChange={(e) => set({ cin: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Ex-Works city" hint="prints in the delivery term">
              <TextInput
                value={draft.exWorksCity ?? ""}
                onChange={(e) => set({ exWorksCity: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Bank">
              <TextInput
                value={draft.bankName ?? ""}
                onChange={(e) => set({ bankName: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Branch">
              <TextInput
                value={draft.bankBranch ?? ""}
                onChange={(e) => set({ bankBranch: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Account no.">
              <TextInput
                value={draft.bankAccountNo ?? ""}
                onChange={(e) => set({ bankAccountNo: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="IFSC">
              <TextInput
                value={draft.bankIfsc ?? ""}
                onChange={(e) => set({ bankIfsc: e.target.value })}
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Letterhead image" hint="a file under public/assets/ocpi/">
              <TextInput
                value={draft.letterheadPath ?? ""}
                onChange={(e) => set({ letterheadPath: e.target.value })}
                placeholder="/assets/ocpi/letterhead-default.png"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Registered address" hint="prints in the letterhead footer">
            <TextArea
              rows={2}
              value={draft.registeredAddress ?? ""}
              onChange={(e) => set({ registeredAddress: e.target.value })}
              disabled={busy}
            />
          </FieldLabel>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-navy">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => set({ isDefault: e.target.checked })}
                className="h-4 w-4 accent-orange"
                disabled={busy}
              />
              Use this when the customer&rsquo;s company has no row
            </label>
            <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-navy">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => set({ active: e.target.checked })}
                className="h-4 w-4 accent-orange"
                disabled={busy}
              />
              Active
            </label>
          </div>

          {err && <p className="text-[13px] text-ryg-red">{err}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
