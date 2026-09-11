import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import type { MapPartyCompanyResult } from "../data/dispatchWrites";

/**
 * THE ONE NORMALISATION, AND IT MUST MATCH THE SQL CHARACTER FOR CHARACTER.
 *
 * `mst_refresh_party_companies()` decides two ledgers are the same firm with
 *   upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
 * and this screen's whole argument is "that firm is already in another book".
 * A weaker reading here — the item modal's `trim().toUpperCase()`, say — would
 * call "A.N. CREATIONS" and "A N CREATIONS" different firms while the database
 * treats them as one, so the sibling offer would go missing on exactly the rows
 * the table has already linked.
 */
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * MAP A CUSTOMER TO THE COMPANIES THAT MAY BILL THEM (OD-5).
 *
 * The twin of MapCustomerItemModal, opened from the Customer picker when the
 * firm somebody is looking for is not in the billing company's book. It is
 * almost never missing from Tally — of 1,354 distinct customer names, 412 exist
 * in more than one book — so the answer is a mapping, not a new ledger.
 *
 * ⚠ IT DOES NOT USE `customersForCompany`, AND THAT IS THE WHOLE POINT. That
 *   selector is narrowed to the chosen book, which is precisely the wall the
 *   user has just hit. It reads `s.customers` instead — every customer ledger in
 *   every book, 1,917 of them, already in memory. NOTE THE ASYMMETRY WITH THE
 *   ITEM MODAL: that one needs its own fetch because `s.items` is derived from
 *   existing mappings and genuinely incomplete. `s.customers` is not derived —
 *   `dispatchFetch` pulls every `is_customer` row with no company filter — so
 *   there is nothing here to fetch and no loading state to design.
 *
 * ⚠ IT LEADS WITH THE SIBLING, and that is not a nicety — it is what makes the
 *   database change underneath it defensible. When this gate was widened once
 *   before (20260921120000) it was reverted within the hour, because of the 46
 *   pairs it newly allowed, 44 had a ledger of the same firm sitting in the
 *   billing book already: the right action was to pick THAT row, and widening
 *   blindly would have legalised 44 mis-bookings. Offering the sibling first is
 *   how those 44 are routed to the right answer before a mapping is ever
 *   written. Do not demote it to a hint below the form.
 */
export default function MapCustomerCompanyModal({
  open,
  onClose,
  /** The order's billing company. Arrives pre-ticked; never the only choice. */
  companyId,
  /** Fixed when re-opened on a known customer. Blank lets the user search. */
  customerId,
  /** Raised from a picker — the text the user had typed into it. */
  initialSearch,
  stacked,
  /** Fired after the write lands, with the customer and companies mapped. */
  onMapped,
  /**
   * Switch the order's billing company to the sibling's book instead of mapping
   * anything. Omit it and that button simply does not appear.
   */
  onSwitchCompany,
}: {
  open: boolean;
  onClose: () => void;
  companyId?: string | null;
  customerId?: string | null;
  initialSearch?: string | null;
  stacked?: boolean;
  onMapped?: (result: MapPartyCompanyResult, customerId: string, companyIds: string[]) => void;
  onSwitchCompany?: (companyId: string) => void;
}) {
  const s = useDispatchStore();
  const lockedCustomer = !!customerId;

  const [customer, setCustomer] = useState(customerId ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = (initialSearch ?? "").trim();
  const companyLabel = s.masterName("company", companyId ?? null);

  /**
   * WHAT THE TYPED NAME ALREADY MATCHES, ANYWHERE IN TALLY.
   *
   * Split three ways, because the three want different answers and lumping them
   * together is how a screen ends up telling somebody to map a row that is
   * already there:
   *
   *   · `here`     a ledger in the billing company's OWN book that the picker
   *                did not show — which can only mean it is switched OFF.
   *                Mapping would not help; the row has to be switched back on.
   *   · `siblings` ledgers of the same firm in OTHER books. The usual case, and
   *                the one worth leading with.
   *   · neither    genuinely not in Tally under that name.
   */
  const matches = useMemo(() => {
    const q = norm(typed);
    if (!q || !open) return { here: null as null | { id: string; name: string }, siblings: [] as { id: string; name: string; companyId: string | null }[] };
    const hits = s.customers.filter((c) => norm(c.name) === q);
    const here = hits.find((c) => c.companyId === companyId && !c.active);
    return {
      here: here ? { id: here.id, name: here.name } : null,
      siblings: hits
        .filter((c) => c.active && c.companyId && c.companyId !== companyId)
        .map((c) => ({ id: c.id, name: c.name, companyId: c.companyId })),
    };
  }, [typed, open, companyId, s.customers]);

  /**
   * The one sibling worth offering a one-click switch to.
   *
   * ⚠ ONLY IF THE PERSON MAY ACTUALLY BILL FROM THAT BOOK. `assignedCompanies`
   *   is what the Billing company picker offers, and Combobox renders
   *   `options.find(o => o.value === value)?.label ?? placeholder` — so setting a
   *   company that is not in their list would leave the field looking EMPTY
   *   while state held it, and the order would fail validation with nothing on
   *   screen to explain why. When they are not assigned, the sibling is still
   *   named below; only the button goes.
   */
  const switchTo = useMemo(() => {
    if (!onSwitchCompany || matches.siblings.length !== 1) return null;
    const sib = matches.siblings[0]!;
    const assignable = s.assignedCompanies().some((c) => c.id === sib.companyId);
    return assignable ? sib : null;
  }, [onSwitchCompany, matches.siblings, s]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    /*
      PRE-SELECT ON AN UNAMBIGUOUS MATCH, rather than seeding a search box —
      Combobox keeps its query in internal state and takes no prop for it, so
      there is nothing to seed. One sibling means there is nothing to choose
      between and re-typing the name would be busywork. Four ANUPAMs mean the
      opposite: picking for them would be a coin toss, so the list is left open
      with the books spelled out beside each name.
    */
    const chosen = customerId
      ? customerId
      : matches.siblings.length === 1 ? matches.siblings[0]!.id : "";
    setCustomer(chosen);
    /* ⚠ TICKED ON OPEN, NOT AFTER THE CUSTOMER IS CHOSEN. The order already
       names the company — that is where this modal was opened from — so the
       form should show it decided rather than ask for it again. */
    setPicked(companyId ? [companyId] : []);
    // `matches` is derived from the props in this list; adding it would reset
    // the user's own choice on every keystroke upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId, customerId]);

  /** Every customer ledger, every book — see the note at the top of the file. */
  const customerOptions = useMemo(
    () =>
      s.activeOf(s.customers).map((c) => ({
        value: c.id,
        label: c.name,
        /*
          THE BOOK IS THE ONLY THING THAT TELLS THEM APART. "ANUPAM" is four
          rows carrying the identical name; without this the list is four
          indistinguishable lines and picking one is a coin toss.
        */
        sublabel: c.companyId
          ? s.masterName("company", c.companyId)
          : "no Tally book — any company may bill",
      })),
    [s],
  );

  /**
   * The books this customer is not already billable from.
   *
   * ⚠ THEIR OWN LEDGER'S BOOK IS EXCLUDED, not merely pre-ticked. `company_id`
   *   already permits it at the guard, so a row here would be a second way to
   *   say the same thing — and the RPC would come back "skipped", which reads
   *   as the button having done nothing.
   */
  const companyOptions: MultiOption[] = useMemo(() => {
    /* Before a customer is chosen there is nothing to exclude, so every active
       company is offered and the order's own arrives ticked. Choosing one then
       narrows this to the books that are not already theirs. */
    const own = customer ? s.customers.find((c) => c.id === customer)?.companyId ?? null : null;
    const already = new Set(
      customer
        ? s.customerCompanies.filter((m) => m.active && m.customerId === customer).map((m) => m.companyId)
        : [],
    );
    return s
      .activeOf(s.companies)
      .filter((c) => c.id !== own && !already.has(c.id))
      .map((c) => ({ value: c.id, label: c.name }));
  }, [s, customer]);

  /*
    ⚠ KEEP THE SELECTION INSIDE THE OPTIONS. Changing the customer changes which
      books are already theirs, and a picked id that is no longer offered would
      sit in state invisibly and be sent to the RPC, which would refuse it or
      skip it with nothing on screen to explain either.
  */
  useEffect(() => {
    const ok = new Set(companyOptions.map((o) => o.value));
    setPicked((prev) => (prev.every((id) => ok.has(id)) ? prev : prev.filter((id) => ok.has(id))));
  }, [companyOptions]);

  const submit = async () => {
    if (!customer) { setError("Pick the customer."); return; }
    if (picked.length === 0) { setError("Pick at least one company."); return; }
    setBusy(true); setError(null);
    try {
      const result = await s.mapPartyCompanies(customer, picked);
      onMapped?.(result, customer, picked);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Map a customer to a billing company"
      stacked={stacked}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !customer || picked.length === 0}>
            {busy ? "Saving…" : picked.length > 1 ? `Map to ${picked.length} companies` : "Map customer"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/*
          ⚠ THE SIBLING OFFER COMES FIRST, ABOVE THE FORM, and it is one line.
            44 of the 46 cross-book pairs the earlier attempt at this newly
            allowed already had a ledger in the billing book, and the right
            action for every one of them was to use that row instead. Below the
            form it would read as a footnote to a decision already taken.
        */}
        {matches.here && (
          <p className="text-[13px] text-yellow">
            <strong>{matches.here.name}</strong> is in {companyLabel}’s book already but switched off.
            Mapping will not help — ask an admin to switch it back on.
          </p>
        )}

        {!matches.here && matches.siblings.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] text-navy">
              {matches.siblings.length === 1 ? (
                <>
                  Already in <strong>{s.masterName("company", matches.siblings[0]!.companyId)}</strong>’s
                  book, not {companyLabel}’s.
                </>
              ) : (
                /* A list cannot take the possessive the singular form uses —
                   "A, B and C’s book" reads as one book belonging to C. */
                <>
                  Already in{" "}
                  <strong>
                    {matches.siblings.map((x) => s.masterName("company", x.companyId)).join(", ")}
                  </strong>
                  {" "}— not in {companyLabel}.
                </>
              )}
            </p>
            {switchTo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { onSwitchCompany?.(switchTo.companyId!); onClose(); }}
                disabled={busy}
              >
                Bill from {s.masterName("company", switchTo.companyId)} instead
              </Button>
            )}
          </div>
        )}

        {!matches.here && matches.siblings.length === 0 && typed && (
          <p className="text-[13px] text-grey-2">
            No ledger called “{typed}” in any book. Pick the right one below, or create it in Tally.
          </p>
        )}

        {/*
          ⚠ COMPANY FIRST, AND TICKED BEFORE ANYTHING IS CHOSEN. The order has
            already named the company; asking for it again after the customer
            made the one thing the user had already decided look undecided, and
            left this control greyed out at the moment they opened the form.
        */}
        <FieldLabel label="May be billed by" required>
          <MultiSelect
            values={picked}
            onChange={setPicked}
            options={companyOptions}
            placeholder={companyOptions.length === 0 ? "already billable by every company" : "Select companies…"}
            disabled={companyOptions.length === 0}
            searchable
            chips
          />
        </FieldLabel>

        <FieldLabel label="Customer" required>
          {lockedCustomer ? (
            <div className="rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-navy">
              {s.customerName(customer)}
            </div>
          ) : (
            <Combobox
              value={customer}
              onChange={(id) => setCustomer(id)}
              options={customerOptions}
              placeholder="Search every company’s customers…"
              searchable
              wrapLabel
            />
          )}
        </FieldLabel>

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
