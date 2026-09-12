import { useEffect, useState } from "react";
import { fetchLotsForItem, type LotOption } from "../data/lotFetch";
import type { Company } from "../types";

/**
 * The two things a LOT picker needs besides the lots themselves (OD-12, OD-15).
 *
 * Lifted out of ShipLinesGrid when the correction screen gained the same field:
 * MOVED, not copied. Two copies of a fetch keyed on a NUL-joined string would
 * drift the first time either was touched, and the join is not obvious enough to
 * survive being re-derived.
 */

/**
 * Name a Tally book, for the one case that needs it.
 *
 * Only consulted when the same lot number comes back from more than one book.
 * The financial-year tail is trimmed off the company name ("…PVT LTD(F.Y.2026-27)",
 * "…-NOIDA -FY 26-27") because every book carries one, so it is the half that
 * never tells two apart, and it is what pushes the label past a cell's width.
 */
export function makeBookOf(companies: Company[]) {
  return (guid: string): string | null => {
    const c = companies.find((x) => x.tallyGuid === guid);
    if (!c) return null;
    return (
      c.name
        .split("(")[0]
        .replace(/[-\s]*F\.?Y\.?[\s.]*\d.*$/i, "")
        .replace(/[-\s]+$/, "")
        .trim() || c.name
    );
  };
}

/**
 * Tally's lots for a set of item names, keyed by name.
 *
 * Fetched once per DISTINCT item rather than per row — an order repeating the
 * same item on two lines must not fire the same lookup twice.
 *
 * `companyGuid` scopes to one Tally book; null fetches every book, which is what
 * the 8 orders carrying no company do, and why the same lot number can come back
 * twice with different balances.
 *
 * ⚠ AN EMPTY RESULT IS THE DESIGNED DEGRADATION, NOT AN ERROR. ConnectWave is a
 *   different project on a different key; unreachable, the caller gets {} and the
 *   picker becomes the free-text box it replaced. Dispatch does not wait on a
 *   reporting mirror.
 */
export function useLotsForItems(itemNames: string[], companyGuid: string | null) {
  const [lots, setLots] = useState<Record<string, LotOption[]>>({});

  /*
    Joined into a STRING because useEffect compares deps by identity and a fresh
    array would refetch on every render. The separator is \u0000 and NOT a space
    or comma: item names legitimately contain both ("REACTIVE INK ECO BLACK"), so
    either would split one name into several and look up items that do not exist.
  */
  const key = Array.from(new Set(itemNames.filter(Boolean))).join("\u0000");

  useEffect(() => {
    const names = key ? key.split("\u0000") : [];
    if (!names.length) return;
    let live = true;
    void Promise.all(names.map((n) => fetchLotsForItem(n, companyGuid))).then((res) => {
      if (!live) return;
      const next: Record<string, LotOption[]> = {};
      names.forEach((n, i) => { next[n] = res[i]; });
      setLots(next);
    });
    return () => { live = false; };
  }, [key, companyGuid]);

  return lots;
}
