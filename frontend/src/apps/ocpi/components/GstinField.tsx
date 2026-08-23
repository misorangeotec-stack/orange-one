import { useRef, useState } from "react";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import {
  normaliseGstin, isGstinFormatValid, gstinChecksumOk, panFromGstin, lookupGstin,
} from "@/shared/lib/gstin";
import type { QuotationDraft } from "../lib/fieldSpec";

/**
 * The GSTIN, validated locally and looked up online.
 *
 * ⚠ THIS IS LOAD-BEARING FOR OCPI, not a nicety. mst_parties.address is empty on
 *   every one of its 7,863 rows, so for a customer who has never been quoted
 *   before, the GST portal is the ONLY way to get a registered address onto the
 *   quotation without someone typing it out.
 *
 * Two things happen on a valid GSTIN:
 *   1. OFFLINE, instantly — the format and the mod-36 check character are
 *      verified and the PAN is derived. No network, no cost, works if everything
 *      else is down.
 *   2. ONLINE — the `gstin-lookup` Edge Function fills the legal name and the
 *      registered address.
 *
 * ⚠ THE LOOKUP SOFT-FILLS: it only writes fields left EMPTY. Someone who has
 *   corrected an address must not have it overwritten by the portal's version.
 *
 * ⚠ THE LOOKUP IS PAY-PER-CALL. It fires only for a GSTIN that already passed
 *   the local format and checksum test, only on blur, and never twice for the
 *   same number in one sitting (`triedRef`). Do not move it to onChange.
 */
export default function GstinField({
  draft,
  patch,
  disabled,
}: {
  draft: QuotationDraft;
  patch: (p: Partial<QuotationDraft>) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const triedRef = useRef<Set<string>>(new Set());

  const g = normaliseGstin(draft.gstNo);
  const touched = g.length > 0;
  const formatOk = isGstinFormatValid(g);
  const checksumOk = formatOk && gstinChecksumOk(g);

  const problem = !touched
    ? null
    : g.length !== 15
      ? `${g.length} of 15 characters`
      : !formatOk
        ? "That is not the shape of a GSTIN"
        : !checksumOk
          ? "The check character does not match — one of the other 14 is mistyped"
          : null;

  async function maybeLookup() {
    if (!checksumOk || triedRef.current.has(g)) return;
    triedRef.current.add(g);
    setBusy(true);
    setNote(null);
    try {
      const found = await lookupGstin(g);
      if (!found) {
        // A miss is not an error — no key configured, provider down, or the
        // GSTIN is simply unknown. The user types the address, as they would
        // have anyway.
        setNote(null);
        return;
      }
      const fill: Partial<QuotationDraft> = {};
      if (!draft.customerName.trim() && found.legalName) fill.customerName = found.legalName;
      if (!draft.customerAddress.trim() && found.registeredAddress) {
        fill.customerAddress = found.registeredAddress;
      }
      if (Object.keys(fill).length > 0) patch(fill);
      setNote(
        found.legalName
          ? `GST portal: ${found.legalName}${found.status ? ` · ${found.status}` : ""}`
          : null,
      );
    } catch {
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FieldLabel
      label="GST number"
      hint={
        busy
          ? "checking the GST portal…"
          : checksumOk
            ? `PAN ${panFromGstin(g)}`
            : undefined
      }
    >
      <TextInput
        value={draft.gstNo}
        onChange={(e) => patch({ gstNo: e.target.value.toUpperCase() })}
        onBlur={() => void maybeLookup()}
        placeholder="15 characters, e.g. 24AAACC1206D1ZM"
        maxLength={20}
        disabled={disabled}
      />
      {problem && <p className="mt-1 text-[12px] text-ryg-red">{problem}</p>}
      {!problem && note && <p className="mt-1 text-[12px] text-grey-2">{note}</p>}
    </FieldLabel>
  );
}
