/**
 * The gate — what anyone is asked before the wizard opens: which of OUR
 * companies this customer is for, who owns them, and then their GST number.
 *
 * WHY THE COMPANY COMES FIRST, AHEAD OF THE GSTIN
 *   A customer is onboarded so a ledger can be created in Tally, and a ledger
 *   lives in ONE company's books. That is not a step-9 detail — it is what
 *   Accounts propose a credit limit FOR and what the Director approves. The same
 *   party is routinely a customer of two of our companies with two different
 *   limits ("APEX IMPEX" is three ledgers), so it is also the thing that decides
 *   whether the GSTIN below is a duplicate at all.
 *
 * ⚠ THE COMPANY AND THE SALESPERSON ARE NOT SKIPPABLE, unlike the GSTIN. Both
 *   buttons and the GST box stay disabled until both are answered — a request
 *   missing either cannot be submitted (the RPC refuses it), so allowing it here
 *   would only defer the refusal to the very end.
 *
 * ⚠ THE SALESPERSON DEFAULTS TO THE PERSON RAISING IT when they are themselves a
 *   salesperson — the common case, since reps raise their own customers. It only
 *   ever fills a BLANK, so it cannot overwrite a deliberate choice.
 *
 * WHY THE GSTIN COMES BEFORE THE WIZARD RATHER THAN INSIDE IT
 *   One number yields the legal name, trade name, registered address, city, PAN,
 *   state, registration status and the whole filing history. Asking for it first
 *   means the rep opens a form that is already half filled instead of one that
 *   fills in underneath them three panes later.
 *
 *   It also moves the two questions that can END the conversation to the front:
 *     · a live request already exists for this GSTIN — the server refuses this at
 *       submit, and finding out AFTER filling forty-five fields is the single
 *       worst moment to find out;
 *     · the registration is cancelled, or they are a Composition dealer.
 *
 * ⚠ THE GATE IS SKIPPABLE, ON PURPOSE. An unregistered prospect is a real
 *   customer — the form's own GST field stays required, but that is the wizard's
 *   rule to enforce at submit, not the gate's to enforce at hello. A gate that
 *   cannot be passed is a wall.
 *
 * ⚠ NO DRAFT ROW EXISTS YET while this is on screen. Nothing here writes; the
 *   seed is handed to WizardShell as initial values and lands on the first
 *   autosave. That is what keeps an abandoned gate from minting an empty draft.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, Loader2, Search, ShieldAlert, SkipForward,
  UserRound,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import GstComplianceCard from "./GstComplianceCard";
import SalespersonPicker, { useDefaultSalesperson } from "./SalespersonPicker";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { detailHref } from "@hub/lib/customerOnboarding/routes";
import {
  customerTypeFrom, factoryAddressFrom, lookupGstin, normaliseGstin, parseGstin, toSnapshot,
  type GstinSnapshot,
} from "@hub/lib/customerOnboarding/gstin";
import {
  emptyFormValues, type CustomerFormValues,
} from "@hub/lib/customerOnboarding/schema";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

/**
 * Statuses that make an existing request BLOCK a new one.
 *
 * ⚠ MIRRORS fms_customer_submit_request's duplicate check exactly — rejected,
 *   cancelled and draft rows do NOT block. Diverge from that list and the gate
 *   either blocks something the server would accept, or waves through something
 *   it will refuse at the very end.
 */
const BLOCKING = (r: CustomerRequest) =>
  r.status !== "rejected" && r.status !== "cancelled" && r.status !== "draft";

export default function GstinGate({ onReady }: { onReady: (seed: CustomerFormValues) => void }) {
  const s = useCustomerStore();
  const [companyId, setCompanyId] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [raw, setRaw] = useState("");
  const [looking, setLooking] = useState(false);
  const [snapshot, setSnapshot] = useState<GstinSnapshot | null>(null);
  const [missed, setMissed] = useState(false);
  const lastLookedUp = useRef<string>("");

  /**
   * Pre-fill the salesperson with the person raising the request, when they are
   * one.
   *
   * ⚠ FILLS A BLANK ONLY, and the list arrives asynchronously — hence an effect
   *   rather than a useState initialiser, which would run once against an empty
   *   list and never fill anything. The `!salesperson` guard is what stops it
   *   from overwriting a choice the rep has already made by the time the mirror
   *   answers.
   */
  const defaultSalesperson = useDefaultSalesperson();
  useEffect(() => {
    if (!salesperson && defaultSalesperson) setSalesperson(defaultSalesperson);
  }, [defaultSalesperson, salesperson]);

  const parsed = parseGstin(raw, s.gstStates);
  const gstin = parsed.ok ? parsed.gstin : "";
  /** Everything the wizard cannot open without. */
  const ready = Boolean(companyId) && salesperson.trim().length >= 2;

  /**
   * The duplicate the server would refuse at submit, found now instead.
   *
   * ⚠ SCOPED TO THE CHOSEN COMPANY, because the server's rule is. The same GSTIN
   *   may hold one live request in each of our companies; a global match here
   *   would block a second-company onboarding at hello that the RPC would have
   *   accepted. Only meaningful once a company is picked, which is why it is
   *   gated on companyId rather than defaulting to "any".
   */
  const clash = gstin && companyId
    ? s.requests.find(
        (r) =>
          normaliseGstin(r.gstNumber ?? "") === gstin && r.companyId === companyId && BLOCKING(r),
      )
    : undefined;

  /* ── Lookup, once per distinct valid GSTIN ──────────────────────────── */
  useEffect(() => {
    if (!parsed.ok || parsed.gstin === lastLookedUp.current) return;
    lastLookedUp.current = parsed.gstin;
    let alive = true;
    setLooking(true);
    setSnapshot(null);
    setMissed(false);
    void (async () => {
      const d = await lookupGstin(parsed.gstin);
      if (!alive) return;
      setLooking(false);
      if (d) setSnapshot(toSnapshot(parsed.gstin, d));
      else setMissed(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.ok, parsed.gstin]);

  /**
   * Hand the wizard its starting values.
   *
   * ⚠ SEEDS, NOT TRUTH. Everything written here stays editable in the form, and
   *   the wizard's own soft-fill rule (blanks only) governs from that point on.
   *   The portal is a suggestion; the rep with the certificate in front of them
   *   is the authority.
   */
  const start = useCallback((withGstin: boolean) => {
    const v = emptyFormValues();
    // ⚠ BEFORE the early return below — the "no GST number" path is a real
    //   onboarding and needs its company and salesperson just as much.
    v.company_id = companyId;
    v.assigned_sales_exec_name = salesperson.trim();
    if (!withGstin || !parsed.ok) return onReady(v);

    v.gst_number = parsed.gstin;
    v.pan_number = parsed.pan ?? "";
    v.state_code = parsed.stateCode ?? "";
    v.state_name = parsed.stateName ?? "";

    if (snapshot) {
      v.legal_name = snapshot.legalName ?? "";
      v.trade_name = snapshot.tradeName ?? "";
      v.city = snapshot.city ?? "";
      // Pincode is carried separately by the portal, but an address without one
      // is no use to a courier or a Tally ledger.
      v.registered_address = [snapshot.registeredAddress, snapshot.pincode]
        .filter(Boolean).join(" - ");
      // Only when the portal LABELS a premises as manufacturing — see
      // factoryAddressFrom. A warehouse in the factory box is worse than a blank.
      v.factory_address = factoryAddressFrom(snapshot.additionalPlaces) ?? "";
      // Manufacturer / exporter only, and only when the portal is unambiguous —
      // the other four types are commercial, not GST facts. See customerTypeFrom.
      const ct = customerTypeFrom(snapshot.compliance?.natureOfBusiness);
      if (ct) v.customer_type = ct;
      v.gstin_snapshot = snapshot;
    }
    onReady(v);
  }, [companyId, salesperson, parsed.ok, parsed.gstin, parsed.pan, parsed.stateCode,
      parsed.stateName, snapshot, onReady]);

  // Only once they have finished typing all 15. Underlining a half-typed GSTIN in
  // red from the first character is how a form teaches people to ignore it.
  const showParseError = normaliseGstin(raw).length >= 15 && !parsed.ok && parsed.message;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6 space-y-6">
        {/* ── 1. Whose customer is this — our company, and our salesperson ── */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Whose customer is this?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              The Tally company whose books their ledger will be created in, and the salesperson
              who owns them. Both travel with the request all the way to the Tally step.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
            <div>
              <label className="text-sm font-medium text-foreground">Company</label>
              <div className="mt-1.5">
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger aria-label="Company">
                    <SelectValue placeholder="Choose a company" />
                  </SelectTrigger>
                  <SelectContent>
                    {s.companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {s.companyName(c.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1.5 text-xs">
                {companyId ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Building2 className="h-3 w-3" /> {s.companyName(companyId)}
                  </span>
                ) : s.companies.length === 0 ? (
                  <span className="text-destructive">
                    No companies are set up yet — an administrator needs to add them under Masters.
                  </span>
                ) : (
                  <span className="text-muted-foreground">Which of our books this ledger belongs in.</span>
                )}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Salesperson</label>
              <div className="mt-1.5">
                <SalespersonPicker value={salesperson} onChange={setSalesperson} />
              </div>
              <p className="mt-1.5 text-xs">
                {salesperson.trim().length >= 2 ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <UserRound className="h-3 w-3" /> {salesperson.trim()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Not on the list? Choose “Other” and type the name.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── 2. Their GST number ────────────────────────────────────── */}
        <div className="space-y-4 border-t pt-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Now their GST number</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              One number fills in the name, address, PAN and state — and tells us whether the
              registration is active and whether they file on time.
            </p>
          </div>

          <div className="max-w-sm">
            {/* No autoFocus: it is disabled on mount, so the company picker
                above is where the cursor belongs. */}
            <Input
              value={raw}
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={15}
              // Disabled until company and salesperson are answered, so the
              // order on screen is the order the questions are meant to be
              // asked in.
              disabled={!ready}
              placeholder="24AHHPA6524B1Z1"
              className="font-mono uppercase text-base tracking-wide"
              onChange={(e) => setRaw(e.target.value.toUpperCase())}
              aria-label="GST number"
              aria-invalid={Boolean(showParseError)}
            />
            <p className="mt-1.5 text-xs">
              {!ready ? (
                <span className="text-muted-foreground">
                  Answer the company and the salesperson first.
                </span>
              ) : looking ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking the GST portal…
                </span>
              ) : showParseError ? (
                <span className="text-destructive">{parsed.message}</span>
              ) : snapshot ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Found on the GST portal
                </span>
              ) : parsed.ok ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Valid — PAN and state derived from it
                </span>
              ) : (
                <span className="text-muted-foreground">15 characters, as printed on their GST certificate.</span>
              )}
            </p>
          </div>

          {/* The conversation-ending finding, surfaced before anyone types a word. */}
          {clash && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">This customer is already being onboarded</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {clash.reqNo ?? "A request"} for this GSTIN is live in{" "}
                    {s.companyName(companyId)}
                    {clash.legalName ? <> — {clash.legalName}</> : null}. A second one cannot be
                    submitted for the same company, so continue on the existing request instead
                    — or pick a different company above.
                  </p>
                  <Button variant="outline" size="sm" asChild className="mt-2 gap-1">
                    <Link to={detailHref(clash.id)}>
                      Open {clash.reqNo ?? "the request"} <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {snapshot && <GstComplianceCard snapshot={snapshot} />}

          {missed && parsed.ok && (
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  We could not reach the GST portal for this number. The PAN and state are still
                  derived from it correctly — you will just need to type the name and address.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ⚠ BOTH buttons require company + salesperson; only Continue also
            requires the GSTIN. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            onClick={() => start(true)}
            disabled={!ready || !parsed.ok || looking || Boolean(clash)}
            className="gap-1"
          >
            {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Continue
          </Button>
          <Button
            variant="ghost"
            onClick={() => start(false)}
            disabled={!ready}
            className="gap-1 text-muted-foreground"
          >
            <SkipForward className="h-4 w-4" /> They have no GST number
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
