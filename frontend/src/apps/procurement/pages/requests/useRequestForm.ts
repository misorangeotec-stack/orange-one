import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { draftKey } from "@/shared/lib/draftStore";
import { useStepDraft } from "@/shared/lib/useStepDraft";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import type { MasterValues } from "../../lib/masterFields";
import type { MasterType, RequestItem } from "../../types";
import { useProcurementStore } from "../../store";

/**
 * Everything New Request and Edit Request share: the form state, the
 * Category → Item derivation, validation. The item-group step is hidden — an
 * item is picked straight under its category (the group is resolved behind the
 * scenes only when requesting a brand-new item). Domestic has no vendor,
 * currency, FX or rate at request time (those are chosen at sourcing), so this
 * is the slim cousin of Import's hook.
 */

export interface RequestLine extends LineGridRow {
  /** The existing `fms_purchase_request_items.id`, or null for a new row.
   *  Distinct from LineGrid's `uid` (React identity, must stay stable). */
  dbId: string | null;
  /** Category of THIS line — rows are free to differ. */
  categoryId: string;
  itemId: string;
  qty: string;
  unit: string;
  remark: string;
}

export const makeEmptyLine = (): RequestLine => ({
  uid: newUid(),
  dbId: null,
  categoryId: "",
  itemId: "",
  // Genuinely empty — LineGrid appends a blank row whenever the last one stops
  // being blank, so a default here would loop.
  qty: "",
  unit: "",
  remark: "",
});

/**
 * A fresh row that carries the previous row's Category forward, so a requisition
 * of many items in one category is not "re-pick the category every line". Only
 * the classifier is inherited — item, qty, unit and remark stay empty, and the
 * user can still change category on the new row. Because `isLineBlank` ignores
 * category (see below), this inherited row still tests blank, so LineGrid keeps
 * treating it as the single trailing blank row.
 */
export const makeInheritedLine = (prev?: RequestLine): RequestLine => ({
  ...makeEmptyLine(),
  categoryId: prev?.categoryId ?? "",
});

/**
 * Blankness is item-level: a row is blank until it names an item, a qty or a
 * remark. Category is deliberately NOT tested — an inherited trailing row
 * carries it, and counting it would make LineGrid append blank rows forever
 * (and would flag the trailing row as an incomplete line).
 * `dbId` is NOT tested either — a hydrated row is blank only if the user emptied it.
 */
export const isLineBlank = (l: RequestLine) => !l.itemId && !l.qty && !l.remark;

export interface RequestFormInit {
  requestId: string;
  companyId: string;
  note: string;
  lines: RequestLine[];
}

/** Exactly what an unsaved requisition is worth keeping. Must stay JSON-safe. */
interface RequestDraft {
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

  /**
   * Autosave, so an interruption stops costing the whole form.
   *
   * This is the longest-lived form in the app — a dozen item lines, raised on a
   * shared shop-floor PC, routinely interrupted by a missing item master. The
   * draft never leaves this browser and is dropped the moment the request is
   * submitted (see NewRequest / EditRequest).
   *
   * NEW gets one in-flight draft per person; EDIT gets one per request, so two
   * corrections in progress can't collide. `init` is null both while the store
   * is still loading AND once the request is past editing — either way there is
   * nothing to draft, which is what the null key means.
   *
   * The seed above runs during RENDER, not in an effect, so React discards that
   * render and the hook below only ever sees seeded values. Moving that seed
   * into a useEffect would race the restore.
   */
  const { user } = useEffectiveIdentity();
  const key = !user?.id
    ? null
    : mode === "new"
      ? draftKey(user.id, "procurement:request:new")
      : init
        ? draftKey(user.id, `procurement:request:${init.requestId}`)
        : null;

  const draft = useStepDraft<RequestDraft>({
    key,
    // err / requested / raise are transient UI and deliberately left out.
    values: { companyId, note, lines },
    /**
     * What counts as a real change. Blank rows and uids are excluded because
     * LineGrid appends its trailing blank row a tick AFTER this form seeds —
     * comparing raw values made merely opening Edit look like unsaved work, and
     * announced a restore over a form nobody had touched. Dropping `uid` also
     * makes the comparison survive the per-load id namespace.
     */
    comparable: (v) => ({
      companyId: v.companyId,
      note: v.note.trim(),
      lines: v.lines
        .filter((l) => !isLineBlank(l))
        .map((l) => ({
          dbId: l.dbId,
          categoryId: l.categoryId,
          itemId: l.itemId,
          qty: l.qty,
          unit: l.unit,
          remark: l.remark.trim(),
        })),
    }),
    apply: (v) => {
      setCompanyId(v.companyId);
      setNote(v.note);
      setLines(v.lines.length > 0 ? v.lines : [makeEmptyLine()]);
    },
  });

  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
    [s.activeCompanies]
  );
  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );

  /** Items under a row's category (via its groups), minus ones another row already took. */
  const itemOptionsFor = (line: RequestLine): ComboOption[] => {
    if (!line.categoryId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    return s
      .itemsForCategory(line.categoryId)
      .filter((it) => !taken.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || undefined }));
  };

  const raiseItem = (line: RequestLine) => (name: string) => {
    if (!line.categoryId) {
      setErr("Pick a category first.");
      return;
    }
    setRaise({ mt: "item", prefill: { name, category_id: line.categoryId } });
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
    itemOptionsFor, raiseItem,
    itemById: s.itemById,
    filled, validate,
    draft,
  };
}

export type RequestFormApi = ReturnType<typeof useRequestForm>;

/** Turn a saved line into a grid row: fresh uid, DB id kept in dbId. */
export const hydrateLine = (item: RequestItem): RequestLine => ({
  uid: newUid(),
  dbId: item.id,
  categoryId: item.categoryId ?? "",
  itemId: item.itemId,
  qty: String(item.quantity ?? ""),
  unit: item.unit ?? "",
  remark: item.lineRemark ?? "",
});
