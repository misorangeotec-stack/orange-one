/**
 * How long each step gets, and what starts its clock.
 *
 * ⚠ ANCHORS MAY ONLY POINT AT STRICTLY EARLIER STEPS. `anchorOptions` enforces
 *   that, which is what makes a cycle impossible by construction — a step that
 *   could anchor on a later one would have a due date that never resolves.
 *
 * ⚠ DUE DATES ARE DERIVED, NEVER STORED. Changing a number here re-dates every
 *   OPEN request at that step immediately, because customerDueIso() recomputes
 *   from the anchor's completion on every render. Closed requests are unaffected
 *   — nothing keeps a due date on the row.
 *
 * The unit is fixed per step by the code (all working days here) and is
 * deliberately NOT editable: config sets amounts, not what a step measures.
 */
import { useEffect, useRef, useState } from "react";
import { Clock, Loader2, Save } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { OWNED_STEPS, stepTitle, type StepKey } from "@hub/lib/customerOnboarding/steps";
import { anchorOptions } from "@hub/lib/customerOnboarding/sla";

type Draft = Record<string, { anchor: string; days: string }>;

export default function StepDueDatesSection() {
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();

  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);

  /**
   * Seed from the resolved map — through the store, not the raw config, so
   * defaults and a partial stored map both come out complete.
   *
   * ⚠ KEYED ON THE VALUES, NOT THE OBJECT. `s.stepSla` is a fresh object on
   *   every snapshot refetch (and react-query refetches on window focus), so a
   *   plain `[s.stepSla]` dependency would silently throw away half-typed edits
   *   the moment the admin alt-tabbed away and back.
   */
  const seeded = useRef<string>("");
  const signature = JSON.stringify(OWNED_STEPS.map((k) => [k, s.stepSla[k].anchor, s.stepSla[k].days]));
  useEffect(() => {
    if (seeded.current === signature) return;
    seeded.current = signature;
    const next: Draft = {};
    for (const k of OWNED_STEPS) {
      const rule = s.stepSla[k];
      next[k] = { anchor: rule.anchor, days: String(rule.days) };
    }
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const set = (k: StepKey, patch: Partial<{ anchor: string; days: string }>) =>
    setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));

  const dirty = OWNED_STEPS.some((k) => {
    const d = draft[k];
    if (!d) return false;
    return d.anchor !== s.stepSla[k].anchor || Number(d.days) !== s.stepSla[k].days;
  });

  const save = async () => {
    setBusy(true);
    try {
      const payload: Record<string, { anchor: string; days: number }> = {};
      for (const k of OWNED_STEPS) {
        const d = draft[k];
        const days = Number(d?.days);
        payload[k] = {
          anchor: d?.anchor ?? s.stepSla[k].anchor,
          days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : s.stepSla[k].days,
        };
      }
      await run(() => s.writes.setConfig("step_sla", payload));
      toast({ title: "Due dates saved", description: "Open requests are re-dated straight away." });
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
            <Clock className="h-4 w-4" /> Due dates
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Working days from the moment the step before it finished — so a request that has just
            arrived at a step is never born overdue. Weekends are skipped.
          </p>
        </div>

        <div className="space-y-3">
          {OWNED_STEPS.map((k) => {
            const d = draft[k];
            if (!d) return null;
            return (
              <div key={k} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_120px] sm:items-end rounded-md border p-3">
                <div className="text-sm font-medium">{stepTitle(k)}</div>

                <div>
                  <Label className="text-xs font-medium">Counted from</Label>
                  <div className="mt-1.5">
                    <Select value={d.anchor} onValueChange={(v) => set(k, { anchor: v })} disabled={busy}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {anchorOptions(k).map((a) => (
                          <SelectItem key={a} value={a}>{stepTitle(a)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor={`sla-${k}`} className="text-xs font-medium">Working days</Label>
                  <Input
                    id={`sla-${k}`}
                    inputMode="numeric"
                    value={d.days}
                    disabled={busy}
                    onChange={(e) => set(k, { days: e.target.value.replace(/\D/g, "") })}
                    className="mt-1.5 tabular-nums"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
      </CardContent>
    </Card>
  );
}
