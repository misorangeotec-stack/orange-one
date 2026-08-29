import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../data/ocpiMasters";
import CustomerPicker from "./CustomerPicker";
import GstinField from "./GstinField";
import RequestMasterModal from "./RequestMasterModal";
import { isVisible } from "../lib/branching";
import { fetchFxRate } from "@/shared/lib/fx";
import {
  COST_BEARERS, CURRENCIES, DOLLAR_CLAUSE, HEAD_SHIP_MODES, HEAD_SHIP_VIA,
  HIGH_SEAS_VIA, INSURANCE_CLAUSE, PAYMENT_TYPES, PLATTER_OPTIONS,
  TRADE_TERMS, TRANSPORT_TERMS, machineFacts,
  type QuotationDraft,
} from "../lib/fieldSpec";
import type { MachineOption, OcpiMasterType } from "../types";

/**
 * Part A — everything the printed quotation needs.
 *
 * The grouping mirrors the printed sheet (Machine Details / Deal Inclusions /
 * Commercial Terms / Remarks), not the Microsoft form's question order, so
 * someone checking a generated PDF against the paper finds the fields where they
 * expect them.
 *
 * ⚠ CONDITIONAL FIELDS ARE HIDDEN, NEVER DISABLED. `isVisible` (lib/branching)
 *   answers what applies; a greyed-out box still reads as a question you failed
 *   to answer. The server clears whatever a branch hides on every write, so the
 *   row can never keep an answer the form stopped showing.
 */

/** A yes/no, as the source form asks them. Null until answered — not false. */
function YesNo({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <FieldLabel label={label} hint={hint}>
      <div className="flex gap-2">
        {[
          { v: true, t: "Yes" },
          { v: false, t: "No" },
        ].map((o) => (
          <button
            key={o.t}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={[
              "h-9 min-w-[72px] rounded-lg border px-3 text-[13px] font-medium transition",
              value === o.v
                ? "border-orange bg-orange text-white"
                : "border-line bg-white text-navy hover:border-orange/50",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            ].join(" ")}
          >
            {o.t}
          </button>
        ))}
      </div>
    </FieldLabel>
  );
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

/**
 * A master list as combobox options, plus whatever this deal already holds.
 *
 * ⚠ THE CURRENT VALUE IS ALWAYS AN OPTION, even when it is not on the list. A
 *   deal quoted last year against a head type since switched off would
 *   otherwise open with the field looking empty, and saving would silently
 *   clear it. Deactivating a master must never rewrite a deal.
 */
const masterOpts = (rows: { name: string; active: boolean }[], current: string) => {
  const live = rows.filter((r) => r.active).map((r) => r.name);
  const all = current && !live.includes(current) ? [...live, current] : live;
  return all.map((x) => ({ value: x, label: x }));
};
const optsKV = (xs: readonly { value: string; label: string }[]) =>
  xs.map((x) => ({ value: x.value, label: x.label }));

/**
 * Say when an extra is standard on this model rather than a choice.
 *
 * "yes" on the machine means the machine always has it, so the question is
 * really "is it in this deal?" — worth saying, because otherwise a salesperson
 * reading four identical yes/no boxes cannot tell which are genuinely optional.
 * Answering it for them would put a value on the deal nobody entered.
 */
const standardHint = (o: MachineOption | null): string | undefined =>
  o === "yes" ? "standard on this machine" : undefined;

/**
 * One item's shipping and invoicing answers.
 *
 * ⚠ ONE COMPONENT, FOUR CALLERS, so the head, the dryer, the spare parts and
 *   the centering device cannot drift apart. They ask the same four questions by
 *   instruction; four hand-written copies would be four places to forget the
 *   "excluding tax" wording, or to add a fifth question to only three of them.
 *
 * ⚠ EVERY BINDING IS PASSED IN EXPLICITLY rather than derived from a key prefix.
 *   A `draft[`${prefix}ShipMode`]` lookup would compile — and would silently
 *   read `undefined` the day somebody renames a field, because TypeScript cannot
 *   check a template-built key. Twenty typed props are worth that.
 *
 * ⚠ VISIBILITY IS DECIDED BY THE CALLER, not here. `branching.ts` owns every
 *   condition in this module and has the SQL's twin beside it; a second opinion
 *   living in a presentational component is how the two engines drift.
 */
function ShipmentRow({
  title,
  why,
  shown,
  disabled,
  mode,
  onMode,
  via,
  onVia,
  showVia,
  inv,
  onInv,
  showInvoiceLines,
  qty,
  onQty,
  amount,
  onAmount,
}: {
  title: string;
  /** Why this row is being asked at all — the branch, in words. */
  why: string;
  shown: boolean;
  disabled?: boolean;
  mode: string;
  onMode: (v: string) => void;
  via: string;
  onVia: (v: string) => void;
  showVia: boolean;
  inv: boolean | null;
  onInv: (v: boolean) => void;
  showInvoiceLines: boolean;
  qty: string;
  onQty: (v: string) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  if (!shown) return null;
  return (
    <div className="space-y-3 rounded-lg border border-line p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="text-[11.5px] text-grey-2">asked because {why}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="How it ships">
          <Combobox
            value={mode}
            onChange={onMode}
            options={optsKV(HEAD_SHIP_MODES)}
            placeholder="Choose"
            clearable
            disabled={disabled}
          />
        </FieldLabel>
        {/* Nothing to route when it travels with the machine. */}
        {showVia && (
          <FieldLabel label="Separate shipment sent via">
            <Combobox
              value={via}
              onChange={onVia}
              options={optsKV(HEAD_SHIP_VIA)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <YesNo label="Separate invoice" value={inv} onChange={onInv} disabled={disabled} />
        {/*
          ⚠ QUANTITY AND AMOUNT ONLY ON A SEPARATE INVOICE. That is the only
            document they would appear on; asking otherwise invites the same
            figure being quoted twice, once inside the deal value and once
            beside it. fms_ocpi_write_oc nulls them on the same condition.
        */}
        {showInvoiceLines && (
          <>
            <FieldLabel label="Quantity">
              <TextInput
                inputMode="numeric"
                value={qty}
                onChange={(e) => onQty(e.target.value.replace(/\D/g, ""))}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Amount" hint="excluding tax">
              <TextInput
                inputMode="decimal"
                value={amount}
                onChange={(e) => onAmount(e.target.value.replace(/[^\d.]/g, ""))}
                disabled={disabled}
              />
            </FieldLabel>
          </>
        )}
      </div>
    </div>
  );
}

export default function QuotationForm({
  draft,
  patch,
  disabled,
}: {
  draft: QuotationDraft;
  patch: (p: Partial<QuotationDraft>) => void;
  disabled?: boolean;
}) {
  const s = useOcpiStore();

  /**
   * The chosen machine, and what it says this deal may be asked.
   *
   * ⚠ THESE FACTS DRIVE THE BRANCHES NOW (OCPI-3, stage E). Whether there is a
   *   dryer section, and which of the four extras appear, comes off the machine
   *   row — the same five columns `fms_ocpi_write_oc` reads to decide what to
   *   keep. Read `machineFacts`' header for why they are a flat record.
   */
  const chosenMachine = s.machineById(draft.machineId || null);
  const facts = useMemo(() => machineFacts(chosenMachine), [chosenMachine]);

  /**
   * The category filter — UI state, never stored.
   *
   * Seeded from the deal's own machine so opening an existing quotation shows
   * the list it was chosen from, and left alone afterwards: the salesperson may
   * legitimately widen it to move the deal to another category.
   */
  const [category, setCategory] = useState<string>("");
  const seededCategory = useRef(false);
  useEffect(() => {
    if (seededCategory.current) return;
    if (!draft.machineId) return;
    const m = s.machineById(draft.machineId);
    if (!m) return; // masters not loaded yet — try again next render
    seededCategory.current = true;
    if (m.categoryId) setCategory(m.categoryId);
  }, [draft.machineId, s]);
  /*
    ⚠ SEEDING IS FOR AN OPENED DEAL, NOT FOR A PICK. `chooseMachine` closes this
      the moment the user chooses anything, so the filter never moves under them.
      Without that, picking a Direct machine on a blank form would snap the
      filter to Direct — and the Sublimation model they meant to compare it with
      would vanish from the list they had just been reading.
  */

  const categoryOptions = useMemo(
    () =>
      s.machineCategories
        .filter((c) => c.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    [s.machineCategories],
  );

  // Only machines an admin has switched on, narrowed to the chosen category. A
  // machine with no template is still quotable and still goes all the way
  // through — it issues the summary sheet alone, and the editor names it before
  // anything is sent.
  //
  // ⚠ THE CURRENT MACHINE IS ALWAYS AN OPTION. Same reasoning as `masterOpts`:
  //   a deal quoted against a model since switched off, or since moved to
  //   another category, must not open with the picker looking empty — saving
  //   would then silently clear it.
  const machineOptions = useMemo(
    () =>
      s.machines
        .filter((m) => m.active || m.id === draft.machineId)
        .filter((m) => !category || m.categoryId === category || m.id === draft.machineId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((m) => ({
          value: m.id,
          label: m.name,
          sublabel:
            [
              m.billingName,
              m.hasTemplate ? null : "summary sheet only — no detailed template yet",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        })),
    [s.machines, category, draft.machineId],
  );

  /** Every print head the chosen machine carries — a model may have several. */
  const mappedHeads = useMemo(
    () => s.headsFor(draft.machineId || null),
    [s, draft.machineId],
  );

  /**
   * Choose a machine, and carry across everything that is the MACHINE's answer.
   *
   * ⚠ ONLY ON AN EXPLICIT CHANGE. Doing this in an effect would rewrite the head
   *   text of a deal quoted before the mapping existed the moment somebody
   *   merely opened it — silently restating what a customer was quoted. See the
   *   Print heads field for the rest of the reasoning.
   *
   * ⚠ THE MODEL NUMBER IS NOT TOUCHED. It is pre-filled from the template
   *   elsewhere and a salesperson may have corrected it by hand.
   */
  const chooseMachine = (id: string) => {
    const m = s.machineById(id || null);
    // The user has taken over; stop the category filter seeding itself. See the
    // note beside `seededCategory`.
    seededCategory.current = true;
    patch({
      machineId: id,
      headType: s.headsFor(id || null).map((h) => h.name).join(" + "),
      // A machine that takes no dryer cannot keep a dryer category, and one
      // that does starts from a clean sheet rather than the previous model's.
      ...(m?.needsDryer === true ? {} : { dryerType: "", dryerName: "" }),
    });
  };

  /**
   * Which of our own companies is selling.
   *
   * ⚠ THIS WAS SET SILENTLY AND SHOWN NOWHERE. `CustomerPicker` copies the Tally
   *   party's company onto the draft, and that value alone decides which bank
   *   account, CIN, registered address and letterhead the contract prints. Two
   *   cases it cannot answer: a NEW LEAD has no Tally party at all, so the field
   *   stayed empty and the default entity printed with no warning (`isFallback`
   *   is false for a null company — correctly, since it cannot know it is
   *   wrong); and a customer who genuinely buys from a different arm than the
   *   one Tally files them under could not be corrected without editing Tally.
   *   So the value is now a visible, editable field that merely DEFAULTS to the
   *   customer's company.
   */
  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });

  /**
   * ⚠ ONLY COMPANIES THAT HAVE A SELLING-ENTITY PROFILE ARE OFFERED.
   *
   *   Tally carries five companies; four of them have no profile, and picking
   *   one used to be allowed with a warning — the document then printed the
   *   DEFAULT entity's bank account, CIN and registered address on a contract
   *   the customer pays against. A warning is the wrong instrument for that:
   *   it is read once and clicked past, and the consequence is money sent to
   *   the wrong company. So the choice is removed rather than annotated, and
   *   Settings → Selling entities is the single place that decides what may
   *   be quoted under. Add the profile there and the company appears here.
   *
   *   The one exception is a company ALREADY on this deal, kept so an existing
   *   draft does not silently lose its entity — it is offered, and labelled as
   *   not set up, so the reader can see what has to change.
   */
  const companyOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [];
    for (const c of masters?.companies ?? []) {
      const own = s.companyProfiles.find((p) => p.companyId === c.id && p.active);
      if (!own) continue;
      opts.push({
        value: c.id,
        label: c.name,
        // Say what this choice will actually print, since that is the whole
        // consequence of the field and it is otherwise invisible until the PDF.
        sublabel:
          [own.legalName, own.bankName, own.exWorksCity && `Ex-Works ${own.exWorksCity}`]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
    }
    if (draft.companyId && !opts.some((o) => o.value === draft.companyId)) {
      const c = masters?.companies.find((x) => x.id === draft.companyId);
      opts.unshift({
        value: draft.companyId,
        label: c?.name ?? "Company no longer listed",
        sublabel: "not set up as a selling entity — choose another, or add its details in Settings",
      });
    }
    return opts;
  }, [masters?.companies, s.companyProfiles, draft.companyId]);

  const defaultEntityName = useMemo(() => {
    const d = s.companyProfiles.find((p) => p.isDefault && p.active);
    return d?.legalName ?? null;
  }, [s.companyProfiles]);

  const salespersonOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of s.deals) if (d.salespersonName) names.add(d.salespersonName);
    if (draft.salespersonName) names.add(draft.salespersonName);
    return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  }, [s.deals, draft.salespersonName]);

  /**
   * A pending "please add this to the list" prompt.
   *
   * ⚠ TYPING A NEW VALUE NEVER BLOCKS THE QUOTATION. The typed text is written
   *   straight onto the draft — these three columns hold TEXT, not a foreign
   *   key — and the modal only offers to add it to the master so the next
   *   person can pick it. Making a salesperson wait for somebody to approve a
   *   vocabulary entry mid-negotiation would be a worse product than the free
   *   text box this replaces.
   *
   *   Machines can be asked for too, but they CANNOT be typed onto the deal —
   *   see the machine picker below. Same modal, different landing.
   */
  const [ask, setAsk] = useState<{ type: OcpiMasterType; name: string } | null>(null);

  /** The machine just asked for, so the still-empty picker does not read as a no-op. */
  const [machineAsked, setMachineAsked] = useState<string | null>(null);

  /**
   * A high seas sale is a dollar deal with no GST, both fixed by the deal type.
   * The currency picker is disabled rather than hidden — a reader still needs to
   * see WHICH currency, and hiding it would make the rule look like a bug.
   */
  const isHighSeas = draft.transportTerms === "high_seas";

  const [fxBusy, setFxBusy] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  /**
   * Pull the live rate.
   *
   * ⚠ A FAILURE MUST NOT BLOCK THE QUOTATION. The field stays editable and the
   *   error is a sentence under it — a hand-typed rate is always a legitimate
   *   answer, and often the correct one, since deals are struck at an agreed rate
   *   rather than at whatever the market says this minute.
   */
  const pullRate = async () => {
    setFxBusy(true);
    setFxError(null);
    try {
      const r = await fetchFxRate("USD", "INR");
      patch({
        fxRate: String(r.rate),
        fxRateSource: r.source,
        fxRateAt: r.fetchedAt,
        fxRateOverridden: false,
      });
    } catch (e) {
      setFxError(
        `${e instanceof Error ? e.message : "Could not fetch a live rate"} — type the rate you agreed instead.`,
      );
    } finally {
      setFxBusy(false);
    }
  };

  /** The rupee equivalent, shown beside the rate so the figure is never a surprise. */
  const inrEquivalent = useMemo(() => {
    const amt = Number(draft.dealValueAmount);
    const rate = Number(draft.fxRate);
    if (!Number.isFinite(amt) || !Number.isFinite(rate) || !draft.dealValueAmount || !draft.fxRate) {
      return null;
    }
    return `₹${Math.round(amt * rate).toLocaleString("en-IN")}`;
  }, [draft.dealValueAmount, draft.fxRate]);

  /**
   * The dryer models inside the chosen category.
   *
   * `dryerType` is the category's NAME on the deal (a text column, frozen with
   * the quotation); the master is keyed by id, so the name is looked up here.
   * A category the deal holds but the master no longer lists simply yields an
   * empty list — and the value already on the deal is still offered below.
   */
  const dryerOptions = useMemo(() => {
    const typeId = s.dryerTypes.find((t) => t.name === draft.dryerType)?.id ?? null;
    const live = s.dryersFor(typeId).map((d) => d.name);
    const all =
      draft.dryerName && !live.includes(draft.dryerName) ? [...live, draft.dryerName] : live;
    return all.map((x) => ({ value: x, label: x }));
  }, [s, draft.dryerType, draft.dryerName]);

  const show = (k: keyof QuotationDraft) => isVisible(k, draft, facts);

  /** Can this machine carry ANY extra? If not, the whole block goes. */
  const anyExtra =
    show("airBlade") || show("externalCentering") ||
    show("inkDustExhauster") || show("chillingSystem");

  /**
   * Does this deal ship ANYTHING on its own terms? If not, the whole card goes.
   *
   * An empty "Shipment & invoice" heading over nothing would read as a section
   * that failed to load. A deal with no head, no dryer, no spares and a machine
   * that takes no centering device genuinely has nothing to answer here.
   */
  const anyShipment =
    show("headShipMode") || show("dryerShipMode") ||
    show("sparesShipMode") || show("centeringShipMode");

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Customer</h2>
        <CustomerPicker draft={draft} patch={patch} disabled={disabled} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Contact person (Attn)">
            <TextInput
              value={draft.customerAttn}
              onChange={(e) => patch({ customerAttn: e.target.value })}
              placeholder="Who the quotation is addressed to"
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Mobile">
            <TextInput
              value={draft.customerMobile}
              onChange={(e) => patch({ customerMobile: e.target.value })}
              placeholder="10 digits"
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Address">
          <TextArea
            rows={2}
            value={draft.customerAddress}
            onChange={(e) => patch({ customerAddress: e.target.value })}
            placeholder="Printed on the quotation under To,"
            disabled={disabled}
          />
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Email">
            <TextInput
              type="email"
              value={draft.customerEmail}
              onChange={(e) => patch({ customerEmail: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <YesNo
            label="GST registered"
            value={draft.gstAvailable}
            onChange={(v) => patch({ gstAvailable: v })}
            disabled={disabled}
          />
        </div>

        {show("gstNo") && <GstinField draft={draft} patch={patch} disabled={disabled} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel label="Selling entity" hint="whose bank account this prints">
              <Combobox
                value={draft.companyId}
                onChange={(v) => patch({ companyId: v })}
                options={companyOptions}
                placeholder="Which of our companies is selling"
                searchable
                clearable
                disabled={disabled}
              />
            </FieldLabel>
            {/* ⚠ BLANK IS A LEGITIMATE ANSWER and is NOT marked required, because
                Tally leaves ~10 of 1,888 customers with no company at all and the
                default row exists precisely to cover them (see store.tsx
                `profileStatusFor`). What blank must not be is SILENT — it decides
                a bank account. So it names the entity it will fall back to. */}
            {!draft.companyId && defaultEntityName && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Left blank, this prints <b className="text-navy">{defaultEntityName}</b>.
              </p>
            )}
          </div>
          <FieldLabel label="Salesperson" required>
            <Combobox
              value={draft.salespersonName}
              onChange={(v) => patch({ salespersonName: v })}
              options={salespersonOptions}
              placeholder="Who owns this deal"
              searchable
              clearable
              disabled={disabled}
              onCreate={(label) => {
                patch({ salespersonName: label });
                return label;
              }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Machine details <span className="text-[12px] font-normal text-grey-2">· section A</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          {/*
            ⚠ THE CATEGORY IS A FILTER, NOT AN ANSWER. It is deliberately NOT on
              the draft and not on the deal: the machine already carries its own
              category, so storing a second copy would let the two disagree the
              day somebody re-categorises a model. It exists to cut a 28-model
              list down to a readable one, and it is seeded FROM the chosen
              machine when an existing deal is opened.

            ⚠ CLEARING IT SHOWS EVERY MACHINE, which is the only way to reach the
              two models that have no category yet (Label Printer and Book
              Printer — their sheet column says "JAY", which nobody has explained,
              so no category was invented for them).
          */}
          <FieldLabel label="Machine category" hint="narrows the list below">
            <Combobox
              value={category}
              onChange={(v) => {
                setCategory(v);
                // A machine outside the new category would leave the picker
                // showing a value that is not in its own list. Clear it rather
                // than leave that contradiction on screen.
                if (v && draft.machineId && s.machineById(draft.machineId)?.categoryId !== v) {
                  chooseMachine("");
                }
              }}
              options={categoryOptions}
              placeholder="All categories"
              searchable
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          <div>
            <FieldLabel label="Machine" required>
              <Combobox
                value={draft.machineId}
                onChange={chooseMachine}
                options={machineOptions}
                placeholder={machineOptions.length ? "Choose the model" : "Nothing set up yet — ask for one"}
                searchable
                clearable
                disabled={disabled}
                onCreate={(label) => {
                  // ⚠ UNLIKE ink / dryer, THIS DOES NOT PUT THE TYPED NAME ON
                  //   THE DEAL. Those are text columns, so the typed value IS
                  //   the answer. A deal points at a machine BY ID, and no id exists
                  //   until somebody approves the request — so the field stays empty
                  //   on purpose. Returning nothing is the Combobox's own "asked for,
                  //   not chosen"; the note below says so, because an empty picker
                  //   otherwise reads as nothing having happened.
                  setAsk({ type: "machine", name: label });
                }}
                createLabel={(q) => `Ask for “${q}”`}
              />
            </FieldLabel>
            {machineAsked && !draft.machineId && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Asked for <b className="text-navy">“{machineAsked}”</b> — pick it here once it
                is approved. Save this as a draft meanwhile.
              </p>
            )}
            {chosenMachine?.billingName && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Bills as <b className="text-navy">{chosenMachine.billingName}</b>
              </p>
            )}
          </div>

          {/*
            ⚠ SHOWN, NOT CHOSEN (OCPI-3, stage E). The print head used to be a
              free-text picker on the deal. It is a property of the model — one
              machine may carry SEVERAL heads — so it is read off the Machine
              master and displayed. Picking a machine copies the joined names
              onto `headType`, which is still the text column both papers and the
              register print from; nothing downstream changed.

            ⚠ THE COPY HAPPENS IN `chooseMachine`, NEVER IN AN EFFECT. An effect
              would overwrite the head text on a deal quoted before the mapping
              existed, the moment somebody merely opened it — rewriting a signed
              contract's record by loading a page. Only an explicit change of
              machine rewrites it.

            ⚠ A HEAD TYPE CAN STILL BE REQUESTED — from Master requests, whose
              modal offers every master type. Removing the picker removed the
              shortcut, not the route.
          */}
          <FieldLabel
            label="Print heads"
            hint={mappedHeads.length > 1 ? "all heads this model carries" : "from the machine master"}
          >
            <div className="min-h-9 rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-navy">
              {mappedHeads.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {mappedHeads.map((h) => (
                    <span
                      key={h.id}
                      className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px]"
                    >
                      {h.name}
                    </span>
                  ))}
                </span>
              ) : draft.headType ? (
                // A deal quoted before the mapping existed. Show what it holds
                // rather than an empty box that reads as "no head".
                <span title="recorded on this deal; not mapped on the machine">{draft.headType}</span>
              ) : (
                <span className="text-grey-2">
                  {draft.machineId ? "No print head mapped to this machine" : "Choose a machine first"}
                </span>
              )}
            </div>
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="No. of machines" required>
            <TextInput
              inputMode="numeric"
              value={draft.machineCount}
              onChange={(e) => patch({ machineCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="No. of print heads required">
            <TextInput
              inputMode="numeric"
              value={draft.headCount}
              onChange={(e) => patch({ headCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Type of ink">
            <Combobox
              value={draft.inkType}
              onChange={(v) => patch({ inkType: v })}
              options={masterOpts(s.inkTypes, draft.inkType)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(label) => {
                // Non-blocking: the typed value is KEPT on the deal, and the
                // list is asked to grow so the next person can pick it.
                patch({ inkType: label });
                setAsk({ type: "ink_type", name: label });
                return label;
              }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
          {/*
            ⚠ PLATTER MOVED HERE FROM THE DRYER BLOCK (OCPI-3, stage E), and it
              is the one field in this stage NOBODY ASKED ABOUT — it appears in
              no pointer and nowhere in the work list, so its home is still an
              open question with the client.

              It was moved rather than left because the two engines disagreed
              about it: the form only showed it when the deal had a dryer, while
              `fms_ocpi_write_oc` stores `platter_details` UNCONDITIONALLY. The
              form was the stricter of the two, so a machine with no dryer could
              never record a platter the database was perfectly willing to keep.
              Machine details is where the SQL already assumes it lives, and
              "Not Applicable" is one of its own options. If the client says it
              belongs to the dryer, gate it in BOTH places.
          */}
          <FieldLabel label="Platter">
            <Combobox
              value={draft.platterDetails}
              onChange={(v) => patch({ platterDetails: v })}
              options={opts(PLATTER_OPTIONS)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Ink selling price" hint="free text — “N/A” is a real answer">
            <TextInput
              value={draft.inkPrice}
              onChange={(e) => patch({ inkPrice: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Ink credit terms (future)">
            <TextInput
              value={draft.inkCreditTerms}
              onChange={(e) => patch({ inkCreditTerms: e.target.value })}
              placeholder="e.g. 30"
              disabled={disabled}
            />
          </FieldLabel>
        </div>
      </Card>

      {/*
        ── Dryer details ────────────────────────────────────────────────────────

        ⚠ THE WHOLE CARD IS THE MACHINE'S DECISION, not the salesperson's. It
          appears only when the chosen model's `needs_dryer` flag is true — 11 of
          the 28 machines. `fms_ocpi_write_oc` reads the same flag off the same
          column and nulls every one of these fields when it is not set, so the
          two must never drift apart.

        ⚠ THE EXTRAS ARE NOT IN HERE, and that is not an oversight. P8S needs no
          dryer and can still take a chilling system, so anything nested inside
          this card would be unreachable for it. They have their own card below,
          gated per machine capability.
      */}
      {show("dryerType") && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Dryer details</h2>
            <p className="mt-1 text-[12.5px] text-grey">
              Asked because <b className="text-navy">{chosenMachine?.name}</b> takes a dryer. No
              warranty is offered on a dryer.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Dryer category">
              <Combobox
                value={draft.dryerType}
                onChange={(v) =>
                  // Changing the category orphans the model inside the old one.
                  patch({ dryerType: v, dryerName: "" })
                }
                options={masterOpts(s.dryerTypes, draft.dryerType)}
                placeholder="Choose or type"
                searchable
                clearable
                disabled={disabled}
                onCreate={(label) => {
                  // Non-blocking: the typed value is KEPT on the deal, and the
                  // list is asked to grow so the next person can pick it.
                  patch({ dryerType: label, dryerName: "" });
                  setAsk({ type: "dryer_type", name: label });
                  return label;
                }}
                createLabel={(q) => `Use “${q}”`}
              />
            </FieldLabel>
            <FieldLabel
              label="Dryer"
              hint={draft.dryerType ? undefined : "choose a category first"}
            >
              <Combobox
                value={draft.dryerName}
                onChange={(v) => patch({ dryerName: v })}
                options={dryerOptions}
                placeholder={
                  !draft.dryerType
                    ? "Choose a category first"
                    : dryerOptions.length
                      ? "Choose the model"
                      : "None set up in this category"
                }
                searchable
                clearable
                disabled={disabled || !draft.dryerType}
              />
            </FieldLabel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="How many chambers with the dryer">
              <TextInput
                value={draft.dryerChambers}
                onChange={(e) => patch({ dryerChambers: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Heating medium">
              <TextInput
                value={draft.heatingMode}
                onChange={(e) => patch({ heatingMode: e.target.value })}
                placeholder="e.g. electric, gas, thermic fluid"
                disabled={disabled}
              />
            </FieldLabel>
          </div>

          {/*
            ⚠ THE PRICE IS ASKED ONLY WHEN THE DRYER IS *NOT* IN THE DEAL. It is
              a separate charge; a dryer that is part of the deal is already
              inside the deal value, and asking again invites it being counted
              twice. `dryer_price` deliberately does NOT feed `total_inr` —
              whether it attracts GST is still unanswered by the client — so the
              papers carry it as its own line (stage I).
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <YesNo
              label="Dryer included in the deal"
              value={draft.dryerIncluded}
              onChange={(v) => patch({ dryerIncluded: v })}
              disabled={disabled}
            />
            {show("dryerPrice") && (
              <FieldLabel label="Dryer price (excl. GST)" hint="charged separately">
                <TextInput
                  inputMode="decimal"
                  value={draft.dryerPrice}
                  onChange={(e) => patch({ dryerPrice: e.target.value.replace(/[^\d.]/g, "") })}
                  disabled={disabled}
                />
              </FieldLabel>
            )}
          </div>
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Deal inclusions <span className="text-[12px] font-normal text-grey-2">· section B</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes ink"
            value={draft.inclInk}
            onChange={(v) => patch({ inclInk: v })}
            disabled={disabled}
          />
          {show("inkQtyIncluded") && (
            <FieldLabel label="Quantity of ink included">
              <TextInput
                value={draft.inkQtyIncluded}
                onChange={(e) => patch({ inkQtyIncluded: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes spare parts"
            value={draft.inclSpares}
            onChange={(v) => patch({ inclSpares: v })}
            disabled={disabled}
          />
          {show("spareDetails") && (
            <FieldLabel label="Spare part details and quantity" hint="item name & quantity">
              <TextInput
                value={draft.spareDetails}
                onChange={(e) => patch({ spareDetails: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes head"
            value={draft.inclHead}
            onChange={(v) => patch({ inclHead: v })}
            disabled={disabled}
          />
          {show("headsIncluded") && (
            <FieldLabel label="No. of heads included">
              <TextInput
                inputMode="numeric"
                value={draft.headsIncluded}
                onChange={(e) => patch({ headsIncluded: e.target.value.replace(/\D/g, "") })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>
      </Card>

      {/*
        ── Shipment & invoice ─────────────────────────────────────────────────

        ⚠ ONE SECTION, NOT FOUR SCATTERED ONES (OCPI-3, stage F). "The head" used
          to sit near the bottom of Document details with three questions; the
          centering device had none anywhere. The client asked for the head, the
          dryer, the spare parts and the centering device to be asked the SAME
          four things in ONE place — so a reader can see, in one glance, what
          leaves the factory separately and what is billed separately.

        ⚠ EACH ROW APPEARS ON ITS OWN CONDITION, and they are not the same one.
          Two are the machine's answer rather than the salesperson's; the list is
          written out in branching.ts beside the rules. Every rule here has its
          twin in fms_ocpi_write_oc, which nulls what it hides on every save.

        ⚠ AMOUNTS ARE EXCLUSIVE OF TAX, by instruction, and every row says so.
          They are stored and printed as given; nothing here is added to
          `total_inr`, which is derived server-side from the deal value alone.
      */}
      {anyShipment && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Shipment &amp; invoice</h2>
            <p className="mt-0.5 text-[12.5px] text-grey">
              How each part of the deal travels, and whether it is billed on its own. Only the parts
              this deal actually carries are listed.
            </p>
          </div>

          <ShipmentRow
            title="Print head"
            why="the deal includes a head"
            shown={show("headShipMode")}
            disabled={disabled}
            mode={draft.headShipMode}
            onMode={(v) => patch({ headShipMode: v })}
            via={draft.headShipVia}
            onVia={(v) => patch({ headShipVia: v })}
            showVia={show("headShipVia")}
            inv={draft.headSeparateInvoice}
            onInv={(v) => patch({ headSeparateInvoice: v })}
            showInvoiceLines={show("headInvoiceQty")}
            qty={draft.headInvoiceQty}
            onQty={(v) => patch({ headInvoiceQty: v })}
            amount={draft.headInvoiceAmount}
            onAmount={(v) => patch({ headInvoiceAmount: v })}
          />

          <ShipmentRow
            title="Dryer"
            why={`${chosenMachine?.name ?? "this machine"} takes a dryer`}
            shown={show("dryerShipMode")}
            disabled={disabled}
            mode={draft.dryerShipMode}
            onMode={(v) => patch({ dryerShipMode: v })}
            via={draft.dryerShipVia}
            onVia={(v) => patch({ dryerShipVia: v })}
            showVia={show("dryerShipVia")}
            inv={draft.dryerSeparateInvoice}
            onInv={(v) => patch({ dryerSeparateInvoice: v })}
            showInvoiceLines={show("dryerInvoiceQty")}
            qty={draft.dryerInvoiceQty}
            onQty={(v) => patch({ dryerInvoiceQty: v })}
            amount={draft.dryerInvoiceAmount}
            onAmount={(v) => patch({ dryerInvoiceAmount: v })}
          />

          <ShipmentRow
            title="Spare parts"
            why="the deal includes spare parts"
            shown={show("sparesShipMode")}
            disabled={disabled}
            mode={draft.sparesShipMode}
            onMode={(v) => patch({ sparesShipMode: v })}
            via={draft.sparesShipVia}
            onVia={(v) => patch({ sparesShipVia: v })}
            showVia={show("sparesShipVia")}
            inv={draft.sparesSeparateInvoice}
            onInv={(v) => patch({ sparesSeparateInvoice: v })}
            showInvoiceLines={show("sparesInvoiceQty")}
            qty={draft.sparesInvoiceQty}
            onQty={(v) => patch({ sparesInvoiceQty: v })}
            amount={draft.sparesInvoiceAmount}
            onAmount={(v) => patch({ sparesInvoiceAmount: v })}
          />

          {/*
            ⚠ THIS IS NOT THE "External centering system" TICK in Options
              included. The client asked for the two to stay separate: that tick
              records whether the deal INCLUDES one, this row records how it
              SHIPS and how it is BILLED. Both read the machine's
              `opt_external_centering` capability, so a machine mapped "no" shows
              neither — 5 of the 28 machines can take one.
          */}
          <ShipmentRow
            title="Centering device"
            why={`${chosenMachine?.name ?? "this machine"} can take one`}
            shown={show("centeringShipMode")}
            disabled={disabled}
            mode={draft.centeringShipMode}
            onMode={(v) => patch({ centeringShipMode: v })}
            via={draft.centeringShipVia}
            onVia={(v) => patch({ centeringShipVia: v })}
            showVia={show("centeringShipVia")}
            inv={draft.centeringSeparateInvoice}
            onInv={(v) => patch({ centeringSeparateInvoice: v })}
            showInvoiceLines={show("centeringInvoiceQty")}
            qty={draft.centeringInvoiceQty}
            onQty={(v) => patch({ centeringInvoiceQty: v })}
            amount={draft.centeringInvoiceAmount}
            onAmount={(v) => patch({ centeringInvoiceAmount: v })}
          />
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Commercial terms <span className="text-[12px] font-normal text-grey-2">· section C</span>
        </h2>

        {/*
          ⚠ THE DEAL TYPE LEADS THE SECTION, because everything commercial follows
            from it: High Seas is always a dollar deal and carries NO GST; Others
            is taxed. It is the SAME `transport_terms` column the module has
            always had — relabelled, not replaced, so every existing row and every
            frozen version still reads correctly.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Deal type" required>
            <Combobox
              value={draft.transportTerms}
              onChange={(v) =>
                // ⚠ PICKING HIGH SEAS SETS THE CURRENCY HERE, NOT ONLY ON SAVE.
                //   fms_ocpi_write_quotation already forces USD server-side, but
                //   it only runs on save — so the draft kept saying "INR", the
                //   currency box sat greyed out reading rupees under a note
                //   promising dollars, and the FX block never appeared. That left
                //   no way to enter a rate on the one deal type that is ALWAYS in
                //   dollars, and a rate-less USD deal prints a blank total on both
                //   papers. Setting it here makes the screen tell the truth
                //   immediately; the server still has the last word.
                patch(
                  v === "high_seas"
                    ? { transportTerms: v, dealValueCurrency: "USD" }
                    : { transportTerms: v },
                )
              }
              options={optsKV(TRANSPORT_TERMS)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          {show("highSeasVia") && (
            <FieldLabel label="High seas delivery via">
              <Combobox
                value={draft.highSeasVia}
                onChange={(v) => patch({ highSeasVia: v })}
                options={opts(HIGH_SEAS_VIA)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
          {show("highSeasCostBy") && (
            <FieldLabel label="High seas cost borne by">
              <Combobox
                value={draft.highSeasCostBy}
                onChange={(v) => patch({ highSeasCostBy: v })}
                options={optsKV(COST_BEARERS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
          {show("localCostBy") && (
            <FieldLabel
              label="Local delivery cost borne by"
              hint="transport, clearance, loading / unloading"
            >
              <Combobox
                value={draft.localCostBy}
                onChange={(v) => patch({ localCostBy: v })}
                options={optsKV(COST_BEARERS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        {isHighSeas && (
          <p className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2 text-[12.5px] text-grey">
            A high seas sale is in <span className="font-medium text-navy">US dollars</span> and carries{" "}
            <span className="font-medium text-navy">no GST</span>. Both are set for you, and the papers
            print no tax line at all.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel label="Currency" required hint={isHighSeas ? "fixed by the deal type" : undefined}>
            <Combobox
              value={draft.dealValueCurrency}
              onChange={(v) => patch({ dealValueCurrency: v })}
              options={opts(CURRENCIES)}
              disabled={disabled || isHighSeas}
            />
          </FieldLabel>
          <div className={show("gstRate") ? undefined : "sm:col-span-2"}>
            <FieldLabel label="Total deal value (excluding GST)" required>
              <TextInput
                inputMode="decimal"
                value={draft.dealValueAmount}
                onChange={(e) => patch({ dealValueAmount: e.target.value.replace(/[^\d.]/g, "") })}
                placeholder="Figures only"
                disabled={disabled}
              />
            </FieldLabel>
          </div>
          {/*
            ⚠ GST % MOVED HERE (OCPI-3, stage G) AND WAS VERY NEARLY LOST. It sat
              inside the "Delivery & tax" block, which the client asked to be
              deleted — the instruction was about the delivery term, and the tax
              rate merely happened to share the box. Deleting the block wholesale
              would have broken nothing visibly: every deal would simply have been
              taxed at the 18% default for ever, with no way to change it and no
              error to notice.

              It belongs beside the value it completes: the field above is
              labelled "excluding GST", and this is the rate that finishes the
              sentence. Hidden on a high seas sale — no GST applies, so there is
              no rate to ask for, and the server stores NULL rather than 0.
          */}
          {show("gstRate") && (
            <FieldLabel label="GST %">
              <TextInput
                value={draft.gstRate}
                onChange={(e) => patch({ gstRate: e.target.value.replace(/[^\d.]/g, "") })}
                inputMode="decimal"
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        {/*
          ⚠ THE RATE IS A STARTING POINT, NEVER A LOCK. Deals are negotiated at an
            agreed rate; showing the live one instead would misstate the contract.
            Whichever rate is used is frozen onto the revision when the quotation
            is generated, so a paper keeps the arithmetic it was issued under.
        */}
        {show("fxRate") && (
          <div className="space-y-2 rounded-lg border border-line bg-[#FBFCFE] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[9rem]">
                <FieldLabel label="USD → INR rate">
                  <TextInput
                    inputMode="decimal"
                    value={draft.fxRate}
                    onChange={(e) =>
                      patch({
                        fxRate: e.target.value.replace(/[^\d.]/g, ""),
                        fxRateOverridden: true,
                        fxRateSource: "manual",
                        fxRateAt: new Date().toISOString(),
                      })
                    }
                    placeholder="e.g. 87.4250"
                    disabled={disabled}
                  />
                </FieldLabel>
              </div>
              <Button variant="outline" size="sm" onClick={pullRate} disabled={disabled || fxBusy}>
                {fxBusy ? "Fetching…" : "Get live rate"}
              </Button>
              {inrEquivalent && (
                <p className="pb-2 text-[13px] text-grey">
                  ≈ <span className="font-semibold text-navy">{inrEquivalent}</span>
                </p>
              )}
            </div>
            <p className="text-[12px] text-grey-2">
              {fxError
                ? fxError
                : draft.fxRate
                  ? draft.fxRateOverridden
                    ? "Entered by hand. This is the rate the papers will use."
                    : `Live rate from ${draft.fxRateSource || "the FX service"}${draft.fxRateAt ? ` · ${new Date(draft.fxRateAt).toLocaleString()}` : ""}. Type over it to use the rate you agreed.`
                  : "Fetch the live rate, or type the rate you agreed with the customer."}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Type of payment">
            <Combobox
              value={draft.paymentType}
              onChange={(v) => patch({ paymentType: v })}
              options={optsKV(PAYMENT_TYPES)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Machine delivery date" hint="tentative, committed to the customer">
            <TextInput
              type="date"
              value={draft.deliveryDate}
              onChange={(e) => patch({ deliveryDate: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        {/*
          ── Delivery, moved up from "Delivery & tax" (OCPI-3, stage G) ─────────

          Both fields sit beside the delivery DATE above, which is what they are
          about. The block they came from is gone.

          ⚠ THE DELIVERY TERM STAYS — SETTLED WITH THE CLIENT, 29-Aug-2026, and
            recorded here because the instruction that came first said the
            opposite. It was originally to be removed, on the reasoning that the
            route is "already covered in commercial terms". Checking that turned
            up why it is not:

              · `{{trade_term}}` is written into the SALE CONDITIONS OF THE
                SUPPLY clause of ALL TEN machine templates, as "Delivery Terms:
                {{trade_term}}". An unresolved token prints a ruled blank by
                design, so removing the field would have printed "Delivery Terms:
                ________" on every detailed sheet.

              · It is the ONLY delivery route an ordinary deal records anywhere.
                Commercial terms asks "delivered via" on a HIGH SEAS deal alone,
                so an "Others" deal answers nothing else about the route — and 11
                of the 12 ordinary deals on record had filled this in.

              · The two papers were never saying the same thing anyway. The
                SUMMARY sheet's "Term of Delivery" is built from the deal type
                and who bears the cost ("Local Delivery · cost by Customer"); the
                CONTRACT's "Delivery Terms" is this field ("Ex-Work Surat"). Two
                different facts under two similar headings, on two papers.

            Do not remove this without re-reading the above. Stage J.2 is closed
            as "no change", not as "not done yet".
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Delivery days" hint="prints on the detailed sheet">
            <TextInput
              value={draft.deliveryDays}
              onChange={(e) => patch({ deliveryDays: e.target.value })}
              placeholder="e.g. 45-60 days"
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Delivery term" hint="prints on the contract">
            <Combobox
              value={draft.tradeTerm}
              onChange={(v) => patch({ tradeTerm: v })}
              options={opts(TRADE_TERMS)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Terms of payment">
          <TextArea
            rows={2}
            value={draft.paymentTerms}
            onChange={(e) => patch({ paymentTerms: e.target.value })}
            placeholder="e.g. 25% advance, 75% before delivery"
            disabled={disabled}
          />
        </FieldLabel>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Special remarks <span className="text-[12px] font-normal text-grey-2">· section D</span>
        </h2>

        {/*
          ⚠ ONE BOX (OCPI-3, stage H). It was three: the master form scattered its
            free text across Q23 (balance heads), Q43 (other commitments) and Q46
            (remarks) under three unrelated headings, and the revision gathered
            them into one section. The client has now removed the other two
            outright — there is ONE place a note goes, and it is this one.

            Their COLUMNS remain, additive-only, and any deal that already holds
            text still shows it below and still prints it. Nothing new can be
            entered into either.

          ⚠ AND IT PRINTS ON THE SUMMARY SHEET ONLY. The hint here used to say
            "prints on both sheets" and that was simply false: there is no
            remarks path in ocPdf.ts and no `{{remarks}}` token, so no machine
            template can reference it either. A salesperson writing a delivery
            caveat here, believing it reached the contract, would have been
            wrong.
        */}
        <FieldLabel label="Special remarks" hint="prints on the summary sheet">
          <TextArea
            rows={5}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
            placeholder={"One point per line, e.g.\n1. Installation within 15 days of dispatch\n2. Warranty on the dryer: 6 months, by exception"}
            disabled={disabled}
          />
        </FieldLabel>
        <p className="-mt-2 text-[12px] text-grey-2">
          Enter remarks <b className="text-navy">point by point, one to a line</b> — line breaks come
          through onto the paper exactly as typed. Anything that differs from the standard terms goes
          here, including a warranty exception.
        </p>

        {/*
          ⚠ RETIRED BOXES, SHOWN READ-ONLY WHEN THEY HOLD SOMETHING. 13 of the 18
            deals on record carry balance-head remarks and 14 carry other
            commitments. Deleting the inputs outright would leave that text
            printing on a regenerated paper with no trace of it anywhere on the
            screen — a salesperson would find a line on the contract they could
            not locate in the form. So the value stays visible, is labelled as
            retired, and says where to put it instead.

            A deal with nothing in them shows nothing at all, which is every new
            quotation from here on.
        */}
        {(draft.headBalanceRemarks.trim() || draft.otherCommitments.trim()) && (
          <div className="space-y-2 rounded-lg border border-line bg-[#FBFCFE] px-3 py-2.5">
            <p className="text-[12px] text-grey-2">
              These two boxes have been <b className="text-navy">retired</b>. What this deal already
              recorded is kept and still prints; to change any of it, write the new wording into
              Special remarks above.
            </p>
            {draft.headBalanceRemarks.trim() && (
              <div>
                <div className="text-[11.5px] font-medium text-ink">
                  Balance heads to be sold later
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] text-grey">
                  {draft.headBalanceRemarks}
                </p>
              </div>
            )}
            {draft.otherCommitments.trim() && (
              <div>
                <div className="text-[11.5px] font-medium text-ink">Any other commitments</div>
                <p className="whitespace-pre-wrap text-[12.5px] text-grey">
                  {draft.otherCommitments}
                </p>
              </div>
            )}
          </div>
        )}

        {/*
          ⚠ A DOLLAR TERM, ASKED ONLY OF DOLLAR DEALS. It used to be asked on
            every quotation, including rupee ones it cannot apply to — and the
            answer printed. `fms_ocpi_write_quotation` clears it on a non-USD
            deal, so switching currency cannot leave a stale "Yes" behind.
        */}
        {show("dollarClauseAgreed") && (
          <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
            <p className="text-[12.5px] leading-relaxed text-grey">{DOLLAR_CLAUSE}</p>
            <div className="mt-2">
              <YesNo
                label="Agreed with the customer"
                value={draft.dollarClauseAgreed}
                onChange={(v) => patch({ dollarClauseAgreed: v })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </Card>

      {/*
        ═══ THE DETAILED SHEET'S OWN QUESTIONS ═══════════════════════════════
        Everything below was a SECOND FORM until the revision: the order
        confirmation was filled in later, at its own step, from its own screen.
        The client asked for one form, so it lives here.

        ⚠ EVERY FIELD BELOW IS OPTIONAL, DELIBERATELY. A quotation goes out
          during a negotiation, often before the warranty and delivery terms are
          settled. Anything left blank prints as a ruled blank on the detailed
          sheet, and the editor names those lines before the salesperson sends
          anything — see `missingForDetailSheet`. None of it blocks.
      */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Document details</h2>
          <p className="mt-0.5 text-[12.5px] text-grey">
            Only the detailed sheet needs these. Leave any of them blank for now — the sheet prints a
            ruled blank, and you will be told which lines are empty before you send it.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">Warranty &amp; service</h3>
          {/*
            ⚠ THE WARRANTY IS NO LONGER ASKED. It is fixed company policy — set in
              Settings → Warranty periods — and prints from there. The two pickers
              that stood here (printer warranty, print-head warranty) and the
              "Head price after the warranty" box are gone with it.

              Their COLUMNS remain, and the module is additive-only, so every deal
              raised before this keeps what it recorded. Nothing reads them now:
              the tokens resolve from the setting instead (lib/tokens.ts).

              If a deal genuinely needs a different warranty, it goes in Special
              remarks — that is the whole of the exception route, by instruction.
          */}
          <div className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2.5">
            <p className="text-[12.5px] leading-relaxed text-grey">
              Warranty is fixed for every deal:{" "}
              <b className="text-navy">{s.config.warranty.machineMonths} months</b> on the machine and{" "}
              <b className="text-navy">{s.config.warranty.headMonths} months</b> on the print head. No
              warranty is offered on the dryer or on spare parts.
            </p>
            <p className="mt-1 text-[12px] text-grey-2">
              If this deal needs something different, write it into Special remarks above.
            </p>
          </div>

          {/*
            ⚠ "Head price after the warranty" IS GONE (OCPI-3, stage J.1), and it
              went in the right ORDER, which was the whole difficulty.

              `{{post_warranty_head_price}}` was written into the PRINT HEAD
              POLICY PROGRAM clause of four machines — Homer K24, Homer K32, P8D
              and P8S — as "a New Print Head will be priced at INR {{…}} plus
              GST". An unresolved token renders as a ruled blank by design, so
              deleting this field first would have printed "priced at INR
              ________ plus GST" on every contract for those machines.

              The clause was reworded first (migration
              20261021150000, client-approved 29-Aug-2026) to "replacement print
              heads will be supplied at the prices prevailing at the time of
              purchase" — a sentence that needs no figure. Zero templates use the
              token now; verified before this field was removed.

              The COLUMN stays, additive-only, so deals raised before this keep
              what they recorded. Nothing reads it.
          */}
          <FieldLabel label="Consumables to be bought from">
            <TextInput
              value={draft.consumablesSupplier}
              onChange={(e) => patch({ consumablesSupplier: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
            <p className="text-[12.5px] leading-relaxed text-grey">{INSURANCE_CLAUSE}</p>
            <div className="mt-2">
              <YesNo
                label="Agreed with the customer"
                value={draft.insuranceClauseAgreed}
                onChange={(v) => patch({ insuranceClauseAgreed: v })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        {/*
          ⚠ THE "Delivery & tax" BLOCK IS GONE (OCPI-3, stage G). It held THREE
            controls and every one of them was accounted for before it went —
            the client's instruction named only the first:

              · Delivery term  → MOVED to Commercial terms. Asked to be removed;
                                 cannot go until stage J corrects the clause on
                                 all ten templates. Kept, labelled, reachable.
              · Delivery days  → MOVED to Commercial terms, beside the delivery
                                 date. Explicitly asked for by the client.
              · GST %          → MOVED to Commercial terms, beside the deal value
                                 it completes. NOT mentioned in any instruction;
                                 it merely shared the box. Deleting it with the
                                 block would have taxed every deal at the 18%
                                 default for ever with no way to change it — and
                                 nothing would have looked broken.

            That last one is why this comment exists. "Most of this is redundant"
            is not a finding about the rest of it; see the FIX-4 rule in
            CLAUDE.md, which this block is now an example of going right.
        */}

        {/*
          ⚠ "The head" BLOCK IS GONE FROM HERE (OCPI-3, stage F), moved rather
            than deleted. Its three questions — how to ship, the route, separate
            invoice — now sit in the **Shipment & invoice** card above, beside
            the dryer, the spare parts and the centering device, which ask the
            same things. Two questions were ADDED to each while moving:
            quantity and amount excluding tax, asked only of a separate invoice.

            Nothing was stranded: `headBalanceRemarks` was never in this block
            (it lives with Special remarks, and stage H decides its fate), and
            `HEAD_SHIP_MODES` / `HEAD_SHIP_VIA` are now read by all four rows.
        */}

        {/*
          ── Options included ───────────────────────────────────────────────────

          ⚠ EACH EXTRA IS ASKED ONLY IF THE MACHINE CAN CARRY IT (OCPI-3, stage
            E). All four used to be asked of every deal; the client's sheet maps
            them per model — "no", "optional" or "yes" — and only 7 of the 28
            machines can take any of them at all. "yes" still asks, because it
            means STANDARD EQUIPMENT and the deal has to record that it is
            included; the hint says so rather than answering for the salesperson.

          ⚠ THIS BLOCK IS NOT INSIDE THE DRYER CARD, deliberately. P8S needs no
            dryer and can still take a chilling system, so nesting the extras
            under the dryer would make that machine's one extra unreachable.

          ⚠ THE "External centering system" TICK IS NOT THE CENTERING DEVICE'S
            SHIPMENT QUESTIONS. The client asked for them to stay separate; both
            read the same `opt_external_centering` capability, and the shipment
            block arrives in stage F.
        */}
        {anyExtra && (
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="text-[13px] font-semibold text-ink">Options included</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {show("airBlade") && (
                <YesNo
                  label="Air blade"
                  hint={standardHint(facts.optAirBlade)}
                  value={draft.airBlade}
                  onChange={(v) => patch({ airBlade: v })}
                  disabled={disabled}
                />
              )}
              {show("externalCentering") && (
                <YesNo
                  label="External centering system"
                  hint={standardHint(facts.optExternalCentering)}
                  value={draft.externalCentering}
                  onChange={(v) => patch({ externalCentering: v })}
                  disabled={disabled}
                />
              )}
              {show("inkDustExhauster") && (
                <YesNo
                  label="Ink dust exhauster"
                  hint={standardHint(facts.optInkDustExhauster)}
                  value={draft.inkDustExhauster}
                  onChange={(v) => patch({ inkDustExhauster: v })}
                  disabled={disabled}
                />
              )}
              {show("chillingSystem") && (
                <YesNo
                  label="Chilling system"
                  hint={standardHint(facts.optChillingSystem)}
                  value={draft.chillingSystem}
                  onChange={(v) => patch({ chillingSystem: v })}
                  disabled={disabled}
                />
              )}
            </div>
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Sign-off</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Reference no." hint="the customer's own reference, if they have one">
              <TextInput
                value={draft.refNo}
                onChange={(e) => patch({ refNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Manufacturer's model no." hint="pre-filled from the machine's template">
              <TextInput
                value={draft.machineModelNo}
                onChange={(e) => patch({ machineModelNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Prepared by">
              <TextInput
                value={draft.preparedBy}
                onChange={(e) => patch({ preparedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Approved by">
              <TextInput
                value={draft.approvedBy}
                onChange={(e) => patch({ approvedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          </div>
        </div>
      </Card>
      <RequestMasterModal
        open={!!ask}
        onClose={() => setAsk(null)}
        masterType={ask?.type ?? null}
        lockType
        prefillName={ask?.name}
        stacked
        onRequested={(type, name) => {
          if (type === "machine") setMachineAsked(name);
        }}
      />

    </div>
  );
}
