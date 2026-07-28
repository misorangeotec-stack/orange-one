/**
 * Step 9 — record the Tally ledger. The end of the line.
 *
 * ⚠⚠ THIS PANEL DOES NOT PUSH THE CUSTOMER ANYWHERE.
 *   Order-to-Dispatch sources its customer data elsewhere (decided 28-Jul-2026),
 *   so there is deliberately no upsert into fms_dispatch_customers and no
 *   "send to dispatch" button. The completed request IS the record; downstream
 *   teams take the Excel export from All requests → Completed.
 *
 * ⚠ THE SALES EXECUTIVE IS TWO DIFFERENT THINGS and both are stored:
 *     • the PORTAL USER  — drives notifications and this customer's read access
 *     • the TALLY NAME   — the `customers.sales_person` string the hub's own
 *                          dashboards and per-rep scoping key on
 *   They come from different systems and one does not imply the other. Storing
 *   only the user breaks the rep's dashboard; only the name breaks the bell.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { CorrectionBar, PanelField, StepActionPanel } from "./StepActionPanel";
import { PersonSelect, useOrgPeople } from "./PeoplePicker";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { inr } from "@hub/lib/customerOnboarding/format";
import { localDateIso } from "@/shared/lib/workingDays";
import {
  CUSTOMER_LIVE_STATUS_OPTIONS, type CustomerLiveStatus, type CustomerRequest,
} from "@hub/lib/customerOnboarding/types";

/**
 * The Tally salesperson vocabulary, read straight from the receivables mirror.
 *
 * ⚠ IMPORTED DYNAMICALLY. supabaseFetcher is a code-split chunk — useAppData
 *   import()s it so the hub's receivables machinery is not in the entry bundle.
 *   A static import here would drag the whole fetcher (and its second Supabase
 *   client) back into the main chunk for the sake of one string list. Same
 *   reasoning as lookupGstin's dynamic import of the platform client.
 */
export function useSalespersonNames(): string[] {
  const { data } = useQuery({
    queryKey: ["hub", "salespersonNames"],
    queryFn: async () => {
      const { fetchSalespersonNames } = await import("@hub/lib/supabaseFetcher");
      return fetchSalespersonNames();
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? [];
}

export default function TallyPanel({
  request, mode = "decide", onDone,
}: {
  request: CustomerRequest;
  /** `edit` corrects a COMPLETED customer's record without reopening it. */
  mode?: "decide" | "edit";
  onDone?: () => void;
}) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const people = useOrgPeople();
  const salespeople = useSalespersonNames();

  const [code, setCode] = useState(r.customerCode ?? "");
  const [created, setCreated] = useState(r.tallyLedgerCreated ?? true);
  const [ledgerName, setLedgerName] = useState(r.tallyLedgerName ?? r.legalName ?? "");
  const [execId, setExecId] = useState<string | null>(r.assignedSalesExecId);
  const [execName, setExecName] = useState(r.assignedSalesExecName ?? "");
  const [status, setStatus] = useState<CustomerLiveStatus>(r.customerStatus ?? "active");
  const [date, setDate] = useState(r.tallyDate ?? localDateIso(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A convenience, not a rule: when the chosen portal user's name happens to
  // exist in Tally's salesperson list, offer it. The two vocabularies genuinely
  // differ, so this only ever pre-fills a blank.
  const suggestion = useMemo(() => {
    const person = people.find((p) => p.id === execId);
    if (!person) return null;
    return salespeople.find((n) => n.toLowerCase() === person.name.toLowerCase()) ?? null;
  }, [people, salespeople, execId]);

  useEffect(() => {
    if (!execName && suggestion) setExecName(suggestion);
  }, [suggestion, execName]);

  const submit = async () => {
    if (!code.trim()) { setError("Enter the customer code that Tally issued."); return; }
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        s.writes.recordTally(r.id, {
          customerCode: code.trim(),
          tallyLedgerCreated: created,
          tallyLedgerName: ledgerName.trim(),
          assignedSalesExecId: execId ?? "",
          assignedSalesExecName: execName.trim(),
          customerStatus: status,
          tallyDate: date,
        }),
      );
      toast({
        title: `${r.legalName ?? "Customer"} is live`,
        description: `Recorded as ${code.trim()}. Everyone involved has been notified.`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const correct = async () => {
    if (!code.trim()) { setError("The customer code cannot be blanked."); return; }
    setBusy(true);
    setError(null);
    try {
      await run(async () => {
        await s.writes.updateTally(r.id, {
          customerCode: code.trim(),
          tallyLedgerCreated: created,
          tallyLedgerName: ledgerName.trim(),
          customerStatus: status,
          tallyDate: date,
        });
        // The executive lives behind its own RPC (it works at any point and
        // notifies the new owner), so a correction that changed it needs both.
        if (execId !== r.assignedSalesExecId || execName.trim() !== (r.assignedSalesExecName ?? "")) {
          await s.writes.assignSalesExec(r.id, execId, execName.trim());
        }
      });
      toast({ title: "Customer record corrected" });
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepActionPanel
      title={mode === "edit" ? "Correct the customer record" : "Create the customer in Tally"}
      blurb={
        mode === "edit"
          ? "Fix the code, the ledger name or the status. The customer stays completed and nothing is reopened."
          : "Record the ledger you created, assign the sales executive, and close the request."
      }
      error={error}
      footer={
        mode === "edit" ? (
          <CorrectionBar onSave={() => void correct()} onCancel={onDone} busy={busy} />
        ) : (
          <>
            <Button onClick={submit} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark as created
            </Button>
            <p className="text-xs text-muted-foreground">
              This closes the request. Nothing is sent to any other system — teams that need
              this customer take the Excel export.
            </p>
          </>
        )
      }
    >
      {/* The approved terms, restated: this is what should be keyed into Tally. */}
      <div className="rounded-md border bg-muted/40 p-3 grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Approved credit limit</div>
          <div className="font-medium">{inr(r.accRecommendedLimit ?? r.requestedCreditLimit)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Credit period</div>
          <div className="font-medium">
            {(r.accRecommendedDays ?? r.requestedCreditDays) !== null
              ? `${r.accRecommendedDays ?? r.requestedCreditDays} days` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">GSTIN</div>
          <div className="font-medium font-mono text-xs">{r.gstNumber ?? "—"}</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PanelField
          id="tally-code"
          label="Customer code"
          required
          hint="The code Tally issued — not the CUST-#### request number."
        >
          <Input
            id="tally-code" value={code} disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. CUST0142"
            className="font-mono"
          />
        </PanelField>

        <PanelField id="tally-ledger" label="Tally ledger name" hint="Exactly as it reads in Tally.">
          <Input
            id="tally-ledger" value={ledgerName} disabled={busy}
            onChange={(e) => setLedgerName(e.target.value)}
            placeholder={r.legalName ?? ""}
          />
        </PanelField>

        <PanelField
          id="tally-exec-user"
          label="Assigned sales executive"
          hint="The portal user — they get the notifications and can see this customer."
        >
          <PersonSelect
            value={execId}
            onChange={(id) => setExecId(id)}
            people={people}
            disabled={busy}
            placeholder="Nobody assigned yet"
          />
        </PanelField>

        <PanelField
          id="tally-exec-name"
          label="Salesperson in Tally"
          hint="The name the receivables dashboards key on. Often, but not always, the same person."
        >
          <Select value={execName || "__none__"} onValueChange={(v) => setExecName(v === "__none__" ? "" : v)} disabled={busy}>
            <SelectTrigger id="tally-exec-name"><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not set</SelectItem>
              {/* An existing value not in the live list (a rep who has since left,
                  or a name typed before this picker existed) must still be shown,
                  or opening this panel would silently blank it. */}
              {execName && !salespeople.includes(execName) && (
                <SelectItem value={execName}>{execName} (not in Tally)</SelectItem>
              )}
              {salespeople.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </PanelField>

        <PanelField
          id="tally-status"
          label="Customer status"
          required
          hint="How this customer starts life. Hold blocks trading until someone lifts it."
        >
          <Select value={status} onValueChange={(v) => setStatus(v as CustomerLiveStatus)} disabled={busy}>
            <SelectTrigger id="tally-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CUSTOMER_LIVE_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>

        <PanelField id="tally-date" label="Created on">
          <Input id="tally-date" type="date" value={date} disabled={busy}
                 onChange={(e) => setDate(e.target.value)} />
        </PanelField>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <Checkbox
          checked={created} disabled={busy}
          onCheckedChange={(v) => setCreated(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm">
          The ledger exists in Tally
          <span className="block text-xs text-muted-foreground">
            Untick if you are recording the approval now and creating the ledger later.
          </span>
        </span>
      </label>
    </StepActionPanel>
  );
}
