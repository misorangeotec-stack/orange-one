import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useComplaintStore } from "../../store";
import { fetchPartyItems, partyItemsQueryKey, type ComplaintItem } from "../../data/complaintMasters";
import {
  findLotMatches,
  lotSourceReady,
  LOT_LOOKUP_AVAILABLE,
  normaliseLot,
  type LotMatch,
} from "../../lib/resolveLot";
import { futureDateError, invoiceDateLabelOf, invoiceLabelOf, lotLabelOf, partyLabelOf } from "../../lib/format";
import type { ComplaintType, LotSource } from "../../types";
import type { RequestInput } from "../../data/complaintWrites";

/** The raise panel's editable state. Everything is a string — the form owns text, not types. */
export interface ComplaintForm {
  complaintType: ComplaintType;
  companyId: string;
  lotNo: string;
  lotExpiryDate: string;
  category: string;
  inkType: string;
  itemId: string;
  itemName: string;
  partyId: string;
  partyName: string;
  invoiceNo: string;
  invoiceDate: string;
  qtyAffected: string;
  unitName: string;
  natureId: string;
  issueIdentifiedAt: string;
  problemDetails: string;
  otherRemarks: string;
}

const EMPTY: ComplaintForm = {
  complaintType: "finished_good",
  companyId: "",
  lotNo: "",
  lotExpiryDate: "",
  category: "",
  inkType: "",
  itemId: "",
  itemName: "",
  partyId: "",
  partyName: "",
  invoiceNo: "",
  invoiceDate: "",
  qtyAffected: "",
  unitName: "",
  natureId: "",
  issueIdentifiedAt: "",
  problemDetails: "",
  otherRemarks: "",
};

/**
 * Tally reports a quantity as ONE string with the unit welded on — "100.0000 KGS",
 * "10.000 PCS". `qty_affected` is `numeric`, so passing that through whole fails
 * with `invalid input syntax for type numeric: "100.0000 KGS"`. Split it.
 *
 * Returns ["", ""] for anything with no leading number, so a malformed value
 * clears the field rather than poisoning the insert.
 */
export function splitTallyQty(raw: string | null | undefined): [qty: string, unit: string] {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(.*?)\s*$/.exec(raw ?? "");
  return m ? [m[1], m[2]] : ["", ""];
}

/**
 * `datetime-local` wants `yyyy-mm-ddThh:mm` with no zone or seconds.
 *
 * Exported because the field uses it as its `max`: an issue cannot have been
 * noticed in the future, and the PICKER should say so rather than letting
 * somebody choose a date the form will then refuse.
 */
export const nowLocalInput = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function useComplaintForm() {
  const s = useComplaintStore();
  const { user } = useSession();
  const [form, setForm] = useState<ComplaintForm>({ ...EMPTY, issueIdentifiedAt: nowLocalInput() });
  const [lotSource, setLotSource] = useState<LotSource>("manual");
  const [lotNote, setLotNote] = useState("");
  /** Candidate shipments this LOT was on. The user picks; nothing auto-applies. */
  const [lotMatches, setLotMatches] = useState<LotMatch[]>([]);
  const [lotLooking, setLotLooking] = useState(false);
  /** Why there is nothing to show. Distinguishes "no such lot" from "sync never ran". */
  const [lotMiss, setLotMiss] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [touched, setTouched] = useState(false);
  /**
   * Files chosen on the raise form, held until the complaint EXISTS.
   *
   * ⚠ THEY CANNOT BE UPLOADED BEFORE SUBMIT. The storage path begins with the
   *   complaint id and the policies derive the owning complaint from it, so
   *   there is nothing to upload against until the RPC returns an id. Staging
   *   them here and uploading straight after is the only order that works.
   */
  const [files, setFiles] = useState<File[]>([]);

  const set = useCallback(<K extends keyof ComplaintForm>(key: K, value: ComplaintForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  /**
   * Switching the complaint type re-points the party picker at the other side of
   * `mst_parties`, so a party already chosen may no longer be offerable. Clearing
   * the party (and, with it, the item that came from its catalogue) is the honest
   * move — leaving a vendor selected under a "Customer Name" label is how the
   * wrong ledger ends up on a credit note.
   */
  const setComplaintType = useCallback((t: ComplaintType) => {
    setForm((f) =>
      f.complaintType === t
        ? f
        : { ...f, complaintType: t, partyId: "", partyName: "", itemId: "", itemName: "", category: "", inkType: "" },
    );
  }, []);

  /** The parties this company + type may name. */
  const partyOptions = useMemo(
    () => s.partiesFor(form.companyId || null, form.complaintType, form.partyId || null),
    [s, form.companyId, form.complaintType, form.partyId],
  );

  // The chosen party's own catalogue, on its own key — see data/complaintMasters.ts.
  const { data: partyItems } = useQuery({
    queryKey: partyItemsQueryKey(form.partyId || null),
    queryFn: () => fetchPartyItems(form.partyId),
    enabled: !!form.partyId,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Picking an item seeds Category of Ink and Ink type from `mst_items` — the
   * authoritative 96-value list, hand-maintained — and then LEAVES THEM EDITABLE.
   * Only fills what is still blank, so a corrected category survives a re-pick.
   */
  const pickItem = useCallback((item: ComplaintItem | null) => {
    setForm((f) => ({
      ...f,
      itemId: item?.id ?? "",
      itemName: item?.name ?? "",
      category: f.category || (item?.category ?? ""),
      inkType: f.inkType || (item?.inkType ?? ""),
    }));
  }, []);

  /**
   * The LOT lookup, fired ON BLUR and never on change — the GstinField pattern.
   *
   * ⚠ IT OFFERS CANDIDATES; IT DOES NOT AUTOFILL. A lot number is not a unique
   *   key: 92% of lots appear on more than one invoice line, because a drum is
   *   bought once and sold from repeatedly. Picking the first match would put a
   *   coin-toss customer on the complaint. So matches land in `lotMatches` and
   *   the user chooses one — see `applyLotMatch`.
   *
   * It reads ConnectWave's `rpt_batch_line` — 112,277 real lots, sales and
   * purchase both. See lib/resolveLot.ts.
   *
   * `tried` stops a second lookup for the same value in one sitting.
   */
  const tried = useRef<Set<string>>(new Set());

  const lookupLot = useCallback(async () => {
    const lot = form.lotNo.trim();
    if (!LOT_LOOKUP_AVAILABLE || !lot) return;
    if (tried.current.has(lot)) return;
    tried.current.add(lot);

    setLotMiss("");
    setLotMatches([]);

    // A lot that is not a lot — "Primary Batch", or free text with no digit run.
    // Say so rather than running a query that cannot match.
    if (!normaliseLot(lot)) {
      setLotMiss("That does not look like a LOT number, so nothing was looked up.");
      return;
    }

    setLotLooking(true);
    try {
      const found = await findLotMatches(form.complaintType, lot);
      setLotMatches(found);
      if (found.length === 0) {
        // ⚠ AN UNREACHABLE SOURCE AND AN UNKNOWN LOT LOOK IDENTICAL from here,
        //   and blaming the user's lot number for a ConnectWave outage is the
        //   wrong message. One cheap count tells them apart.
        const ready = await lotSourceReady();
        setLotMiss(
          ready
            ? "No shipment found for this LOT — fill the rest in by hand."
            : "The Tally lot data could not be reached, so nothing could be looked up. Fill the rest in by hand.",
        );
      }
    } catch (err) {
      // A lookup failure must never block raising a complaint.
      setLotMiss(
        `Could not look up the LOT (${err instanceof Error ? err.message : String(err)}). Fill the rest in by hand.`,
      );
    } finally {
      setLotLooking(false);
    }
  }, [form.lotNo, form.complaintType]);

  /**
   * Fill the form from the shipment the user picked.
   *
   * SOFT FILL ONLY — writes only fields still empty, so a value already typed
   * survives, and NOTHING becomes read-only afterwards.
   */
  const applyLotMatch = useCallback((match: LotMatch) => {
    const [qty, unit] = splitTallyQty(match.qty);
    setForm((f) => ({
      ...f,
      // The book the voucher is in. Set FIRST in the object for readability, but
      // note it also re-scopes the party picker — which is why the party is set
      // from the match in the same update rather than left to be re-chosen.
      companyId: f.companyId || (match.companyId ?? ""),
      itemId: f.itemId || (match.itemId ?? ""),
      itemName: f.itemName || match.itemName,
      category: f.category || (match.category ?? ""),
      inkType: f.inkType || (match.inkType ?? ""),
      partyId: f.partyId || (match.partyId ?? ""),
      partyName: f.partyName || match.partyName,
      invoiceNo: f.invoiceNo || match.voucherNo,
      invoiceDate: f.invoiceDate || match.voucherDate,
      qtyAffected: f.qtyAffected || qty,
      unitName: f.unitName || unit,
    }));
    setLotSource("tally");
    setLotNote(`Filled from ${match.voucherNo} — every field is still editable.`);
    setLotMatches([]);
    setLotMiss("");
  }, []);

  /* -------------------------------- validation ------------------------------ */

  const t = form.complaintType;

  const errors = useMemo(() => {
    const e: Partial<Record<keyof ComplaintForm, string>> = {};
    if (!form.lotNo.trim()) e.lotNo = `${lotLabelOf(t)} is required.`;
    if (!form.itemName.trim()) e.itemName = "Item name is required.";
    if (!form.partyName.trim()) e.partyName = `${partyLabelOf(t)} is required.`;
    if (!form.invoiceNo.trim()) e.invoiceNo = `${invoiceLabelOf(t)} is required.`;
    if (!form.invoiceDate) e.invoiceDate = `${invoiceDateLabelOf(t)} is required.`;
    if (!form.issueIdentifiedAt) e.issueIdentifiedAt = "When the issue was identified is required.";
    if (!form.problemDetails.trim()) e.problemDetails = "Problem in details is required.";

    // Both are past-facing by nature; a future one is a typo, not a plan.
    const invFuture = futureDateError(form.invoiceDate || null, invoiceDateLabelOf(t));
    if (!e.invoiceDate && invFuture) e.invoiceDate = invFuture;
    const issFuture = futureDateError(form.issueIdentifiedAt || null, "The issue-identified date");
    if (!e.issueIdentifiedAt && issFuture) e.issueIdentifiedAt = issFuture;

    // Mirrors the table CHECK `fms_complaint_issue_not_before_invoice`. Caught here
    // so the form can say so, rather than letting the insert throw a constraint name.
    if (!e.issueIdentifiedAt && !e.invoiceDate && form.issueIdentifiedAt && form.invoiceDate) {
      if (form.issueIdentifiedAt.slice(0, 10) < form.invoiceDate) {
        e.issueIdentifiedAt = "The issue cannot have been identified before the invoice was raised.";
      }
    }
    return e;
  }, [form, t]);

  const isValid = Object.keys(errors).length === 0;

  /** Show an error only once the field has been engaged, or once Submit was pressed. */
  const errorFor = (key: keyof ComplaintForm): string => (touched ? (errors[key] ?? "") : "");

  const toInput = (): RequestInput => ({
    complaintType: form.complaintType,
    companyId: form.companyId || null,
    requesterName: user.name,
    lotNo: form.lotNo.trim(),
    lotExpiryDate: form.lotExpiryDate || null,
    category: form.category.trim() || null,
    inkType: form.inkType.trim() || null,
    itemId: form.itemId || null,
    itemName: form.itemName.trim(),
    partyId: form.partyId || null,
    partyName: form.partyName.trim(),
    invoiceNo: form.invoiceNo.trim(),
    invoiceDate: form.invoiceDate,
    // ⚠ NUMBER ONLY. The column is `numeric`; anything with a unit welded on —
    //   typed by hand or pasted — is stripped here rather than throwing at the DB.
    qtyAffected: splitTallyQty(form.qtyAffected)[0] || null,
    unitName: form.unitName.trim() || null,
    natureId: form.natureId || null,
    issueIdentifiedAt: new Date(form.issueIdentifiedAt).toISOString(),
    problemDetails: form.problemDetails.trim(),
    otherRemarks: form.otherRemarks.trim() || null,
  });

  /** Submit. Returns the new complaint's id, or null when it refused or failed. */
  const submit = async (): Promise<string | null> => {
    setTouched(true);
    if (!isValid) return null;
    setSubmitting(true);
    setSubmitError("");
    try {
      const id = await s.submitRequest(toInput());
      // ⚠ AFTER the complaint exists, and never fatal: the complaint is saved by
      //   this point, so a failed upload must not read as a failed submit. It is
      //   reported and the file can be re-attached from the detail page.
      for (const f of files) {
        try {
          await s.uploadDoc(id, "evidence", "raise", f);
        } catch (e) {
          setSubmitError(
            `The complaint was saved, but "${f.name}" did not upload: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return id;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    set,
    setComplaintType,
    partyOptions,
    partyItems: partyItems ?? [],
    pickItem,
    lookupLot,
    lotMatches,
    lotLooking,
    lotMiss,
    applyLotMatch,
    lotSource,
    lotNote,
    errors,
    errorFor,
    isValid,
    touched,
    files,
    setFiles,
    submitting,
    submitError,
    submit,
  };
}

export type ComplaintFormApi = ReturnType<typeof useComplaintForm>;
