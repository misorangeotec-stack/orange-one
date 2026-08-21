import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { useDispatchStore } from "../store";
import { COMPANY_ITEMS_QK, fetchCompanyItems } from "../data/dispatchFetch";
import { DEFAULT_ITEM_TYPE } from "../pages/orders/useSalesOrderForm";
import type { MapCustomerItemResult } from "../data/dispatchWrites";

/** The one normalisation. Must match the store's `mappedItemNames`. */
const norm = (s: string) => s.trim().toUpperCase();

/**
 * MAP A CUSTOMER TO ITEMS — directly, with no approval (OD-9).
 *
 * This is what replaces "request a new item" on the sales order. The item
 * somebody cannot find is almost never missing from Tally; it is merely not
 * mapped to that customer yet, and the person looking at the screen is the one
 * who knows it belongs there. So they do it, and carry on with the order.
 *
 * ⚠ IT DOES NOT READ THE STORE'S ITEM LIST, and that is the whole point.
 *   `useDispatchStore().items` is DERIVED from the mappings that already exist —
 *   1,693 of 14,264 — so an item mapped to nobody is not in it. Filtering that
 *   list by company would answer "not in Tally" about items that are. The book
 *   comes down per company from `fetchCompanyItems` instead.
 *
 * ⚠ ONE COMPANY'S BOOK, WITH NO WAY TO WIDEN. Decided deliberately: Tally files
 *   a stock item in exactly one company book, and 10% of existing order lines
 *   (185 of 1,813) use an item from a different book than the one billing. Those
 *   cases cannot be mapped here and are sent to Central Masters, where the
 *   company filter is optional — so the empty state has to NAME the book the
 *   item actually lives in rather than shrugging.
 */
export default function MapCustomerItemModal({
  open,
  onClose,
  /** Fixed by the order that opened this. Blank lets the user choose. */
  companyId,
  customerId,
  /** Raised from a picker — the text the user had typed into it. */
  initialSearch,
  stacked,
  typePicker,
  onMapped,
}: {
  open: boolean;
  onClose: () => void;
  companyId?: string | null;
  customerId?: string | null;
  initialSearch?: string | null;
  stacked?: boolean;
  /**
   * The shared "What do you need?" field, when this was opened from the Master
   * Requests page rather than from an order.
   *
   * ⚠ IT IS PASSED IN RATHER THAN BUILT HERE because the two modals it switches
   *   between must show the SAME control in the SAME place — otherwise changing
   *   your mind about what you need re-mounts a subtly different form and the
   *   field appears to jump. The page owns the choice; each modal just renders it.
   */
  typePicker?: React.ReactNode;
  /** Fired after the write lands, with the item ids that were mapped. */
  onMapped?: (result: MapCustomerItemResult, itemIds: string[]) => void;
}) {
  const s = useDispatchStore();

  /* The order's choices are FIXED, not defaults. An order has already committed
     to a billing company, and changing it here would map against a book the
     order is not being raised under. Only the standalone entry point picks. */
  const lockedCompany = !!companyId;
  const lockedCustomer = !!customerId;

  const [company, setCompany] = useState(companyId ?? "");
  const [customer, setCustomer] = useState(customerId ?? "");
  /* ONE type at a time, matching the intake form. "" is every type. */
  const [type, setType] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCompany(companyId ?? "");
    setCustomer(customerId ?? "");
    setType("");
    setPicked([]);
    setError(null);
  }, [open, companyId, customerId]);

  /**
   * The company's whole stock book. Its own cache entry, fetched the first time
   * anyone opens this modal for that company and then reused — it must never
   * ride inside the module's catalogue query, which every write invalidates.
   */
  const book = useQuery({
    queryKey: COMPANY_ITEMS_QK(company),
    queryFn: () => fetchCompanyItems(company),
    enabled: open && !!company,
    staleTime: 30 * 60_000,
  });

  /*
    ⚠ EXCLUDE BY NAME, NOT BY ID — this is the difference between the modal
      working and appearing not to.

      `itemsForCustomer` collapses the order's item picker to ONE ROW PER
      PRODUCT NAME, because Tally files the same physical goods as a separate
      stock item in every book that stocks it. So a customer already mapped to
      the Enterprise copy of a name gains nothing from the O-tec copy: excluding
      by id would still offer it, the write would succeed, and the picker would
      look identical afterwards. The user reads that as a button that did
      nothing and clicks it again. 22 name-groups across 18 customers already
      carry such twins.
  */
  const alreadyMapped = s.mappedItemNames(customer);

  const options: MultiOption[] = useMemo(() => {
    const rows = (book.data ?? []).filter((i) => !alreadyMapped.has(norm(i.name)));
    return rows
      .filter((i) => !type || (i.itemType ?? "") === type)
      .map((i) => ({ value: i.id, label: i.code ? `${i.name} · ${i.code}` : i.name }));
  }, [book.data, alreadyMapped, type]);

  /**
   * The type filter offers only what THIS book actually holds — cascading, the
   * same rule every grid follows. A vocabulary of 13 words above a book that
   * uses four is a list of dead ends.
   */
  const typeOptions: ComboOption[] = useMemo(() => {
    const seen = new Set((book.data ?? []).map((i) => i.itemType ?? ""));
    return [...seen]
      .map((t) => ({ value: t, label: t ? itemTypeLabel(t as ItemType) : "Not set" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [book.data]);

  /*
    INK ONCE THE BOOK LANDS, and only once — never again afterwards.

    The default has to wait for the fetch: the options do not exist until the
    company's items arrive. But re-running it on every change of `book.data`
    would stamp Ink back over a type the user had just chosen, so it is armed by
    a ref that fires a single time per opening. Nothing happens if the book holds
    no ink; the field stays on All types rather than jumping somewhere arbitrary.
  */
  const defaulted = useRef(false);
  useEffect(() => { if (!open) defaulted.current = false; }, [open]);
  useEffect(() => {
    if (!open || defaulted.current || book.isLoading || !book.data) return;
    defaulted.current = true;
    if (book.data.some((i) => i.itemType === DEFAULT_ITEM_TYPE)) setType(DEFAULT_ITEM_TYPE);
  }, [open, book.isLoading, book.data]);

  /**
   * WHERE THE ITEM ACTUALLY LIVES, when it is not in this book.
   *
   * The store carries every item any mapping names, across all five books — so
   * for the traded items this is exact, and it turns "no matches" into the one
   * sentence that explains the accepted 10%: the item exists, it is filed
   * elsewhere, and Central Masters is where that pair can be made.
   */
  const elsewhere = useMemo(() => {
    const q = norm(initialSearch ?? "");
    if (!q || !company) return null;
    // ⚠ `i.companyId` must be non-null to say WHERE it lives. A companyless item
    //   is "elsewhere" in the sense that it is not in this book, but naming its
    //   book would print "filed under —", which tells the reader nothing.
    const hit = s.items.find((i) => norm(i.name) === q && !!i.companyId && i.companyId !== company);
    return hit ? { name: hit.name, company: s.masterName("company", hit.companyId) } : null;
  }, [initialSearch, company, s]);

  const companyLabel = company ? s.masterName("company", company) : "";

  const submit = async () => {
    if (!company) { setError("Pick the company first."); return; }
    if (!customer) { setError("Pick the customer."); return; }
    if (picked.length === 0) { setError("Pick at least one item."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await s.mapCustomerItems(customer, company, picked);
      onMapped?.(result, picked);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Map items to a customer"
      /* No "goes to X for approval" line — there is no approval. Say what it
         does instead, so nobody waits for a confirmation that never comes. */
      subtitle="Saved straight away — the items become orderable for this customer immediately."
      stacked={stacked}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || picked.length === 0}>
            {busy ? "Saving…" : picked.length > 1 ? `Map ${picked.length} items` : "Map item"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {typePicker}

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel
            label="Company"
            required
            hint={lockedCompany ? "From the order you are raising." : "Both lists below are this company's own."}
          >
            {lockedCompany ? (
              <div className="rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-navy">
                {companyLabel || "—"}
              </div>
            ) : (
              <Combobox
                value={company}
                onChange={(id) => { setCompany(id); setCustomer(""); setPicked([]); setType(""); defaulted.current = false; }}
                options={s.activeOf(s.companies).map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Select company…"
                searchable
                wrapLabel
              />
            )}
          </FieldLabel>

          <FieldLabel label="Customer" required hint={lockedCustomer ? "From the order you are raising." : undefined}>
            {lockedCustomer ? (
              <div className="rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-navy">
                {s.customerName(customer)}
              </div>
            ) : (
              <Combobox
                value={customer}
                /* A different customer has a different set already mapped, so
                   the selection below cannot survive the change. */
                onChange={(id) => { setCustomer(id); setPicked([]); }}
                options={s.customersForCompany(company).map((c) => ({
                  value: c.id,
                  label: c.name,
                  sublabel: c.location ?? undefined,
                }))}
                placeholder={company ? "Select customer…" : "pick the company first"}
                disabled={!company}
                searchable
                wrapLabel
              />
            )}
          </FieldLabel>
        </div>

        {typeOptions.length > 1 && (
          <FieldLabel label="Item type">
            {/* One type at a time, defaulting to Ink — the same control and the
                same default as the intake form, so the two read as one idea. */}
            <Combobox
              value={type}
              /* Clears the selection: an item ticked under one type would stay
                 selected while invisible under another, and the footer count
                 would name rows the reader can no longer see. */
              onChange={(v) => { setType(v); setPicked([]); }}
              options={typeOptions}
              placeholder="All types"
              disabled={!company || book.isLoading}
              clearable
              searchable={typeOptions.length > 6}
            />
          </FieldLabel>
        )}

        <FieldLabel
          label="Items"
          required
          hint="Pick as many as you like — each becomes one mapping. Anything this customer can already order is left out."
        >
          <MultiSelect
            values={picked}
            onChange={setPicked}
            options={options}
            placeholder={
              !customer ? "Pick a customer first"
                : book.isLoading ? "Loading this company's items…"
                : "Search items…"
            }
            disabled={!customer || book.isLoading}
            searchable
            chips
            /* ⚠ O-tec — Surat is 8,340 items and this list draws one row per
               match with no virtualisation. The cap keeps the dropdown
               responsive and, just as importantly, keeps "Select all" from
               committing the entire book in a single click. */
            maxRender={300}
          />
        </FieldLabel>

        {book.isError && (
          <p className="text-[13px] font-medium text-ryg-red">
            Could not load {companyLabel || "that company"}'s items. Close this and try again.
          </p>
        )}

        {/* The two honest answers to "it isn't in the list", in the order they
            are likely. Neither is an empty dropdown left to be interpreted. */}
        {!book.isLoading && !book.isError && company && elsewhere && (
          <p className="text-[13px] text-yellow">
            “{elsewhere.name}” is filed under <strong>{elsewhere.company}</strong>’s book, not{" "}
            {companyLabel}’s — so it cannot be mapped from here. An admin can map it in
            Central Masters → Customer Items.
          </p>
        )}
        {/*
          ⚠ COVERS BOTH REMAINING CASES, because we cannot tell them apart from
            here. `elsewhere` above searches the items this module already holds
            — every item some mapping names — so it catches the traded ones
            exactly. Beyond that the answer is either "another company's book" or
            "not in Tally", and distinguishing them would cost a query per
            keystroke. Saying both is honest; guessing one would send somebody to
            create an item Tally already has.
        */}
        {!book.isLoading && !book.isError && company && !elsewhere && initialSearch?.trim() && (
          <p className="text-[13px] text-grey-2">
            Can’t find “{initialSearch.trim()}”? Only {companyLabel}’s own items are listed here. If it
            belongs to another company’s book an admin can map it in Central Masters → Customer Items;
            if it is not in Tally at all it has to be created there first.
          </p>
        )}

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
