/**
 * Process coordinators.
 *
 * ⚠ THIS IS THE MOST POWERFUL SETTING IN THE MODULE. A coordinator may act on
 *   EVERY step — verify, approve, approve as Director, record the ledger — and
 *   may hold, cancel and reopen any request. fms_customer_is_coordinator() is
 *   consulted first by can_act(), which is exactly what makes it a way around
 *   the four-eyes principle the step owners exist to enforce.
 *
 *   Appoint one or two people who genuinely run the process, not a department.
 *   Administrators are coordinators implicitly and do not need listing.
 */
import { useEffect, useState } from "react";
import { KeyRound, Loader2, Save } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { useToast } from "@hub/hooks/use-toast";
import { PeopleMultiSelect, useOrgPeople } from "@hub/components/customerOnboarding/PeoplePicker";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";

export default function CoordinatorsSection() {
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const people = useOrgPeople();

  const current = s.coordinatorIds;
  const [ids, setIds] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);

  // ⚠ Keyed on the CONTENTS. `coordinatorIds` is a fresh array on every snapshot
  //   refetch (react-query refetches on window focus), so depending on the array
  //   itself would discard a half-made selection whenever the admin alt-tabbed.
  const signature = current.join(",");
  useEffect(() => { setIds(current); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const dirty = JSON.stringify([...ids].sort()) !== JSON.stringify([...current].sort());

  const save = async () => {
    setBusy(true);
    try {
      await run(() => s.writes.setConfig("process_coordinators", { user_ids: ids }));
      toast({ title: "Coordinators saved" });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Process coordinators
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            They can act on <strong>every</strong> step and can hold, cancel or reopen any request —
            the escape hatch for when someone is on leave. Keep the list short. Administrators
            already have this and do not need adding.
          </p>
        </div>

        <div className="max-w-xl">
          <PeopleMultiSelect
            value={ids}
            onChange={setIds}
            people={people}
            disabled={busy}
            placeholder="Administrators only"
          />
        </div>

        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
      </CardContent>
    </Card>
  );
}
