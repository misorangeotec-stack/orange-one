/**
 * The wizard: eight panes, a progress rail, autosaved drafts.
 *
 * ── SAVE-AS-DRAFT IS A REAL ROW IN POSTGRES, NOT BROWSER STORAGE ──────────
 * Uploads need a request id, and a 5 MB PDF cannot live in localStorage;
 * "stash it in IndexedDB and upload at submit" means the upload can fail AFTER
 * the user believes they are done. A rep also starts on a phone at the
 * customer's office and finishes at a desk, and a lost draft has to be findable
 * by someone other than its author. The cost is abandoned rows — paid for by
 * req_no staying NULL until submit (no gaps in the CUST-#### series), a Drafts
 * list with delete, and RLS hiding drafts from everyone but the raiser.
 *
 * sessionStorage is used too, for exactly one job it is genuinely good at:
 * surviving a hard refresh inside the 2.5-second autosave debounce. Postgres is
 * the store of record; that mirror is a crash pad.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, ListChecks, Save } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Progress } from "@hub/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger } from "@hub/components/ui/sheet";
import { useToast } from "@hub/hooks/use-toast";
import { useIsMobile } from "@hub/hooks/use-mobile";
import WizardRail, { buildRailSteps } from "./WizardRail";
import {
  Step1CustomerInfo, Step2Kyc, Step3Contact, Step4Ink, Step5Potential,
  Step6References, Step7Credit,
} from "./steps/FormSteps";
import ReviewStep from "./steps/ReviewStep";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import {
  fullSchema, STEP_FIELDS, toRpcPayload,
  type CustomerFormValues,
} from "@hub/lib/customerOnboarding/schema";
import { FORM_STEPS, REVIEW_STEP_INDEX } from "@hub/lib/customerOnboarding/steps";
import { detailHref } from "@hub/lib/customerOnboarding/routes";

const AUTOSAVE_MS = 2500;

export default function WizardShell({
  requestId, initialValues, mode, onSaved,
}: {
  /** Existing draft or request being edited; null for a brand-new customer. */
  requestId: string | null;
  initialValues: CustomerFormValues;
  /** `draft` autosaves and submits; `edit` saves a submitted request in place. */
  mode: "draft" | "edit";
  onSaved?: () => void;
}) {
  const s = useCustomerStore();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [step, setStep] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [attempted, setAttempted] = useState<Set<number>>(new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  // The draft's id, held in a ref so the debounced autosave never races itself
  // into creating a second row for the same form.
  //
  // ⚠ MIRRORED IN STATE as well. A ref does not re-render, and step 2's upload
  //   slots must appear the moment the first autosave mints a row — with the ref
  //   alone they would stay hidden until something else happened to re-render.
  const idRef = useRef<string | null>(requestId);
  const [savedId, setSavedId] = useState<string | null>(requestId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⚠ THE COMPANY AND THE GSTIN ARE BOTH PART OF THE KEY FOR A NEW CUSTOMER,
   *   NOT DECORATION.
   *   The restore below is `{...initialValues, ...saved}` — the crash pad wins
   *   every field. Once the gate started seeding real values, a single shared
   *   "new" key meant a pad abandoned inside the 2.5s debounce for GSTIN X would
   *   silently restore X's name, address and frozen snapshot over a fresh gate
   *   for GSTIN Y. Keying by GSTIN made the pad belong to one taxpayer.
   *
   *   The company had to join it for the same reason: a request is now identified
   *   by (company, GSTIN) — the same pair the SQL's unique guard uses — so the
   *   same customer legitimately gets one request per company. Without the
   *   company in the key, an abandoned pad for a customer under O-tec would
   *   restore over a fresh gate for that same customer under Colorix. The
   *   `"nogst"` bucket makes this sharper still: every companyless start shared
   *   one key.
   */
  const crashKey =
    `hub:custonb:${requestId ??
      `new:${initialValues.company_id || "nocompany"}:${initialValues.gst_number || "nogst"}`}`;

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(fullSchema),
    defaultValues: initialValues,
    // onTouched, not onChange: validating every keystroke turns a half-typed
    // email into a red field while the user is still typing it.
    mode: "onTouched",
    reValidateMode: "onChange",
  });

  /* ── Crash pad ─────────────────────────────────────────────────────── */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(crashKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as CustomerFormValues;
      form.reset({ ...initialValues, ...saved });
      sessionStorage.removeItem(crashKey);
      toast({ title: "Unsaved changes restored", description: "We put back what you had typed." });
    } catch { /* a corrupt crash pad is not worth an error */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Autosave ──────────────────────────────────────────────────────── */
  const persist = useCallback(async (): Promise<string | null> => {
    if (mode === "edit" && !idRef.current) return null;
    const values = form.getValues();
    if (!values.legal_name?.trim()) return null; // the server's one draft rule

    setSaving(true);
    try {
      const payload = toRpcPayload(values);
      if (mode === "edit" && idRef.current) {
        await s.writes.updateRequest(idRef.current, payload);
      } else {
        idRef.current = await s.writes.saveDraft(payload, idRef.current);
        setSavedId(idRef.current);
      }
      sessionStorage.removeItem(crashKey);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      await s.refresh();
      return idRef.current;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: (e as Error).message,
      });
      return null;
    } finally {
      setSaving(false);
    }
  }, [form, mode, s, toast, crashKey]);

  // Mirror to sessionStorage on every change, and debounce the real save.
  useEffect(() => {
    const sub = form.watch((values) => {
      try { sessionStorage.setItem(crashKey, JSON.stringify(values)); } catch { /* quota */ }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void persist(); }, AUTOSAVE_MS);
    });
    return () => {
      sub.unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [form, persist, crashKey]);

  /* ── Navigation ────────────────────────────────────────────────────── */
  const invalidSteps = useMemo(() => {
    const errs = form.formState.errors;
    const out = new Set<number>();
    STEP_FIELDS.forEach((fields, i) => {
      if (fields.some((f) => errs[f])) out.add(i + 1);
    });
    return out;
  }, [form.formState.errors]);

  const railSteps = buildRailSteps(step, attempted, invalidSteps, furthest);

  const goTo = (n: number) => {
    setStep(n);
    setFurthest((f) => Math.max(f, n));
    setRailOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = async () => {
    setAttempted((a) => new Set(a).add(step));
    if (step <= FORM_STEPS.length) {
      const ok = await form.trigger(STEP_FIELDS[step - 1]);
      if (!ok) return;
    }
    void persist();
    goTo(Math.min(REVIEW_STEP_INDEX, step + 1));
  };

  const back = () => goTo(Math.max(1, step - 1));

  const saveAndClose = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = await persist();
    toast({ title: mode === "edit" ? "Changes saved" : "Draft saved" });
    if (onSaved) onSaved();
    navigate(id ? detailHref(id) : "..");
  };

  const submit = async () => {
    setAttempted(new Set(FORM_STEPS.map((f) => f.index)));
    const ok = await form.trigger();
    if (!ok) {
      const first = [...invalidSteps].sort((a, b) => a - b)[0];
      toast({
        variant: "destructive",
        title: "Some details are still missing",
        description: "The steps that need attention are marked in the list.",
      });
      if (first) goTo(first);
      return;
    }

    setSubmitting(true);
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = await persist();
      if (!id) throw new Error("Could not save the request before submitting");
      const reqNo = await s.writes.submitRequest(id);
      await s.refresh();
      toast({
        title: `Submitted as ${reqNo}`,
        description: "Accounts have been notified and will verify the details.",
      });
      navigate(detailHref(id));
    } catch (e) {
      toast({ variant: "destructive", title: "Could not submit", description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────── */
  const meta = FORM_STEPS.find((f) => f.index === step);
  const onReview = step === REVIEW_STEP_INDEX;
  const stepProps = { form, states: s.gstStates };

  const body = onReview ? (
    <ReviewStep form={form} onJump={goTo} invalidSteps={invalidSteps} />
  ) : step === 1 ? <Step1CustomerInfo {...stepProps} />
    : step === 2 ? (
      <Step2Kyc
        {...stepProps}
        requestId={savedId}
        // Read from the store, not held locally: an upload writes through an RPC
        // and invalidates the snapshot, so this is what carries the new path back
        // into the slots.
        request={savedId ? (s.requestById(savedId) ?? null) : null}
        onNeedSave={persist}
      />
    )
    : step === 3 ? <Step3Contact {...stepProps} />
    : step === 4 ? <Step4Ink {...stepProps} />
    : step === 5 ? <Step5Potential {...stepProps} />
    : step === 6 ? <Step6References {...stepProps} />
    : <Step7Credit {...stepProps} />;

  const railNode = <WizardRail steps={railSteps} onJump={goTo} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Desktop rail */}
      <aside className="hidden lg:block">
        <div className="sticky top-4">{railNode}</div>
      </aside>

      {/* Mobile: a progress bar plus a slide-out with the full rail */}
      {isMobile && (
        <div className="lg:hidden space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Step {step} of {REVIEW_STEP_INDEX} · {onReview ? "Review & submit" : meta?.title}
            </p>
            <Sheet open={railOpen} onOpenChange={setRailOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <ListChecks className="h-4 w-4" /> Steps
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px]">
                <div className="mt-6">{railNode}</div>
              </SheetContent>
            </Sheet>
          </div>
          <Progress value={(step / REVIEW_STEP_INDEX) * 100} className="h-1.5" />
        </div>
      )}

      <div className="min-w-0">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-foreground">
                {onReview ? "Review & submit" : meta?.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {onReview ? "One last look before this goes to Accounts." : meta?.blurb}
              </p>
            </div>

            {body}
          </CardContent>
        </Card>

        {/* Sticky on mobile so Next is always reachable without scrolling back */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4 py-3 flex flex-wrap items-center gap-2 lg:static lg:bg-transparent lg:backdrop-blur-none lg:border-0">
          <Button variant="outline" onClick={back} disabled={step === 1 || submitting} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          <span className="text-xs text-muted-foreground flex items-center gap-1 mx-1">
            {saving
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
              : savedAt ? `Saved ${savedAt}` : ""}
          </span>

          <div className="flex-1" />

          <Button variant="outline" onClick={saveAndClose} disabled={saving || submitting} className="gap-1">
            <Save className="h-4 w-4" /> {mode === "edit" ? "Save & close" : "Save draft"}
          </Button>

          {onReview ? (
            <Button onClick={submit} disabled={submitting} className="gap-1">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {mode === "edit" ? "Save & resubmit" : "Submit"}
            </Button>
          ) : (
            <Button onClick={next} disabled={submitting} className="gap-1">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
