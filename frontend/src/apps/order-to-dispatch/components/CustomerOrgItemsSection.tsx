import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { TextInput } from "@/shared/components/ui/Form";
import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { useDispatchStore } from "../store";
import { COMPANY_ITEMS_QK, fetchCompanyItems } from "../data/dispatchFetch";
import { fetchOrgItems, orgItemsQueryKey, type OrgItemRow } from "../data/customerOrgs";

/** The one normalisation. Must match `MapCustomerItemModal`'s. */
const norm = (s: string) => s.trim().toUpperCase();

/**
 * The bucket an UNCLASSIFIED item falls in.
 *
 * `item_type` is nullable and plenty of live rows carry null, so the filter needs
 * a value to stand for them — a chip that cannot be clicked would leave those
 * items unreachable by type, which is the one thing this filter exists to fix.
 * Sentinel rather than "" so it cannot collide with a real type key.
 */
const NO_TYPE = "__none__";

const typeLabel = (t: string | null | undefined): string =>
  !t || t === NO_TYPE ? "Unclassified" : itemTypeLabel(t as ItemType) || "Unclassified";

export interface OrgItemEdits {
  add: string[];
  remove: string[];
}

export const NO_ITEM_EDITS: OrgItemEdits = { add: [], remove: [] };

/** One line as the reader sees it: a product, and the books that can supply it. */
interface NameRow {
  key: string;
  name: string;
  code: string | null;
  /** Every stock-item id behind this name. Removal takes them all. */
  itemIds: string[];
  /** Company ids of the ticked LEDGERS carrying it — the books that can supply it. */
  bookIds: string[];
  /**
   * Every item type behind this name, `NO_TYPE` for the unclassified ones.
   *
   * ⚠ A LIST, NOT ONE VALUE, for the same reason `bookIds` is. One row is one
   *   NAME and a name can be several stock items across books; nothing makes two
   *   books agree on how they classified the same physical goods. Storing the
   *   first one found would file a row under a type and hide it from the chip
   *   that actually matches its twin.
   */
  itemTypes: string[];
  isNew: boolean;
}

/**
 * WHAT THIS CUSTOMER MAY ORDER — inside the form that creates them (OD-14).
 *
 * Setup could tick a customer's ledgers, name who is told and create their login,
 * and then not give them a single thing to order. Only 817 of 7,948 active
 * ledgers carry any row in `mst_party_items`, so a brand-new customer lands on
 * zero, the save refuses ("their order screen would be empty") and the admin has
 * to go and do it again in Central Masters. This is that trip, removed.
 *
 * ⚠ BUFFERED, NOT APPLIED. Both modals hold the edits and write them in their own
 *   `save()`. The Add form has no org and no ledgers saved yet, so applying on
 *   click would map items to a customer that may never be created; and on the
 *   Edit form it would mean Cancel did not cancel. The section is therefore
 *   controlled — it owns no truth, only a proposal.
 *
 * ⚠ ONE ROW PER NAME, BECAUSE THAT IS WHAT THE COUNT BESIDE IT MEANS. The grid's
 *   "Items they can order" comes from the server as `count(distinct i.name)`, and
 *   the customer's own picker is `distinct on (i.name)`. Listing one row per
 *   MAPPING instead reads 90 where the grid says 81, and the admin has no way to
 *   tell which number is lying. Tally files the same physical goods as a separate
 *   stock item in every book that stocks it, so the gap is entirely twins.
 *
 * ⚠ EXCLUDE BY NAME, NOT BY ID, in the picker, for the same reason. A customer
 *   already mapped to the Enterprise copy of a name gains nothing from the O-tec
 *   copy: excluding by id would still offer it, the write would succeed, the list
 *   would look identical, and the admin would click it again. The same trap is
 *   written up at length in `MapCustomerItemModal`.
 *
 * ⚠ THE BOOK COUNTS ARE PER LEDGER, NOT PER ITEM. "Enterprise — Surat · 25" means
 *   that book can supply 25 of this customer's items, which is exactly what their
 *   own picker will offer once they choose it. Counting by the item's OWN
 *   `company_id` instead would file a cross-book mapping under a book that cannot
 *   actually bill it.
 *
 * ⚠ THE BOOKS LOAD ONLY WHEN THE PICKER IS OPENED. O-tec — Surat alone is 8,340
 *   items and a customer can be ticked into three books at once. Pulling ~12,000
 *   rows every time somebody opens a customer to change a phone number would make
 *   the dialog feel broken. They share `COMPANY_ITEMS_QK` with the mapping modal,
 *   so the second screen to want a book pays nothing.
 */
export default function CustomerOrgItemsSection({
  partyIds,
  edits,
  onChange,
}: {
  partyIds: string[];
  edits: OrgItemEdits;
  onChange: (next: OrgItemEdits) => void;
}) {
  const s = useDispatchStore();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  /**
   * Which books the list is narrowed to. EMPTY MEANS ALL, not none — the same
   * convention every filter in this app uses, and the reason the chips need no
   * separate "show everything" control.
   */
  const [bookFilter, setBookFilter] = useState<string[]>([]);
  /**
   * Which item types the list is narrowed to. EMPTY MEANS ALL, exactly as the
   * book filter above.
   *
   * ⚠ THIS ONE ALSO NARROWS "Add items", AND THE BOOK CHIPS DO NOT. That looks
   *   inconsistent and is the whole point of the control: the job it was added for
   *   is "put every ink on this customer and nothing else", which is a question
   *   about the PICKER, not about the list of what they already have. The book is
   *   already in every picker option's label, so narrowing by it there would only
   *   re-state what the reader can see; the type is not written anywhere on the
   *   option, so without this there is no way to reach "all the inks" at all.
   */
  const [typeFilter, setTypeFilter] = useState<string[]>([]);

  /** Ticked ledger → its book, and the book list itself. */
  const { books, bookOfParty } = useMemo(() => {
    const ofParty = new Map<string, string>();
    const seen = new Map<string, string>();
    s.customers
      .filter((c) => partyIds.includes(c.id) && c.companyId)
      .forEach((c) => {
        ofParty.set(c.id, c.companyId as string);
        seen.set(c.companyId as string, s.masterName("company", c.companyId));
      });
    return {
      books: [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      bookOfParty: ofParty,
    };
  }, [partyIds, s]);

  const mapped = useQuery({
    queryKey: orgItemsQueryKey(partyIds),
    queryFn: () => fetchOrgItems(partyIds),
    enabled: partyIds.length > 0,
    staleTime: 30_000,
  });

  /*
    One query per book, through the SAME cache entry the mapping modal uses.
    Turned on by opening the picker and left on afterwards, so the names of the
    items just added do not vanish from the list when the picker closes.
  */
  const wantBooks = picking || edits.add.length > 0;
  const bookQueries = useQueries({
    queries: books.map((b) => ({
      queryKey: COMPANY_ITEMS_QK(b.id),
      queryFn: () => fetchCompanyItems(b.id),
      enabled: wantBooks,
      staleTime: 30 * 60_000,
    })),
  });
  const booksLoading = wantBooks && bookQueries.some((q) => q.isLoading);

  /** Every item in every ticked book, by id, tagged with the book it came from. */
  const bookItems = useMemo(() => {
    const out = new Map<string, OrgItemRow>();
    bookQueries.forEach((q, i) => {
      const book = books[i];
      if (!book) return;
      (q.data ?? []).forEach((it) =>
        out.set(it.id, {
          partyId: "",
          itemId: it.id,
          itemName: it.name,
          itemCode: it.code,
          itemType: it.itemType,
          companyId: book.id,
        }),
      );
    });
    return out;
  }, [bookQueries, books]);

  const removeSet = useMemo(() => new Set(edits.remove), [edits.remove]);
  const addSet = useMemo(() => new Set(edits.add), [edits.add]);

  /** What the customer would be able to order if this were saved now, by name. */
  const rows = useMemo(() => {
    const by = new Map<string, NameRow>();
    const push = (
      name: string,
      code: string | null,
      itemId: string,
      bookId: string | null,
      itemType: string | null,
      isNew: boolean,
    ) => {
      const key = norm(name);
      if (!key) return;
      let r = by.get(key);
      if (!r) {
        r = { key, name, code, itemIds: [], bookIds: [], itemTypes: [], isNew };
        by.set(key, r);
      }
      if (!r.itemIds.includes(itemId)) r.itemIds.push(itemId);
      if (bookId && !r.bookIds.includes(bookId)) r.bookIds.push(bookId);
      const t = itemType || NO_TYPE;
      if (!r.itemTypes.includes(t)) r.itemTypes.push(t);
      // A name is only "new" if nothing already mapped carries it.
      r.isNew = r.isNew && isNew;
      if (!r.code && code) r.code = code;
    };

    (mapped.data ?? []).forEach((m) => {
      if (removeSet.has(m.itemId)) return;
      push(m.itemName, m.itemCode, m.itemId, bookOfParty.get(m.partyId) ?? null, m.itemType, false);
    });
    edits.add.forEach((id) => {
      const it = bookItems.get(id);
      if (it) push(it.itemName, it.itemCode, it.itemId, it.companyId, it.itemType, true);
    });

    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [mapped.data, removeSet, edits.add, bookItems, bookOfParty]);

  const takenNames = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);

  /**
   * The type chips on offer — the union of what the MAPPED list and the ticked
   * BOOKS actually carry, never the full thirteen.
   *
   * ⚠ IT HAS TO INCLUDE THE BOOKS, not just `rows`, and that is the difference
   *   between this and the same idea in `SalesOrderFields`. There the list is what
   *   the customer already holds; here the filter's main job is to reach items
   *   they do NOT hold yet, so a type present only in the picker still needs its
   *   chip. Before the books load there is nothing to add anyway, so the list
   *   simply grows when they arrive.
   */
  const types = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach((r) => r.itemTypes.forEach((t) => seen.add(t)));
    if (wantBooks) bookItems.forEach((it) => seen.add(it.itemType || NO_TYPE));
    return [...seen]
      .map((value) => ({ value, label: typeLabel(value) }))
      /* Unclassified last: it is a residue, not a category, and it is the one
         bucket nobody is ever looking for on purpose. */
      .sort((a, b) =>
        a.value === NO_TYPE ? 1 : b.value === NO_TYPE ? -1 : a.label.localeCompare(b.label),
      );
  }, [rows, bookItems, wantBooks]);

  const options: MultiOption[] = useMemo(() => {
    const out: MultiOption[] = [];
    bookQueries.forEach((q, i) => {
      const book = books[i];
      if (!book) return;
      (q.data ?? []).forEach((it) => {
        if (takenNames.has(norm(it.name))) return;
        if (typeFilter.length && !typeFilter.includes(it.itemType || NO_TYPE)) return;
        out.push({
          value: it.id,
          // The book is in the label because it is where the item will land, and
          // the admin is not asked for it anywhere else.
          label: `${it.code ? `${it.name} · ${it.code}` : it.name} — ${book.name}`,
        });
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [bookQueries, books, takenNames, typeFilter]);

  const shown = useMemo(() => {
    const q = norm(search);
    return rows.filter((r) => {
      if (bookFilter.length && !r.bookIds.some((b) => bookFilter.includes(b))) return false;
      if (typeFilter.length && !r.itemTypes.some((t) => typeFilter.includes(t))) return false;
      if (!q) return true;
      return r.key.includes(q) || norm(r.code ?? "").includes(q);
    });
  }, [rows, search, bookFilter, typeFilter]);

  const toggleBook = (id: string) =>
    setBookFilter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const toggleType = (t: string) =>
    setTypeFilter((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const filtering = bookFilter.length > 0 || typeFilter.length > 0 || !!search.trim();

  /**
   * Removing takes the NAME away, across every ticked ledger and both books.
   *
   * The alternative — per book, so a customer could keep buying cleaner from
   * O-tec but not Enterprise — is real but rare, and it is what Central Masters →
   * Customer Items is for. Here the × sits beside one line that reads as one
   * product, and "they can no longer order this" is the only thing it can
   * honestly mean.
   */
  const drop = (r: NameRow) => {
    const stillAdded = edits.add.filter((id) => !r.itemIds.includes(id));
    const alreadyMapped = r.itemIds.filter((id) => !addSet.has(id));
    onChange({ add: stillAdded, remove: [...edits.remove, ...alreadyMapped] });
  };

  /**
   * Clear the list in one press — "take it all off and I will add back the four
   * they actually buy", which by hand is eighty-odd clicks on the ×.
   *
   * ⚠ IT DROPS WHAT IS ON SCREEN, NOT WHAT EXISTS, and the label says which. With
   *   a filter on, "remove all" meaning "also the ones I filtered away" is a
   *   destructive surprise that the buffered save would carry out without ever
   *   showing the reader what went. `shown` is the honest subject: the button
   *   reads "Remove all 81" with nothing narrowed and "Remove these 12" when it
   *   is, so the number in the label is always the number that goes.
   *
   * Buffered like every other edit here — nothing is written until the dialog
   * saves, so Cancel still cancels.
   */
  const dropAll = () => {
    const ids = new Set(shown.flatMap((r) => r.itemIds));
    onChange({
      add: edits.add.filter((id) => !ids.has(id)),
      remove: [...edits.remove, ...[...ids].filter((id) => !addSet.has(id))],
    });
  };

  if (partyIds.length === 0) {
    return (
      <Section count={null}>
        <p className="text-[12.5px] text-grey-2">
          Tick their ledgers above and their item list appears here.
        </p>
      </Section>
    );
  }

  return (
    <Section count={rows.length} showing={filtering ? shown.length : null}>
      {/*
        THE CHIPS ARE THE BOOK FILTER, and they multi-select: tick one, tick
        several, or leave them all off to see everything. Nothing is hidden from
        the reader by default, which is why there is no separate "all" chip — the
        off state IS all, the same convention every other filter here follows.

        ⚠ AN ITEM CAN SIT UNDER TWO CHIPS AT ONCE. A name mapped on two ledgers is
          one row with two books, so the per-chip counts deliberately add up to
          more than the total. Filtering keeps a row if ANY of its books is
          selected, which is what "show me what Noida can supply" means.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {books.map((b) => {
          const n = rows.filter((r) => r.bookIds.includes(b.id)).length;
          const on = bookFilter.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleBook(b.id)}
              className={`rounded-full border px-2 py-0.5 text-[11.5px] transition ${
                on
                  ? "border-orange bg-orange/10 font-semibold text-orange"
                  : n === 0
                    ? "border-ryg-red/40 text-ryg-red hover:border-ryg-red"
                    : "border-line text-grey hover:border-grey-2"
              }`}
              title={
                on
                  ? `Showing only ${b.name} — click to stop filtering by it`
                  : n === 0
                    ? `${b.name} cannot supply this customer anything yet`
                    : `${b.name} can supply ${n} of their items — click to show only these`
              }
            >
              {b.name} · {n}
            </button>
          );
        })}
        {bookFilter.length > 0 && (
          <button
            type="button"
            onClick={() => setBookFilter([])}
            className="text-[11.5px] text-grey-2 underline hover:text-ink"
          >
            Show all books
          </button>
        )}
      </div>

      {/*
        THE TYPE CHIPS, on their own row and reading the same way as the books:
        multi-select, off means all.

        ⚠ THE COUNT ON A CHIP IS OF THE MAPPED LIST, not of the books behind it.
          A chip can therefore read · 0 while still being worth pressing — that is
          a type this customer has none of YET, which is precisely the state
          somebody bulk-adding a type is in. The title text says so rather than
          leaving a zero looking like a dead control.
      */}
      {types.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {types.map((t) => {
            const n = rows.filter((r) => r.itemTypes.includes(t.value)).length;
            const on = typeFilter.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleType(t.value)}
                className={`rounded-full border px-2 py-0.5 text-[11.5px] transition ${
                  on
                    ? "border-navy bg-navy/10 font-semibold text-navy"
                    : "border-line text-grey hover:border-grey-2"
                }`}
                title={
                  on
                    ? `Showing only ${t.label} — click to stop filtering by it`
                    : n === 0
                      ? `They have no ${t.label} yet — click to add from this type`
                      : `They can order ${n} ${t.label} — click to show only these`
                }
              >
                {t.label} · {n}
              </button>
            );
          })}
          {typeFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter([])}
              className="text-[11.5px] text-grey-2 underline hover:text-ink"
            >
              Show all types
            </button>
          )}
        </div>
      )}

      {mapped.isLoading ? (
        <p className="text-[12.5px] text-grey-2">Loading their list…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] text-ryg-red">
          Nothing mapped yet — their order screen would be empty, and this customer cannot be
          switched on until at least one item is here.
        </p>
      ) : (
        <>
          {rows.length > 12 && (
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search their ${rows.length} items…`}
            />
          )}
          <div className="max-h-[220px] overflow-y-auto rounded-lg border border-line">
            {shown.length === 0 ? (
              /*
                ⚠ THE LIST STAYS, AND SO DO THE CHIPS. Swapping in a full-width
                  empty state here would take away the very controls that caused
                  the emptiness — including the one chip the reader has to click
                  again to get back. Same rule the grids follow.
              */
              <p className="px-3 py-3 text-[12.5px] text-grey-2">
                {search.trim() ? <>Nothing matches “{search.trim()}”</> : <>Nothing in what you picked</>}
                {(bookFilter.length > 0 || typeFilter.length > 0) && (
                  <>
                    {" — "}
                    <button
                      type="button"
                      onClick={() => {
                        setBookFilter([]);
                        setTypeFilter([]);
                      }}
                      className="underline hover:text-ink"
                    >
                      clear the filters
                    </button>
                  </>
                )}
                .
              </p>
            ) : (
              shown.map((r) => (
                <div
                  key={r.key}
                  className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-ink" title={r.name}>
                    {r.name}
                    {r.code && <span className="text-grey-2"> · {r.code}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-grey-2">
                    {r.bookIds.map((id) => s.masterName("company", id)).sort().join(", ")}
                  </span>
                  {r.isNew && <span className="shrink-0 text-[11px] font-semibold text-ryg-green">new</span>}
                  <button
                    type="button"
                    onClick={() => drop(r)}
                    className="shrink-0 rounded px-1.5 text-[15px] leading-none text-grey-2 hover:bg-page hover:text-ryg-red"
                    aria-label={`Remove ${r.name}`}
                    title={`Remove ${r.name}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {picking ? (
        <div className="space-y-2">
          <MultiSelect
            values={edits.add}
            onChange={(v) => onChange({ add: v, remove: edits.remove })}
            options={options}
            placeholder={
              booksLoading
                ? "Loading their books…"
                : typeFilter.length
                  ? `Search their books — ${typeFilter.map((t) => typeLabel(t)).join(", ")} only…`
                  : "Search every item in their books…"
            }
            disabled={booksLoading}
            searchable
            chips
            /* O-tec — Surat is 8,340 items and this list draws one row per match
               with no virtualisation. The cap keeps the dropdown responsive and,
               as much to the point, keeps "Select all" from committing an entire
               Tally book in one click. */
            maxRender={300}
          />
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Done adding</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>Add items</Button>
          {/*
            Hidden when there is nothing to take off, so an empty list offers a
            button that would do nothing. The count is `shown`, matching what
            `dropAll` actually removes — see the note on it.
          */}
          {shown.length > 0 && (
            <button
              type="button"
              onClick={dropAll}
              className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-grey-2 transition hover:border-ryg-red hover:text-ryg-red"
              title={
                filtering
                  ? "Take the items you are looking at off this customer's list"
                  : "Take every item off this customer's list"
              }
            >
              {/* "Clear all" matches the ledger dropdown's own wording, so the two
                  bulk controls on this dialog read the same way. It still says
                  "these" under a filter, because that is what it does. */}
              {filtering ? `Clear these ${shown.length}` : `Clear all ${shown.length}`}
            </button>
          )}
        </div>
      )}

      {(edits.add.length > 0 || edits.remove.length > 0) && (
        <p className="text-[11.5px] text-grey-2">
          {[
            edits.add.length > 0 ? `${edits.add.length} to add` : null,
            edits.remove.length > 0 ? `${edits.remove.length} to remove` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          {" — applied when you save."}
        </p>
      )}
    </Section>
  );
}

function Section({
  count,
  showing,
  children,
}: {
  count: number | null;
  /** The filtered figure, when a filter is on. Null means nothing is narrowed. */
  showing?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-semibold text-navy">What they can order</div>
        {count !== null && (
          /*
            THE TOTAL NEVER DISAPPEARS BEHIND A FILTER. "37 of 81" says both what
            is on screen and what the customer actually gets — and it is the second
            number the grid column shows, so the two can be compared at a glance.
          */
          <div className="text-[11.5px] text-grey-2">
            {showing != null && showing !== count ? `${showing} of ${count} items` : `${count} ${count === 1 ? "item" : "items"}`}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
