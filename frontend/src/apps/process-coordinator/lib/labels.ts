/**
 * Human labels for this screen.
 *
 * ⚠ WHY THIS DOES NOT IMPORT THE TEN MODULES' `masterFields.ts`.
 *   The plan was to build a registry of their `masterTypeLabel` helpers. Reading
 *   them showed why that is the wrong trade:
 *     · their signatures diverge — `masterFields(mt)` in OCPI and HR Exit,
 *       `masterFields(mt, ctx)` with a REQUIRED context in Purchase, Import,
 *       Dispatch and Production, and a multi-argument form in Travel;
 *     · that context is the module's own loaded data (its vendors, items,
 *       companies), so reconstructing it here would mean mounting ten module
 *       stores inside one screen — the opposite of what this dashboard is for;
 *     · Travel exports no `masterTypeLabel` at all, only a constant array.
 *
 *   The `master_type` values are already snake_case English (`vendor_item_price`,
 *   `expense_category`, `job_title`), so prettifying reads the same as the
 *   curated labels while staying decoupled and never going stale when a module
 *   adds a type.
 *
 *   The consequence is deliberate and stated in the review modal: this screen
 *   edits the values a request already carries; it does not offer a module's
 *   dropdowns. Anything needing a genuine re-pick opens in the module itself.
 */

/** `vendor_item_price` → `Vendor item price`. */
export function prettyMasterType(masterType: string): string {
  const words = masterType.replace(/[_-]+/g, " ").trim();
  if (!words) return masterType;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `gstin` → `GSTIN`; otherwise the same prettifier as above. */
const ACRONYMS = new Set(["gstin", "hsn", "pan", "sku", "po", "mrf", "id", "uom", "fg", "bom"]);

export function prettyFieldKey(key: string): string {
  const parts = key.replace(/[_-]+/g, " ").trim().split(" ");
  return parts
    .map((p, i) =>
      ACRONYMS.has(p.toLowerCase())
        ? p.toUpperCase()
        : i === 0
          ? p.charAt(0).toUpperCase() + p.slice(1)
          : p,
    )
    .join(" ");
}

/**
 * How long a request has been waiting, in whole days.
 *
 * Local-time based, like `todayLocalIso()` elsewhere in the app and for the same
 * reason: IST is UTC+5:30, so a UTC day boundary reports work raised this
 * morning as having waited a day.
 */
export function waitingDays(createdAtIso: string, now = new Date()): number {
  const created = new Date(createdAtIso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(created)) / 86_400_000);
  return days < 0 ? 0 : days;
}

export function waitingLabel(createdAtIso: string, now = new Date()): string {
  const d = waitingDays(createdAtIso, now);
  if (d === 0) return "Today";
  if (d === 1) return "1 day";
  return `${d} days`;
}

/** The single line a request is identified by: its name, or its first value. */
export function requestSummary(payload: Record<string, unknown>): string {
  const name = payload?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  // A nameless master (Dispatch's customer↔item mapping) has no `name` key at
  // all — show what it does carry rather than an empty cell.
  const first = Object.entries(payload ?? {}).find(
    ([, v]) => typeof v === "string" && v.trim() !== "",
  );
  return first ? String(first[1]) : "—";
}
