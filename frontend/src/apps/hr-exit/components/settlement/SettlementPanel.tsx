import { useState } from "react";
import type { ReactNode } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import DueCell from "@/shared/components/ui/DueCell";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, Select, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useExitStore, skippedStepsOf } from "../../store";
import {
  exitDocUrl,
  uploadFinalFnfDoc,
  uploadFnfDoc,
  type PayrollLineInput,
} from "../../data/exitWrites";
import { stepDone } from "../../lib/queues";
import { days as fmtDays, money } from "../../lib/format";
import type { StepKey } from "../../lib/steps";
import type { ExitCase } from "../../types";

/**
 * ⭐⭐ THE SETTLEMENT — THE SECOND CONFIDENTIAL SATELLITE. THE MONEY.
 *
 * ⚠⚠ THIS COMPONENT IS RENDERED **ONLY** WHEN `store.canReadSettlement(case)` IS TRUE.
 *
 *   admin ∨ a process coordinator ∨ `fms_exit_is_finance_staff` (the owner of
 *   leave_verification | payroll_inputs | fnf_generate | fnf_approve | fnf_payment)
 *   ∨ THE LEAVER THEMSELVES, and then only once the F&F has been APPROVED.
 *
 *   **THE REPORTING MANAGER IS ON NO CLAUSE OF THAT GATE, AT ANY STAGE.** Nor are the
 *   Admin / IT / Travel-Desk clearance owners, who are exit staff and read every other
 *   panel on the page. `ExitDetail` renders a bare status chip in its place for everyone
 *   else, driven by the HEADER timestamps — never by this satellite, which hands a
 *   non-reader zero rows.
 *
 * ⚠⚠ **RECORD, DON'T COMPUTE.** Nothing on this screen calculates a settlement, and
 *   nothing ever may. The portal holds no salary data and no leave ledger, so a total it
 *   produced would be fiction wearing the authority of a database column. Every number
 *   here is keyed in from what payroll or accounts SAID, and the F&F itself is the
 *   ATTACHED WORKING. The running total below is a display aid, says so on the screen,
 *   and is never persisted.
 *
 * ── THE FIVE BLOCKS, AND WHAT ACTUALLY GATES THEM ──────────────────────────────
 *
 *   1. Leave verification  ┐ PARALLEL. Both unlock on the confirmed last working day,
 *   2. Payroll inputs      ┘ and neither waits on the other — that is exactly what
 *                            `openSteps()` says and what the RPCs allow. Chaining them
 *                            here would tell Payroll to sit on their hands until HR had
 *                            finished counting leave days, which is not how either team
 *                            works and is not what the queue would show them.
 *   3. Generate F&F        → LOCKED until BOTH of the above are done **or waived**.
 *   4. Approve             → LOCKED until the F&F is generated.
 *   5. Release payment     → LOCKED until the F&F is approved.
 *
 *   Every one of those locks is enforced by the DATABASE (fms_exit_generate_fnf refuses
 *   without its inputs, fms_exit_approve_fnf without a generation, fms_exit_release_fnf_payment
 *   without an approval). This component only makes the refusal visible before the click.
 *
 *   "Done" everywhere means **`stepDone` — timestamp OR SKIPPED**, matching the SQL guard
 *   exactly. An absconder whose payroll step was legitimately waived must not be wedged.
 */

/** A block that cannot be worked yet, and the honest reason why. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
      <span className="font-semibold text-grey">Locked</span> — {children}
    </p>
  );
}

const Done = ({ label }: { label: string }) => (
  <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
    {label}
  </span>
);

async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/** "" → null. A blank number is NOT ZERO: "not stated" and "nothing owed" differ, in money. */
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "Cheque", "Cash", "Payroll (with salary)"];

export default function SettlementPanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const st = s.settlementFor(c.id);
  const lines = s.payrollLinesFor(c.id);
  const skipped = skippedStepsOf(s.skips, c.id);
  const skipOf = (k: StepKey) => s.skipsFor(c.id).find((x) => x.stepKey === k);
  const done = (k: StepKey) => stepDone(c, k, skipped);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  /** May act on THIS step, on THIS case — mirrors fms_exit_can_act(). */
  const may = (k: StepKey) => !closed && !skipOf(k) && !!c.lwd && s.canActOn(k, c);

  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------ 1. leave ------------------------------- */
  const [editLeave, setEditLeave] = useState(false);
  const [balance, setBalance] = useState(str(st?.leaveBalanceDays));
  const [lwp, setLwp] = useState(str(st?.lwpDays));
  const [encash, setEncash] = useState(str(st?.encashableDays));
  const [leaveRemarks, setLeaveRemarks] = useState(st?.leaveRemarks ?? "");

  /* ----------------------------- 2. payroll ------------------------------ */
  const [editPayroll, setEditPayroll] = useState(false);
  const [lwpDone, setLwpDone] = useState(st?.lwpCompleted ?? false);
  const [noticeDays, setNoticeDays] = useState(str(st?.noticeRecoveryDays));
  const [noticeAmt, setNoticeAmt] = useState(str(st?.noticeRecoveryAmount));
  const [incentive, setIncentive] = useState(str(st?.incentiveAmount));
  const [loan, setLoan] = useState(str(st?.loanRecoveryAmount));
  const [otherDed, setOtherDed] = useState(str(st?.otherDeductions));
  const [payrollRemarks, setPayrollRemarks] = useState(st?.payrollRemarks ?? "");
  const [draftLines, setDraftLines] = useState<PayrollLineInput[]>(
    lines.map((l) => ({
      headId: l.headId,
      headName: l.headName,
      kind: l.kind,
      amount: l.amount,
      remarks: l.remarks,
    })),
  );

  /* ---------------------------- 3. generate ------------------------------ */
  const [editFnf, setEditFnf] = useState(false);
  const [fnfAmount, setFnfAmount] = useState(str(st?.fnfAmount));
  const [fnfRemarks, setFnfRemarks] = useState(st?.fnfRemarks ?? "");
  const [fnfFile, setFnfFile] = useState<File | null>(null);

  /* ---------------------------- 4. approve ------------------------------- */
  const [approvalRemarks, setApprovalRemarks] = useState("");

  /* ---------------------------- 5. payment ------------------------------- */
  const [mode, setMode] = useState(st?.fnfPaymentMode ?? "NEFT");
  const [ref, setRef] = useState(st?.fnfPaymentRef ?? "");
  const [paidOn, setPaidOn] = useState(st?.fnfPaidOn ?? "");
  const [finalFile, setFinalFile] = useState<File | null>(null);

  /**
   * THE RUNNING TOTAL — **A DISPLAY AID, AND NOTHING ELSE.**
   *
   * It is computed in the browser, shown with a label that says what it is, and NEVER
   * SENT ANYWHERE. `fnf_amount` is whatever payroll states (and may be left NULL). The
   * moment a number this app derived is persisted as the settlement, the app is asserting
   * a figure it has no data to support — the portal does not hold a single salary.
   */
  const additions =
    (Number(incentive) || 0) +
    draftLines.filter((l) => l.kind === "addition").reduce((n, l) => n + (Number(l.amount) || 0), 0);
  const deductions =
    (Number(noticeAmt) || 0) +
    (Number(loan) || 0) +
    (Number(otherDed) || 0) +
    draftLines.filter((l) => l.kind === "deduction").reduce((n, l) => n + (Number(l.amount) || 0), 0);

  const inputsReady = done("leave_verification") && done("payroll_inputs");
  const heads = s.payrollHeads.filter((h) => h.active);

  return (
    <Card className="space-y-5 border-navy/15 p-5">
      {/* ---------------------------- header ---------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-navy">Settlement (Full &amp; Final)</h2>
            {/* Said out loud, to the people who CAN read it — so nobody keys a number
                believing the manager will see it. */}
            <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
              Finance confidential
            </span>
          </div>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
            Visible to payroll, accounts and the process coordinators — and to the employee themselves,
            once the F&amp;F is approved. The reporting manager never sees it. Every figure here is{" "}
            <span className="font-semibold text-navy">recorded from payroll</span>, not calculated by this
            app.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.fnfGeneratedAt && <Done label="Generated" />}
          {c.fnfApprovedAt && <Done label="Approved" />}
          {c.fnfPaidAt && <Done label="Paid" />}
        </div>
      </div>

      {!c.lwd && (
        <Locked>
          confirm the last working day first. The leave balance is only final once they stop accruing, and
          the payroll cut-off is derived from it.
        </Locked>
      )}

      {/* ======================= 1. LEAVE VERIFICATION ======================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>1 · Leave verification</SectionHeading>
          {c.leaveVerifiedAt ? (
            <Done label="Verified" />
          ) : (
            c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "leave_verification")} />
              </span>
            )
          )}
        </div>

        {skipOf("leave_verification") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("leave_verification")!.reason}
          </p>
        ) : !c.lwd ? null : editLeave && may("leave_verification") ? (
          <div className="space-y-3">
            <div className="grid gap-3.5 sm:grid-cols-3">
              <FieldLabel label="Leave balance" hint="days, from the leave system">
                <TextInput type="number" step="0.5" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Leave without pay" hint="days in the final month">
                <TextInput type="number" step="0.5" min="0" value={lwp} onChange={(e) => setLwp(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Encashable" hint="of the balance, what is payable">
                <TextInput type="number" step="0.5" min="0" value={encash} onChange={(e) => setEncash(e.target.value)} />
              </FieldLabel>
            </div>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={leaveRemarks} onChange={(e) => setLeaveRemarks(e.target.value)} />
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await s.verifyLeave(c, {
                      leaveBalanceDays: numOrNull(balance),
                      lwpDays: numOrNull(lwp),
                      encashableDays: numOrNull(encash),
                      leaveRemarks: leaveRemarks.trim() || null,
                    });
                    setEditLeave(false);
                  })
                }
              >
                {busy ? "Saving…" : "Verify the leave balance"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditLeave(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Leave balance" value={fmtDays(st?.leaveBalanceDays)} />
              <Field label="Leave without pay" value={fmtDays(st?.lwpDays)} />
              <Field label="Encashable" value={fmtDays(st?.encashableDays)} />
              <Field label="Verified on" value={formatDateDMY(c.leaveVerifiedAt)} />
              {st?.leaveRemarks && <Field className="sm:col-span-4" label="Remarks" value={st.leaveRemarks} />}
            </div>
            {may("leave_verification") && (
              <Button size="sm" variant={c.leaveVerifiedAt ? "ghost" : undefined} onClick={() => setEditLeave(true)}>
                {c.leaveVerifiedAt ? "Correct the leave figures" : "Verify the leave balance"}
              </Button>
            )}
          </>
        )}
      </div>

      {/* ========================= 2. PAYROLL INPUTS ========================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>2 · Payroll inputs</SectionHeading>
          {c.payrollDoneAt ? (
            <Done label="Recorded" />
          ) : (
            c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due at the payroll cut-off · <DueCell dueIso={s.dueIsoFor(c, "payroll_inputs")} />
              </span>
            )
          )}
        </div>

        {skipOf("payroll_inputs") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("payroll_inputs")!.reason}
          </p>
        ) : !c.lwd ? null : editPayroll && may("payroll_inputs") ? (
          <div className="space-y-3.5">
            <div className="grid gap-3.5 sm:grid-cols-3">
              <FieldLabel label="Notice recovery" hint="days">
                <TextInput type="number" step="0.5" min="0" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Notice recovery" hint="₹, as payroll states it">
                <TextInput type="number" step="0.01" min="0" value={noticeAmt} onChange={(e) => setNoticeAmt(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Incentive / bonus payable" hint="₹">
                <TextInput type="number" step="0.01" min="0" value={incentive} onChange={(e) => setIncentive(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Loan / advance recovery" hint="₹">
                <TextInput type="number" step="0.01" min="0" value={loan} onChange={(e) => setLoan(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Other deductions" hint="₹">
                <TextInput type="number" step="0.01" min="0" value={otherDed} onChange={(e) => setOtherDed(e.target.value)} />
              </FieldLabel>
            </div>

            <label className="flex items-center gap-2.5 text-[13px] text-navy">
              <input type="checkbox" checked={lwpDone} onChange={(e) => setLwpDone(e.target.checked)} />
              The leave-without-pay has been processed in payroll
            </label>

            {/* ---- the free-form lines, off the payroll-heads master ---- */}
            <SectionHeading>Additions &amp; deductions</SectionHeading>
            <ul className="space-y-2">
              {draftLines.map((l, i) => (
                <li
                  key={i}
                  className="grid gap-2 rounded-xl border border-line bg-white px-3 py-2.5 sm:grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_auto]"
                >
                  <Select
                    value={l.headId ?? ""}
                    onChange={(e) => {
                      const h = heads.find((x) => x.id === e.target.value);
                      setDraftLines((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? { ...x, headId: h?.id ?? null, headName: h?.name ?? "", kind: h?.kind ?? x.kind }
                            : x,
                        ),
                      );
                    }}
                  >
                    <option value="">Choose a head…</option>
                    {heads.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={l.kind}
                    onChange={(e) =>
                      setDraftLines((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value as "addition" | "deduction" } : x,
                        ),
                      )
                    }
                  >
                    <option value="addition">Addition</option>
                    <option value="deduction">Deduction</option>
                  </Select>
                  <TextInput
                    type="number"
                    step="0.01"
                    min="0"
                    value={String(l.amount ?? "")}
                    onChange={(e) =>
                      setDraftLines((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                  <TextInput
                    placeholder="Remarks"
                    value={l.remarks ?? ""}
                    onChange={(e) =>
                      setDraftLines((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, remarks: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraftLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDraftLines((prev) => [
                  ...prev,
                  { headId: null, headName: "", kind: "deduction", amount: 0, remarks: null },
                ])
              }
            >
              + Add a line
            </Button>

            {/* ⚠ DISPLAY ONLY. Never sent, never stored. See the component header. */}
            <div className="rounded-xl border border-line bg-page px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <span className="text-grey">Additions {money(additions)} · Deductions {money(deductions)}</span>
                <span className="font-semibold text-navy">Indicative net {money(additions - deductions)}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-grey-2">
                <span className="font-semibold text-grey">Display only — this is not the settlement.</span>{" "}
                It adds up what is on this screen; it does not know their salary, and it is never saved. The
                F&amp;F amount is whatever payroll states, on the F&amp;F itself.
              </p>
            </div>

            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={payrollRemarks} onChange={(e) => setPayrollRemarks(e.target.value)} />
            </FieldLabel>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await s.recordPayrollInputs(c, {
                      lwpCompleted: lwpDone,
                      noticeRecoveryDays: numOrNull(noticeDays),
                      noticeRecoveryAmount: numOrNull(noticeAmt),
                      incentiveAmount: numOrNull(incentive),
                      loanRecoveryAmount: numOrNull(loan),
                      otherDeductions: numOrNull(otherDed),
                      payrollRemarks: payrollRemarks.trim() || null,
                      // The complete list, every time — the RPC REPLACES them. A line with
                      // no head is dropped here rather than being refused by the database.
                      lines: draftLines.filter((l) => l.headName.trim() !== ""),
                    });
                    setEditPayroll(false);
                  })
                }
              >
                {busy ? "Saving…" : "Record the payroll inputs"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditPayroll(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Notice recovery" value={`${fmtDays(st?.noticeRecoveryDays)} · ${money(st?.noticeRecoveryAmount)}`} />
              <Field label="Incentive / bonus" value={money(st?.incentiveAmount)} />
              <Field label="Loan / advance recovery" value={money(st?.loanRecoveryAmount)} />
              <Field label="Other deductions" value={money(st?.otherDeductions)} />
              <Field label="LWP processed" value={st?.lwpCompleted ? "Yes" : "Not yet"} />
              <Field label="Recorded on" value={formatDateDMY(c.payrollDoneAt)} />
              {st?.payrollRemarks && <Field className="sm:col-span-3" label="Remarks" value={st.payrollRemarks} />}
            </div>

            {lines.length > 0 && (
              <ul className="space-y-1.5">
                {lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2"
                  >
                    <span className="text-[13px] text-navy">
                      {l.headName}
                      {l.remarks && <span className="ml-1.5 text-[12px] text-grey-2">— {l.remarks}</span>}
                    </span>
                    <span
                      className={`text-[13px] font-semibold ${l.kind === "addition" ? "text-ryg-green" : "text-ryg-red"}`}
                    >
                      {l.kind === "addition" ? "+" : "−"} {money(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {may("payroll_inputs") && (
              <Button size="sm" variant={c.payrollDoneAt ? "ghost" : undefined} onClick={() => setEditPayroll(true)}>
                {c.payrollDoneAt ? "Correct the payroll inputs" : "Record the payroll inputs"}
              </Button>
            )}
          </>
        )}
      </div>

      {/* ========================= 3. GENERATE THE F&F ======================= */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>3 · Generate the F&amp;F</SectionHeading>
          {c.fnfGeneratedAt ? (
            <Done label="Generated" />
          ) : (
            inputsReady && c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "fnf_generate")} />
              </span>
            )
          )}
        </div>

        {skipOf("fnf_generate") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("fnf_generate")!.reason}
          </p>
        ) : !inputsReady ? (
          /* ⭐ The lock the DATABASE also enforces (fms_exit_generate_fnf raises). "Done"
                here is stepDone — timestamp OR WAIVED — so an absconder is never wedged. */
          <Locked>
            the F&amp;F cannot be worked out before its inputs exist.{" "}
            {!done("leave_verification") && "The leave balance has not been verified. "}
            {!done("payroll_inputs") && "The payroll inputs have not been recorded. "}
            (Either step can be waived, with a reason.)
          </Locked>
        ) : editFnf && may("fnf_generate") ? (
          <div className="space-y-3.5">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <FieldLabel label="Net F&F payable" hint="₹ — optional; leave it blank if payroll has not stated one">
                <TextInput type="number" step="0.01" value={fnfAmount} onChange={(e) => setFnfAmount(e.target.value)} />
              </FieldLabel>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-navy">The F&amp;F working</span>
                <input
                  type="file"
                  onChange={(e) => setFnfFile(e.target.files?.[0] ?? null)}
                  className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
                />
                <span className="mt-1 block text-[11.5px] text-grey-2">
                  Stored under <code>cases/…/fnf/</code> — finance-confidential in storage too. The Admin and
                  IT clearance owners cannot open it.
                </span>
              </label>
            </div>
            <p className="text-[11.5px] leading-snug text-grey-2">
              <span className="font-semibold text-grey">The sheet is the settlement, not this form.</span> This
              app holds no salary data, so it cannot and will not compute a net figure. Record what payroll
              says — and if they have not said one yet, leave it blank and attach the working.
            </p>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={fnfRemarks} onChange={(e) => setFnfRemarks(e.target.value)} />
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    // Upload FIRST, so the F&F can never be "generated" against a working
                    // that is not there. The RPC validates the cases/<id>/fnf/ prefix.
                    const up = fnfFile ? await uploadFnfDoc(c.id, fnfFile) : null;
                    await s.generateFnf(c, {
                      fnfAmount: numOrNull(fnfAmount),
                      fnfRemarks: fnfRemarks.trim() || null,
                      filePath: up?.path ?? null,
                      fileName: up?.name ?? null,
                    });
                    setFnfFile(null);
                    setEditFnf(false);
                  })
                }
              >
                {busy ? "Saving…" : c.fnfGeneratedAt ? "Save the correction" : "Generate the F&F"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditFnf(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Net F&F payable">
                {st?.fnfAmount === null || st?.fnfAmount === undefined ? (
                  <span className="text-grey-2" title="Payroll has not stated a net figure. This app does not compute one.">
                    Not stated
                  </span>
                ) : (
                  <span className="text-[15px] font-bold text-navy">{money(st.fnfAmount)}</span>
                )}
              </Field>
              <Field label="Generated on" value={formatDateDMY(c.fnfGeneratedAt)} />
              {st?.fnfFilePath && (
                <Field label="The working">
                  <button
                    type="button"
                    onClick={() => void openDoc(st.fnfFilePath!)}
                    className="font-semibold text-orange hover:underline"
                  >
                    {st.fnfFileName ?? "Open"} →
                  </button>
                </Field>
              )}
              {st?.fnfRemarks && <Field className="sm:col-span-3" label="Remarks" value={st.fnfRemarks} />}
            </div>
            {may("fnf_generate") && (
              <Button size="sm" variant={c.fnfGeneratedAt ? "ghost" : undefined} onClick={() => setEditFnf(true)}>
                {c.fnfGeneratedAt ? "Correct the F&F" : "Generate the F&F"}
              </Button>
            )}
          </>
        )}
      </div>

      {/* ============================ 4. APPROVE ============================ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>4 · Approve the F&amp;F</SectionHeading>
          {c.fnfApprovedAt ? (
            <Done label="Approved" />
          ) : (
            c.fnfGeneratedAt && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "fnf_approve")} />
              </span>
            )
          )}
        </div>

        {skipOf("fnf_approve") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("fnf_approve")!.reason}
          </p>
        ) : !done("fnf_generate") ? (
          <Locked>the F&amp;F has not been generated yet. There is nothing to approve.</Locked>
        ) : c.fnfApprovedAt ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Approved by" value={person(st?.fnfApprovedById ?? null)} />
            <Field label="On" value={formatDateDMY(c.fnfApprovedAt)} />
            {st?.fnfApprovalRemarks && (
              <Field className="sm:col-span-3" label="Remarks" value={st.fnfApprovalRemarks} />
            )}
            <p className="sm:col-span-3 text-[11.5px] text-grey-2">
              The employee can now open their own settlement, and their copy of the F&amp;F.
            </p>
          </div>
        ) : may("fnf_approve") ? (
          <div className="space-y-3">
            <FieldLabel label="Remarks" hint="required if you are sending it back">
              <TextArea
                rows={2}
                value={approvalRemarks}
                onChange={(e) => setApprovalRemarks(e.target.value)}
                placeholder="What you checked — or what is wrong with it."
              />
            </FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => void run(() => s.approveFnf(c, true, approvalRemarks))}>
                {busy ? "Saving…" : "Approve the F&F"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => s.approveFnf(c, false, approvalRemarks))}
              >
                Send it back
              </Button>
              {/* Say what "send it back" DOES, before they click it. */}
              <span className="text-[11.5px] text-grey-2">
                Sending it back re-opens “Generate the F&amp;F” — the case goes straight back into the
                preparer's queue, with the numbers and the working kept.
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">Waiting on approval.</p>
        )}
      </div>

      {/* ======================== 5. RELEASE PAYMENT ======================== */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>5 · Release the payment</SectionHeading>
          {c.fnfPaidAt ? (
            <Done label="Paid" />
          ) : (
            c.fnfApprovedAt && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "fnf_payment")} />
              </span>
            )
          )}
        </div>

        {skipOf("fnf_payment") ? (
          <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
            <span className="font-semibold">Waived</span> — {skipOf("fnf_payment")!.reason}
          </p>
        ) : !done("fnf_approve") ? (
          <Locked>the F&amp;F has not been approved. Money does not leave on an unapproved settlement.</Locked>
        ) : may("fnf_payment") || c.fnfPaidAt ? (
          <div className="space-y-3.5">
            {c.fnfPaidAt && (
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Paid on" value={formatDateDMY(st?.fnfPaidOn)} />
                <Field label="Mode" value={st?.fnfPaymentMode} />
                <Field label="Reference" value={st?.fnfPaymentRef} />
                <Field label="Released by" value={person(st?.fnfPaidById ?? null)} />
                {st?.finalFnfPath && (
                  <Field className="sm:col-span-4" label="The employee's copy">
                    <button
                      type="button"
                      onClick={() => void openDoc(st.finalFnfPath!)}
                      className="font-semibold text-orange hover:underline"
                    >
                      {st.finalFnfName ?? "Open"} →
                    </button>
                  </Field>
                )}
              </div>
            )}

            {may("fnf_payment") && (
              <>
                <div className="grid gap-3.5 sm:grid-cols-3">
                  <FieldLabel label="How it was paid">
                    <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {PAYMENT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </FieldLabel>
                  <FieldLabel label="Reference" hint="UTR / cheque no.">
                    <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
                  </FieldLabel>
                  <FieldLabel label="Paid on">
                    <TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </FieldLabel>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-navy">
                    The employee's copy of the final F&amp;F
                  </span>
                  <input
                    type="file"
                    onChange={(e) => setFinalFile(e.target.files?.[0] ?? null)}
                    className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
                  />
                  <span className="mt-1 block text-[11.5px] text-grey-2">
                    Stored under <code>cases/…/share/</code> — <span className="font-semibold">not</span>{" "}
                    <code>fnf/</code>. It is the one prefix the leaver can open, and they are entitled to
                    their own statement. (The case cannot be archived without it.)
                  </span>
                </label>

                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const up = finalFile ? await uploadFinalFnfDoc(c.id, finalFile) : null;
                      await s.releaseFnfPayment(c, {
                        paymentMode: mode,
                        paymentRef: ref.trim() || null,
                        // A business date, straight out of a date input. NEVER toISOString().
                        paidOn: paidOn || null,
                        finalPath: up?.path ?? null,
                        finalName: up?.name ?? null,
                      });
                      setFinalFile(null);
                    })
                  }
                >
                  {busy ? "Saving…" : c.fnfPaidAt ? "Correct the payment" : "Record the payment"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">Waiting on accounts to release the payment.</p>
        )}
      </div>

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
