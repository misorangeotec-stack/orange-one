import Card from "@/shared/components/ui/Card";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useComplaintStore } from "../store";
import {
  dmy,
  invoiceDateLabelOf,
  invoiceLabelOf,
  lotLabelOf,
  partyLabelOf,
  partyRoleOf,
} from "../lib/format";
import { COMPLAINT_TYPE_LABEL, COMPLAINT_TYPES, type ComplaintType } from "../types";
import { nowLocalInput, type ComplaintFormApi } from "../pages/requests/useComplaintForm";

/**
 * The raise panel — the whole of the source sheet's first block.
 *
 * ⚠ THE LABELS COME FROM lib/format.ts, NEVER FROM A LITERAL HERE. "FG Lot No." /
 *   "RM Lot No.", "Customer Name" / "Vendor Name", "Sales Invoice No." /
 *   "Purchase Invoice No." are one column each, re-labelled by `complaintType` —
 *   which is exactly how the business describes it ("all the heading of sales and
 *   customer, change"). Type a label here and the form and the register will
 *   eventually disagree about what a column is called.
 */
function ErrorText({ children }: { children: string }) {
  if (!children) return null;
  return <p className="mt-1 text-[12px] text-red-600">{children}</p>;
}

export default function ComplaintFields({ f }: { f: ComplaintFormApi }) {
  const s = useComplaintStore();
  const t = f.form.complaintType;

  const companyOpts = s.companies.map((c) => ({ value: c.id, label: c.name }));
  const partyOpts = f.partyOptions.map((p) => ({ value: p.id, label: p.name }));
  const itemOpts = f.partyItems.map((i) => ({
    value: i.id,
    label: i.name,
    sublabel: i.category ?? undefined,
  }));
  const natureOpts = s.natures
    .filter((n) => n.active)
    .map((n) => ({ value: n.id, label: n.name }));
  const unitOpts = s.units.map((u) => ({ value: u.name, label: u.name }));

  return (
    <div className="space-y-5">
      {/* ---------------------------- what kind ---------------------------- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Type of complaint</h2>
        <div className="mt-3 max-w-md">
          <ChoiceButtons
            ariaLabel="Type of complaint"
            options={COMPLAINT_TYPES.map((v) => ({ value: v, label: COMPLAINT_TYPE_LABEL[v] }))}
            value={t}
            onChange={(v) => f.setComplaintType(v as ComplaintType)}
          />
        </div>
      </Card>

      {/* ------------------------- the LOT and its facts ------------------- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">The LOT facing the issue</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel strong label={lotLabelOf(t)} required>
              <TextInput
                value={f.form.lotNo}
                onChange={(e) => f.set("lotNo", e.target.value)}
                onBlur={() => void f.lookupLot()}
                placeholder={t === "finished_good" ? "e.g. 2604842" : "supplier's lot / batch no."}
              />
            </FieldLabel>
            <ErrorText>{f.errorFor("lotNo")}</ErrorText>
            {f.lotLooking && (
              <p className="mt-1 text-[12px] text-grey-2">Looking this LOT up in Tally…</p>
            )}
            {f.lotNote && <p className="mt-1 text-[12px] text-emerald-700">{f.lotNote}</p>}
            {f.lotMiss && <p className="mt-1 text-[12px] text-amber-700">{f.lotMiss}</p>}
          </div>

          <div>
            <FieldLabel
              label="LOT Expiry Date"
              hint="typed — no system holds this"
            >
              <TextInput
                type="date"
                value={f.form.lotExpiryDate}
                onChange={(e) => f.set("lotExpiryDate", e.target.value)}
              />
            </FieldLabel>
          </div>

          <div>
            <FieldLabel strong label="Company" hint="whose book this sits in">
              <Combobox
                value={f.form.companyId}
                onChange={(v) => f.set("companyId", v)}
                options={companyOpts}
                placeholder="Select a company"
                clearable
              />
            </FieldLabel>
          </div>
        </div>

        {/*
          THE CANDIDATE LIST — the whole reason the lookup returns a list.

          A lot number is not a unique key: a drum is bought once and sold from
          repeatedly, so 92% of lots sit on more than one line. Auto-filling the
          first match would put a coin-toss customer on the complaint, so the
          shipments are shown and the user says which one they mean.
        */}
        {f.lotMatches.length > 0 && (
          <div className="mt-4 rounded-xl border border-line overflow-hidden">
            <div className="px-3.5 py-2 bg-page border-b border-line">
              <p className="text-[12.5px] font-semibold text-navy">
                {f.lotMatches.length === 1
                  ? "One shipment carried this LOT"
                  : `${f.lotMatches.length} shipments carried this LOT`}
              </p>
              <p className="text-[11.5px] text-grey-2">
                Pick the one this complaint is about — it fills the party, item and invoice.
              </p>
            </div>
            <ul className="divide-y divide-line max-h-64 overflow-y-auto">
              {f.lotMatches.map((m, i) => (
                <li key={`${m.voucherNo}-${m.itemName}-${m.rawBatch}-${i}`}>
                  <button
                    type="button"
                    onClick={() => f.applyLotMatch(m)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-page transition"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold text-navy">{m.voucherNo}</span>
                      <span className="text-[11.5px] text-grey-2 shrink-0">
                        {m.voucherDate ? dmy(m.voucherDate) : "—"}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-ink mt-0.5">{m.partyName || "—"}</div>
                    {/* Which book — two companies can ship the same lot, and the
                        complaint has to be filed against the right one. */}
                    <div className="text-[11.5px] text-grey-2">
                      {s.companyName(m.companyId) !== "—"
                        ? s.companyName(m.companyId)
                        : m.tallyCompany}
                    </div>
                    <div className="text-[11.5px] text-grey-2">
                      {m.itemName}
                      {m.qty ? ` · ${m.qty}` : ""}
                      {m.godown ? ` · ${m.godown}` : ""}
                    </div>
                    {/* The raw batch string, shown only when it differs from the
                        clean lot — so "#1637-26071173" is explicable rather than
                        looking like the wrong row. */}
                    {m.rawBatch && m.rawBatch !== f.form.lotNo.trim() && (
                      <div className="text-[11px] text-grey-2 mt-0.5">
                        Tally batch: <span className="font-mono">{m.rawBatch}</span>
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* --------------------- the party and the invoice ------------------- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">
          {partyRoleOf(t)} and invoice
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <FieldLabel
              label={partyLabelOf(t)}
              required
              hint={f.form.companyId ? undefined : "pick a company to narrow this"}
            >
              <Combobox
                value={f.form.partyId}
                onChange={(v) => {
                  const p = f.partyOptions.find((x) => x.id === v);
                  f.set("partyId", v);
                  f.set("partyName", p?.name ?? "");
                }}
                options={partyOpts}
                placeholder={`Search ${partyRoleOf(t).toLowerCase()}s`}
                searchable
                wrapLabel
                clearable
              />
            </FieldLabel>
            {/* The typed fallback is not a nicety: a complaint can legitimately name
                a party that is not in the central master, and refusing it would
                block the complaint rather than fix the master. */}
            {!f.form.partyId && (
              <TextInput
                className="mt-2"
                value={f.form.partyName}
                onChange={(e) => f.set("partyName", e.target.value)}
                placeholder={`…or type the ${partyRoleOf(t).toLowerCase()} name`}
              />
            )}
            <ErrorText>{f.errorFor("partyName")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label={invoiceLabelOf(t)} required>
              <TextInput
                value={f.form.invoiceNo}
                onChange={(e) => f.set("invoiceNo", e.target.value)}
                placeholder="as it appears in Tally"
              />
            </FieldLabel>
            <ErrorText>{f.errorFor("invoiceNo")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label={invoiceDateLabelOf(t)} required>
              <TextInput
                type="date"
                value={f.form.invoiceDate}
                onChange={(e) => f.set("invoiceDate", e.target.value)}
              />
            </FieldLabel>
            <ErrorText>{f.errorFor("invoiceDate")}</ErrorText>
          </div>
        </div>
      </Card>

      {/* ----------------------------- the item ---------------------------- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">The item</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <FieldLabel strong label="Item name" required>
              <Combobox
                value={f.form.itemId}
                onChange={(v) => f.pickItem(f.partyItems.find((i) => i.id === v) ?? null)}
                options={itemOpts}
                placeholder={f.form.partyId ? "Search this party's items" : "Pick a party first"}
                disabled={!f.form.partyId}
                searchable
                wrapLabel
                clearable
              />
            </FieldLabel>
            {!f.form.itemId && (
              <TextInput
                className="mt-2"
                value={f.form.itemName}
                onChange={(e) => f.set("itemName", e.target.value)}
                placeholder="…or type the item name"
              />
            )}
            <ErrorText>{f.errorFor("itemName")}</ErrorText>
          </div>

          <div>
            {/* Seeded from mst_items.category — the authoritative 96-value list — and
                then left editable, because the item master is not always right. */}
            <FieldLabel strong label="Category of ink" hint="from the item master">
              <TextInput
                value={f.form.category}
                onChange={(e) => f.set("category", e.target.value)}
                placeholder="e.g. REACTIVE INK"
              />
            </FieldLabel>
          </div>

          <div>
            <FieldLabel strong label="Ink type" hint="optional">
              <TextInput
                value={f.form.inkType}
                onChange={(e) => f.set("inkType", e.target.value)}
              />
            </FieldLabel>
          </div>

          <div>
            <FieldLabel strong label="Quantity affected" hint="optional">
              <TextInput
                inputMode="decimal"
                value={f.form.qtyAffected}
                onChange={(e) => f.set("qtyAffected", e.target.value)}
                placeholder="e.g. 25"
              />
            </FieldLabel>
          </div>

          <div>
            <FieldLabel strong label="Unit" hint="optional">
              <Combobox
                value={f.form.unitName}
                onChange={(v) => f.set("unitName", v)}
                options={unitOpts}
                placeholder="Select a unit"
                clearable
              />
            </FieldLabel>
          </div>
        </div>
      </Card>

      {/* ---------------------------- the problem -------------------------- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">The problem</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            {/* Asked separately from the raise date on purpose: the gap between
                noticing a problem and reporting it is often the whole story. */}
            <FieldLabel
              strong
              label="Issue identified on"
              required
              hint={
                f.form.invoiceDate
                  ? `between ${dmy(f.form.invoiceDate)} and now`
                  : "when it was noticed, not when raised"
              }
            >
              {/*
                BOUNDED BY THE INVOICE AND BY NOW. The goods cannot have failed
                before they were invoiced, and a problem cannot be noticed in the
                future — so the picker refuses both rather than letting somebody
                choose a value the form will only reject on submit.

                ⚠ min/max ARE A COURTESY, NOT THE GUARD. A browser that ignores
                  them, or a pasted value, still reaches `errors` in
                  useComplaintForm and the table CHECK
                  `fms_complaint_issue_not_before_invoice` behind that. Both stay.

                No `min` until an invoice date is chosen: an empty min would read
                as "any date is fine", and the two fields are filled in either
                order.
              */}
              <TextInput
                type="datetime-local"
                value={f.form.issueIdentifiedAt}
                onChange={(e) => f.set("issueIdentifiedAt", e.target.value)}
                min={f.form.invoiceDate ? `${f.form.invoiceDate}T00:00` : undefined}
                max={nowLocalInput()}
              />
            </FieldLabel>
            <ErrorText>{f.errorFor("issueIdentifiedAt")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Nature of complaint" hint="optional">
              <Combobox
                value={f.form.natureId}
                onChange={(v) => f.set("natureId", v)}
                options={natureOpts}
                placeholder={natureOpts.length ? "Select what went wrong" : "No natures set up yet"}
                disabled={!natureOpts.length}
                searchable
                clearable
              />
            </FieldLabel>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel strong label="Problem in details" required>
              <TextArea
                rows={4}
                value={f.form.problemDetails}
                onChange={(e) => f.set("problemDetails", e.target.value)}
                placeholder="What is wrong, how it showed up, and what the party has said."
              />
            </FieldLabel>
            <ErrorText>{f.errorFor("problemDetails")}</ErrorText>
          </div>

          <div className="sm:col-span-2">
            {/*
              ATTACHMENTS AT RAISE. Staged in the form and uploaded the instant
              the complaint has an id — the storage path starts with that id, so
              there is nothing to upload against before submit. They then follow
              the complaint through every bucket to the last (ComplaintRecap).
            */}
            <FieldLabel strong label="Attachments" hint="photos, reports — optional">
              <input
                type="file"
                multiple
                onChange={(e) => f.setFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line/40"
              />
            </FieldLabel>
            {f.files.length > 0 && (
              <p className="text-[12px] text-grey-2 -mt-2 sm:col-span-2">
                {f.files.length} file{f.files.length > 1 ? "s" : ""} will be attached:{" "}
                {f.files.map((x) => x.name).join(", ")}
              </p>
            )}

            <FieldLabel strong label="Any other remarks" hint="optional">
              <TextArea
                rows={3}
                value={f.form.otherRemarks}
                onChange={(e) => f.set("otherRemarks", e.target.value)}
              />
            </FieldLabel>
          </div>
        </div>
      </Card>
    </div>
  );
}
