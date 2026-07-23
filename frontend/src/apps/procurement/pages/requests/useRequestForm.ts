import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import type { MasterValues } from "../../lib/masterFields";
import type { MasterType, RequestItem } from "../../types";
import { useProcurementStore } from "../../store";

/**
 * Everything New Request and Edit Request share: the form state, the
 * Category → Group → Item derivation, validation. Domestic has no vendor,
 * currency, FX or rate at request time (those are chosen at sourcing), so this
 * is the slim cousin of Import's hook.
 */

export interface RequestLine extends LineGridRow {
  /** The existing `fms_purchase_request_items.id`, or null for a new row.
   *  Distinct from LineGrid's `uid` (React identity, must stay stable). */
  dbId: string | null;
  /** Category of THIS line — rows are free to differ. */
  categoryId: string;
  groupId: string;
  itemId: string;
  qty: string;
  unit: string;
  remark: string;
}

export const makeEmptyLine = (): RequestLine => ({
  uid: newUid(),
  dbId: null,
  categoryId: "",
  groupId: "",
  itemId: "",
  // Genuinely empty — LineGrid appends a blank row whenever the last one stops
  // being blank, so a default here would loop.
  qty: "",
  unit: "",
  remark: "",
});

/**
 * A fresh row that carries the previous row's Category + Item Group forward, so
 * a requisition of many items in one group is not "re-pick the category every
 * line". Only the classifiers are inherited — item, qty, unit and remark stay
 * empty, and the user can still change category/group on the new row. Because
 * `isLineBlank` ignores category/group (see below), this inherited row still
 * tests blank, so LineGrid keeps treating it as the single trailing blank row.
 */
export const makeInheritedLine = (prev?: RequestLine): RequestLine => ({
  ...makeEmptyLine(),
  categoryId: prev?.categoryId ?? "",
  groupId: prev?.groupId ?? "",
});

/**
 * Blankness is item-level: a row is blank until it names an item, a qty or a
 * remark. Category/Group are deliberately NOT tested — an inherited trailing
 * row carries them, and counting them would make LineGrid append blank rows
 * forever (and would flag the trailing row as an incomplete line).
 * `dbId` is NOT tested either — a hydrated row is blank only if the user emptied it.
 */
export const isLineBlank = (l: RequestLine) => !l.itemId && !l.qty && !l.remark;

export interface RequestFormInit {
  requestId: string;
  companyId: string;
  note: string;
  lines: RequestLine[];
}

export function useRequestForm(opts: { mode: "new" | "edit"; init?: RequestFormInit | null }) {
  const { mode, init } = opts;
  const s = useProcurementStore();

  const [companyId, setCompanyId] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([makeEmptyLine()]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [raise, setRaise] = useState<{ mt: MasterType; prefill: MasterValues } | null>(null);

  // Seed from a saved request exactly ONCE — the store rebuilds s.requests on
  // every invalidate(), which would otherwise wipe an in-progress edit.
  const hydrated = useRef<string | null>(null);
  if (init && hydrated.current !== init.requestId) {
    hydrated.current = init.requestId;
    setCompanyId(init.companyId);
    setNote(init.note);
    setLines(init.lines.length > 0 ? init.lines : [makeEmptyLine()]);
  }

  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
    [s.activeCompanies]
  );
  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );

  /** Groups under a row's category. */
  const groupOptionsFor = (line: RequestLine): ComboOption[] =>
    line.categoryId
      ? s.itemGroupsByCategory(line.categoryId).filter((g) => g.active).map((g) => ({ value: g.id, label: g.name }))
      : [];

  /** Items under a row's group, minus ones another row already took. */
  const itemOptionsFor = (line: RequestLine): ComboOption[] => {
    if (!line.groupId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    return s
      .itemsByGroup(line.groupId)
      .filter((it) => it.active && !taken.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || undefined }));
  };

  const raiseGroup = (line: RequestLine) => (name: string) => {
    if (!line.categoryId) {
      setErr("Pick a category first.");
      return;
    }
    setRaise({ mt: "item_group", prefill: { name, category_id: line.categoryId } });
  };
  const raiseItem = (line: RequestLine) => (name: string) => {
    if (!line.groupId) return;
    setRaise({ mt: "item", prefill: { name, item_group_id: line.groupId } });
  };

  const filled = lines.filter((l) => !isLineBlank(l));

  const validate = (): string | null => {
    if (!companyId) return "Select a company.";
    if (filled.length === 0) return "Add at least one item line.";
    if (filled.some((l) => !l.categoryId)) return "Every line needs a category.";
    if (filled.some((l) => !l.itemId)) return "Every line needs an item.";
    if (filled.some((l) => !(Number(l.qty) > 0))) return "Every line needs a quantity > 0.";
    return null;
  };

  return {
    mode,
    companyId, setCompanyId,
    lines, setLines,
    note, setNote,
    err, setErr,
    requested, setRequested,
    raise, setRaise,
    companyOptions, categoryOptions,
    groupOptionsFor, itemOptionsFor, raiseGroup, raiseItem,
    itemById: s.itemById,
    filled, validate,
  };
}

export type RequestFormApi = ReturnType<typeof useRequestForm>;

/** Turn a saved line into a grid row: fresh uid, DB id kept in dbId. */
export const hydrateLine = (item: RequestItem, groupIdOfItem: (itemId: string) => string): RequestLine => ({
  uid: newUid(),
  dbId: item.id,
  categoryId: item.categoryId ?? "",
  groupId: groupIdOfItem(item.itemId),
  itemId: item.itemId,
  qty: String(item.quantity ?? ""),
  unit: item.unit ?? "",
  remark: item.lineRemark ?? "",
});
