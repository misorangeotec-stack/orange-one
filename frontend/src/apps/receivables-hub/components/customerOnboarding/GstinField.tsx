/**
 * The GST number field — the one input that fills in most of the KYC step.
 *
 * Two things happen on a valid GSTIN:
 *   1. OFFLINE, instantly — PAN (characters 3-12) and the state (first two
 *      digits) are derived locally. No network, no cost, works if everything
 *      else is down.
 *   2. ONLINE — the `gstin-lookup` Edge Function asks the GST portal who this
 *      GSTIN belongs to, and the legal name, trade name, registered address and
 *      city fill themselves in.
 *
 * ⚠ THE LOOKUP SOFT-FILLS: it only writes fields the user has left EMPTY, and
 *   every one stays editable. A portal record is a suggestion, not an authority —
 *   trade names in particular are often stale, and overwriting something a rep
 *   deliberately typed is how people learn to distrust a form.
 *
 * ⚠ IT IS ALSO PAY-PER-CALL. It fires only after the local format AND checksum
 *   pass, and `lastLookedUp` caches per GSTIN for the life of the page, so
 *   typing does not spend money. Keep both guarantees.
 *
 * NOTE: an earlier version also checked the ConnectWave Tally mirror for an
 * existing ledger with this GSTIN, to catch a customer being onboarded twice.
 * That was dropped on request (28-Jul-2026). To bring it back, query
 * `v_ledger_detail` (it carries `gstin`) through the hub's existing read-only
 * ConnectWave client — or, better, have the pipeline expose it.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { Input } from "@hub/components/ui/input";
import { FieldShell } from "./FormField";
import GstComplianceCard from "./GstComplianceCard";
import {
  parseGstin, lookupGstin, panFromGstin, toSnapshot,
  type GstinLookup, type GstinSnapshot,
} from "@hub/lib/customerOnboarding/gstin";
import type { GstState } from "@hub/lib/customerOnboarding/types";

export default function GstinField({
  value, onChange, onDerived, onLookup, states, error, panValue, onPanChange, panError,
  stateName, disabled, snapshot,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Offline derivation — always fires on a valid GSTIN. */
  onDerived: (d: { pan: string; stateCode: string; stateName: string }) => void;
  /** Portal result. The handler decides what to soft-fill; it only fills blanks. */
  onLookup: (d: GstinLookup) => void;
  states: GstState[];
  error?: string;
  panValue: string;
  onPanChange: (v: string) => void;
  panError?: string;
  stateName: string;
  disabled?: boolean;
  /**
   * ⚠ THE ANTI-DOUBLE-BILLING SEAM. The gate has almost always already looked
   *   this GSTIN up, and Appyflow charges per call. Passing that snapshot in
   *   pre-arms `lastLookedUp`, so arriving on this pane does NOT buy the same
   *   answer a second time. Without it every rep costs two lookups instead of
   *   one, and a resumed draft costs one more on every visit.
   */
  snapshot: GstinSnapshot | null;
}) {
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<GstinSnapshot | null>(snapshot);
  const [missed, setMissed] = useState(false);
  const lastLookedUp = useRef<string>(snapshot?.gstin ?? "");

  const parsed = parseGstin(value, states);

  // Offline derivation. Keyed on the parsed values so a re-render cannot re-fire
  // it, and so backspacing to an invalid GSTIN does not wipe a PAN the user
  // deliberately overrode.
  useEffect(() => {
    if (!parsed.ok || !parsed.pan || !parsed.stateCode || !parsed.stateName) return;
    onDerived({ pan: parsed.pan, stateCode: parsed.stateCode, stateName: parsed.stateName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.ok, parsed.pan, parsed.stateCode, parsed.stateName]);

  // Portal lookup — once per distinct valid GSTIN.
  useEffect(() => {
    if (!parsed.ok || parsed.gstin === lastLookedUp.current) return;
    lastLookedUp.current = parsed.gstin;
    let alive = true;
    setLooking(true);
    setFound(null);
    setMissed(false);
    void (async () => {
      const data = await lookupGstin(parsed.gstin);
      if (!alive) return;
      setLooking(false);
      if (data) {
        setFound(toSnapshot(parsed.gstin, data));
        onLookup(data);
      } else {
        setMissed(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.ok, parsed.gstin]);

  const derivedPan = parsed.ok ? panFromGstin(parsed.gstin) : "";
  const panOverridden = Boolean(derivedPan) && panValue.toUpperCase() !== derivedPan;

  return (
    <>
      <FieldShell
        id="gst_number"
        label="GST Number"
        required
        error={error}
        hint={
          looking ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Looking this up on the GST portal…
            </span>
          ) : found ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Found on the GST portal
            </span>
          ) : parsed.ok ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Valid — PAN and state filled in below
            </span>
          ) : (
            "15 characters. The rest of this step fills in from it."
          )
        }
      >
        <Input
          id="gst_number"
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="characters"
          maxLength={15}
          placeholder="24AHHPA6524B1Z1"
          className="font-mono uppercase"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-invalid={!!error}
          aria-describedby={error ? "gst_number-error" : undefined}
        />
      </FieldShell>

      <FieldShell
        id="pan_number"
        label="PAN Number"
        required
        error={panError}
        hint={
          panOverridden
            ? "Edited by hand — it no longer matches the GST number"
            : derivedPan
              ? "Taken from the GST number"
              : "Fills in from the GST number"
        }
      >
        <div className="flex gap-2">
          <Input
            id="pan_number"
            value={panValue}
            disabled={disabled}
            spellCheck={false}
            maxLength={10}
            placeholder="AHHPA6524B"
            className="font-mono uppercase"
            onChange={(e) => onPanChange(e.target.value.toUpperCase())}
          />
          {panOverridden && !disabled && (
            <button
              type="button"
              onClick={() => onPanChange(derivedPan)}
              title="Put back the PAN from the GST number"
              className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      </FieldShell>

      <FieldShell id="state_name" label="State" required hint="Set by the GST number">
        <Input id="state_name" value={stateName} readOnly disabled className="bg-muted/50" placeholder="—" />
      </FieldShell>

      {/* What the portal said — the same card the approvers will read later, so
          the rep sanity-checks the auto-fill against the certificate in front of
          them rather than trusting it blind. It carries its own cancelled /
          Composition warnings, hence none here. */}
      {found && (
        <div className="sm:col-span-2 -mt-1 mb-3 space-y-2">
          <GstComplianceCard snapshot={found} />
          <p className="text-[11px] text-muted-foreground">
            Only blank fields were filled — anything you had already typed was left alone.
            Everything stays editable.
          </p>
        </div>
      )}

      {missed && parsed.ok && (
        <div className="sm:col-span-2 -mt-1 mb-3">
          <p className="text-xs text-muted-foreground">
            Could not reach the GST portal for this number — the PAN and state above are still
            correct, so just fill in the name and address by hand.
          </p>
        </div>
      )}
    </>
  );
}
