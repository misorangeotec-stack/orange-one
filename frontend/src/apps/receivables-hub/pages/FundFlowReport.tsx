import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx-js-style";
import { jsPDF } from "jspdf";
import {
  AlertTriangle, BellRing, CalendarClock, Download, FileUp, History, Landmark, Lock, LockOpen, RefreshCw, Settings2, Wallet,
} from "lucide-react";
import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { Badge } from "@hub/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hub/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hub/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hub/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/components/ui/table";
import { useToast } from "@hub/hooks/use-toast";
import { cn } from "@hub/lib/utils";
import { useSession } from "@/core/platform/session";
import { useAppData } from "@hub/lib/useAppData";
import { useCollectionPlan } from "@hub/lib/useCollectionPlan";
import { useReceivablesScope } from "@hub/lib/scope";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { FfDirtyContext, FfGrid, type CalcDef, type FieldDef } from "@hub/components/fundflow/FfGrid";
import type { TableColumn } from "@hub/components/GridTable";
import {
  BLOCKS, HEAD_META, addMonths, fmtCr, fmtInr, fmtPct, lineValues, monthLabel, monthLong, monthWindow,
  openingDate, planBridge, summarise, todayIst, type FfHead, type Fig, type PlanBridge,
} from "@hub/lib/fundFlowCalc";
import {
  FF_KEY, approveLines, approvePlan, closeMonth, fetchRole, finalApprove, housekeep, openMonth, reopenMonth, saveLines, setMonth, useFfRemoved,
  useBankPosition, useFfLines, useFfLog, useFfMonths, type FfDecision, type FfLine, type FfMonth, type FfSaveItem,
} from "@hub/lib/fundFlow";
import { parseFundFlowPack, type ImportResult } from "@hub/lib/fundFlowImport";
import { downloadFundFlowWorkbook } from "@hub/lib/exportFundFlow";
import { ageBucket, ledgerGuidOf, loadVendorsDue, tallyPaidInMonth, type VendorDue, type VendorDueResult } from "@hub/lib/fundFlowTally";
import { collectionMonthTotals } from "@hub/lib/collectionMonthTotals";
import { KIND_LABEL, planChanges } from "@hub/lib/fundFlowPlan";

/**
 * Reports → Finance → Budgeted Fund Flow.
 *
 * The monthly fund flow budget, entered and approved in Hub instead of "0F_<MON> Cashflow.xlsx":
 * opening balance, payments by head, receipts, closing — every line Budgeted / Approved / Paid /
 * Balance / Achieved %, and the same 12-sheet Excel pack (with live formulas) on Download.
 *
 * Rules (user, 24-Oct-2026), enforced in the database (migration 20270217120000_fund_flow.sql) —
 * the page only hides what a user cannot do:
 *   - a month opens 2 days before the previous month ends and closes on the 2nd of the next
 *     month (3rd when the 2nd is a Sunday); outside that it is read-only unless the CFO reopens it
 *   - unpaid Import Due, Import Advance and Customs Duty lines carry forward at their balance;
 *     everything else is copied as an editable list
 *   - Approved is the CFO's, after the management discussion
 *   - Other Vendor lines can be pulled from Tally's bills due; Customer Collections is linked to the
 *     Salesperson Collection Report; the opening balance is the Daily Report bank total
 */

type Tab = "mgmt" | "summary" | "approval" | "notapproved" | "plan" | FfHead | "tax" | "collections" | "log";

const usdCalcs: CalcDef[] = [
  { key: "binr", label: "INR Budgeted", value: (v) => v.budgetInr },
  { key: "ainr", label: "INR Approved", value: (v) => v.approvedInr },
  { key: "pinr", label: "INR Paid", value: (v) => v.paidInr },
  { key: "ubal", label: "USD Balance", value: (v) => v.balanceInr / v.fx, fmt: "usd" },
  { key: "bal", label: "INR Balance", value: (v) => v.balanceInr },
  { key: "ach", label: "Achieved %", value: (v) => v.achieved, fmt: "pct" },
];
// Advances: the same figures under the Advances sheet's own headings.
const advCalcs: CalcDef[] = usdCalcs.map((c) => ({
  ...c, label: ({ binr: "Budgeted (INR)", pinr: "Paid (INR)", bal: "Balance (INR)" } as Record<string, string>)[c.key] ?? c.label,
}));
const inrCalcs: CalcDef[] = [
  { key: "bal", label: "INR Balance", value: (v) => v.balanceInr },
  { key: "ach", label: "Achieved %", value: (v) => v.achieved, fmt: "pct" },
];
const machineCalcs: CalcDef[] = [
  { key: "bal", label: "Pending (INR)", value: (v) => v.balanceInr },
  { key: "ach", label: "Achieved %", value: (v) => v.achieved, fmt: "pct" },
];

/**
 * Column order of each sheet, exactly as the Excel pack (user, 24-Oct-2026). Hub-only columns sit
 * where they read best: Company after the vendor, the duty-mode inputs beside the duty, the CFO's
 * Approved where the sheet has its Approved, and Not this month / Paid in full beside Paid.
 */
const INR_LAYOUT = ["line_type", "party", "company", "amt_budget", "approval", "amt_paid", "bal", "remarks", "ach"];
const LAYOUT: Partial<Record<FfHead, string[]>> = {
  import_due: ["line_type", "party", "company", "amt_budget", "binr", "approval", "ainr", "amt_paid", "pinr", "ubal", "bal", "remarks", "ach"],
  import_advance: ["block", "party", "ref_no", "description", "company", "amt_budget", "binr", "approval", "ainr", "amt_paid", "pinr", "ubal", "bal",
    "terms", "status_note", "ach"],
  customs_duty: ["company", "doc_date", "party", "ref_no", "item", "description", "inv_usd", "invinr", "duty_mode", "duty_pct", "duty_typed_inr",
    "duty", "freight_inr", "extra_inr", "total", "approval", "not_this_month", "paid_in_full", "amt_paid", "bal", "remarks"],
  emi: ["line_type", "party", "company", "amt_budget", "approval", "amt_paid", "bal", "loan_os", "remarks", "ach"],
  other_vendor: INR_LAYOUT,
  local_advance: INR_LAYOUT,
  investment: INR_LAYOUT,
  fixed_expense: INR_LAYOUT,
  machine_advance: ["sales_person", "party", "machine", "amt_budget", "approval", "amt_paid", "bal", "expected_date", "follow_up", "ach"],
  refund: ["line_type", "amt_budget", "approval", "amt_paid", "bal", "remarks", "ach"],
};
const TAX_LAYOUT = ["head", "party", "company", "amt_budget", "approval", "amt_paid", "bal", "remarks", "ach"];

const F = {
  type: { key: "line_type", label: "Type", kind: "text", head: "min-w-[130px]", freeze: "wide1" },
  party: { key: "party", label: "Vendor / Description", kind: "text", head: "min-w-[220px]", freeze: "wide2" },
  company: { key: "company", label: "Company", kind: "company", head: "min-w-[110px]" },
  usdB: { key: "amt_budget", label: "USD Budgeted", kind: "usd", amount: true },
  usdP: { key: "amt_paid", label: "USD Paid", kind: "usd" },
  inrB: { key: "amt_budget", label: "INR Budgeted", kind: "inr", amount: true },
  inrP: { key: "amt_paid", label: "INR Paid", kind: "inr" },
  remarks: { key: "remarks", label: "Remarks", kind: "text", head: "min-w-[180px]" },
} satisfies Record<string, FieldDef>;

const FIELDS: Partial<Record<FfHead, FieldDef[]>> = {
  import_due: [F.type, F.party, F.company, F.usdB, F.usdP, F.remarks],
  // User layout (24-Oct-2026): Block + Party frozen on the left, no "For" column, Payment Terms
  // and Status / Paid date at the far right, full text wrapped rather than cut.
  import_advance: [
    { key: "block", label: "Block", kind: "block", freeze: "first" },
    { ...F.party, label: "Party", freeze: "second" },
    { key: "ref_no", label: "PI No.", kind: "text" }, { key: "description", label: "Description", kind: "text", head: "min-w-[220px]" },
    F.company, { ...F.usdB, label: "Amount (USD)" }, { ...F.usdP, label: "Paid (USD)" },
    { key: "terms", label: "Payment Terms", kind: "text", head: "min-w-[260px]", tail: true },
    { key: "status_note", label: "Status / Paid date", kind: "text", head: "min-w-[200px]", tail: true },
  ],
  customs_duty: [
    // Frozen up to Item while the figures scroll (user, 24-Oct-2026).
    { ...F.company, freeze: "cd1" }, { key: "doc_date", label: "Date", kind: "date", freeze: "cd2" },
    { ...F.party, label: "Party", freeze: "cd3" },
    { key: "ref_no", label: "Invoice No.", kind: "text", freeze: "cd4" }, { key: "item", label: "Item", kind: "text", freeze: "cd5" },
    { key: "description", label: "Description", kind: "text", head: "min-w-[180px]" },
    { key: "inv_usd", label: "Inv. Value (USD)", kind: "usd", amount: true },
    { key: "duty_mode", label: "Duty formula", kind: "duty_mode", head: "min-w-[150px]", amount: true },
    { key: "duty_pct", label: "Duty %", kind: "pct", amount: true },
    { key: "freight_inr", label: "Freight (INR)", kind: "inr", amount: true },
    { key: "duty_typed_inr", label: "Duty typed (INR)", kind: "inr", amount: true },
    { key: "extra_inr", label: "Extra (INR)", kind: "inr", amount: true },
    // At the far right, after the totals and approval (user, 24-Oct-2026).
    { key: "not_this_month", label: "Not this month", kind: "bool", amount: true, tail: true },
    { key: "paid_in_full", label: "Paid in full", kind: "bool", tail: true },
    { key: "amt_paid", label: "Paid (INR)", kind: "inr", tail: true },
    { ...F.remarks, head: "min-w-[260px]", tail: true },
  ],
  emi: [F.type, { ...F.party, label: "Loan / Description" }, F.company, F.inrB, F.inrP, { key: "loan_os", label: "Loan O/s", kind: "inr" }, F.remarks],
  other_vendor: [F.type, F.company, F.party, F.inrB, F.inrP, F.remarks],
  local_advance: [F.type, F.company, F.party, F.inrB, F.inrP, F.remarks],
  investment: [F.type, F.company, F.party, F.inrB, F.inrP, F.remarks],
  fixed_expense: [F.type, F.company, F.party, F.inrB, F.inrP, F.remarks],
  machine_advance: [
    { key: "sales_person", label: "Sales Person", kind: "text", freeze: "wide1" }, { ...F.party, label: "Customer Name" },
    { key: "machine", label: "Machine", kind: "text" }, { ...F.inrB, label: "Projected (INR)" }, { ...F.inrP, label: "Received (INR)" },
    { key: "expected_date", label: "Expected date", kind: "date" }, { key: "follow_up", label: "Follow-up note", kind: "text", head: "min-w-[160px]" },
  ],
  refund: [{ ...F.type, freeze: undefined }, F.inrB, { ...F.inrP, label: "Received (INR)" }, F.remarks],
};
const TAX_FIELDS: FieldDef[] = [F.company, { ...F.party, freeze: undefined }, F.inrB, F.inrP, F.remarks];

const customsCalcs: CalcDef[] = [
  { key: "invinr", label: "Inv. Value (INR)", value: (v) => v.invInr ?? 0 },
  { key: "duty", label: "Duty+GST Payable (INR)", value: (v) => v.dutyInr ?? 0 },
  { key: "total", label: "Total (INR)", value: (v) => v.budgetInr },
  { key: "bal", label: "Balance (INR)", value: (v) => v.balanceInr },
];

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}-${y.slice(2)}`;
};
const minIso = (a: string, b: string) => (a < b ? a : b);
const GENERIC_WORDS = new Set([
  "THE", "AND", "CO", "COMPANY", "LIMITED", "LTD", "PVT", "PRIVATE", "INDIA", "INTERNATIONAL", "INTL", "INDUSTRIAL",
  "INDUSTRY", "INDUSTRIES", "TRADING", "GROUP", "CHEMICAL", "CHEMICALS", "DIGITAL", "TECHNOLOGY", "TECH", "MACHINERY",
  "PRINTING", "MATERIALS", "NEW", "DUES", "DUE", "UPTO", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP",
  "SEPT", "OCT", "NOV", "DEC", "INK", "PAPER", "HONG", "KONG",
]);
const monthEnd = (m: string) => openingDate(addMonths(m, 1));

/* ============================================================== the page == */

export default function FundFlowReport() {
  const { user } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const roleQ = useQuery({ queryKey: [...FF_KEY, "role", user.id], queryFn: () => fetchRole(user.id) });
  const role = roleQ.data ?? "none";
  const isCfo = role === "cfo";
  const isDirector = role === "director";
  const canWrite = role === "cfo" || role === "editor";

  // Housekeeping once per visit: opens the month whose window began, closes those whose window ended.
  const hkDone = useRef(false);
  useEffect(() => {
    if (!roleQ.data || roleQ.data === "none" || hkDone.current) return;
    hkDone.current = true;
    housekeep().then((r) => { if (Object.keys(r).length) qc.invalidateQueries({ queryKey: FF_KEY }); }).catch(() => undefined);
  }, [roleQ.data, qc]);

  const monthsQ = useFfMonths(role !== "none");
  const months = monthsQ.data ?? [];
  const today = todayIst();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? (months.find((m) => m.month === thisMonth)?.month ?? months[0]?.month ?? null);
  const m = months.find((x) => x.month === month) ?? null;
  const linesQ = useFfLines(month);
  const prevMonth = month ? addMonths(month, -1) : null;
  const prevM = months.find((x) => x.month === prevMonth) ?? null;
  const prevLinesQ = useFfLines(prevM ? prevMonth : null);
  const [tab, setTab] = useState<Tab>("mgmt");
  const [saving, setSaving] = useState(false);

  const win = month ? monthWindow(month) : null;
  const locked = Boolean(m?.plan_approved_at);
  const editable = Boolean(m && canWrite && m.status === "open" && (m.reopened || (win && today >= win.opensOn && today <= win.closesOn)));

  const openIso = month ? openingDate(month) : null;
  const bankOpenQ = useBankPosition(openIso);
  const memoIso = month ? minIso(today, monthEnd(month)) : null;
  const bankMemoQ = useBankPosition(memoIso);
  const opening = m?.opening_override ?? bankOpenQ.data?.total_inr ?? 0;

  const lines = linesQ.data ?? [];
  const rate = m?.std_rate ?? 95;
  const sum = useMemo(() => summarise(lines.map((l) => ({ head: l.head, values: lineValues(l, rate, l.plan_locked) })), opening), [lines, rate, opening]);
  const prevSum = useMemo(() => {
    if (!prevM || !prevLinesQ.data) return null;
    return summarise(prevLinesQ.data.map((l) => ({ head: l.head, values: lineValues(l, prevM.std_rate, l.plan_locked) })), 0);
  }, [prevM, prevLinesQ.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: FF_KEY });
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await fn();
      toast({ title: what });
      await refresh();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      await refresh();
    } finally {
      setSaving(false);
    }
  };
  const onSave = (items: FfSaveItem[]) => run(`Saved ${items.length} line${items.length === 1 ? "" : "s"}`, () => saveLines(month!, items));
  const onApprove = (items: FfDecision[]) => run(
    items.every((i) => i.reject) ? `Rejected ${items.length}` : items.every((i) => i.approve_delete) ? `Removed ${items.length}` : `Approved ${items.length} line${items.length === 1 ? "" : "s"}`,
    () => approveLines(month!, items));
  const removedQ = useFfRemoved(month, locked);
  const pending = lines.filter((l) => l.delete_requested || l.changed_after_approval || l.awaiting_approval);
  const notApproved = lines.filter((l) => l.not_approved);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // Unsaved edits, per grid. While any exist, switching tab / month or clicking away asks first
  // (user, 24-Oct-2026: "ask the user to click on save before leaving").
  const [dirtyBy, setDirtyBy] = useState<Record<string, number>>({});
  const reportDirty = useCallback((id: string, n: number) => setDirtyBy((d) => (d[id] === n ? d : { ...d, [id]: n })), []);
  const unsaved = Object.values(dirtyBy).reduce((a, b) => a + b, 0);
  const [leave, setLeave] = useState<{ tab?: Tab; month?: string; href?: string } | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!unsaved) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    // Links inside the Hub navigate without unloading the page, so catch them before React does.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      setLeave({ href: url.pathname + url.search + url.hash });
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [unsaved]);
  const goTab = (t: Tab) => (unsaved ? setLeave({ tab: t }) : setTab(t));
  const goMonth = (mm: string) => (unsaved ? setLeave({ month: mm }) : setPicked(mm));
  const [finalOpen, setFinalOpen] = useState(false);

  if (roleQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (role === "none") {
    return (
      <Card className="m-4 p-6 text-sm">
        You do not have access to the Fund Flow. An admin grants it on the permission screen (report
        <span className="font-mono"> finance-fund-flow</span>) or sets your Fund Flow role.
      </Card>
    );
  }

  const linesOf = (heads: FfHead[]) => lines.filter((l) => heads.includes(l.head));
  const exportPack = () => {
    if (!m) return;
    downloadFundFlowWorkbook({
      month: m, lines, opening, removed: removedQ.data ?? [],
      openingNote: m.opening_override != null ? `override: ${m.opening_reason ?? ""}` : `${shortDate(openIso!)} per Daily Report`,
      bankMemo: bankMemoQ.data ? { asOf: shortDate(memoIso!), total: bankMemoQ.data.total_inr, note: bankNote(bankMemoQ.data) } : null,
      builtBy: user.name ?? user.email ?? "",
    });
  };

  return (
    <div className="space-y-3 p-1">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-0.5">
          <h1 className="text-lg font-semibold">Budgeted Fund Flow</h1>
          <p className="text-xs text-muted-foreground">Opening · payments by head · receipts · closing. Approved is the CFO&apos;s figure; totals run on it.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {months.length > 0 && (
            <Select value={month ?? undefined} onValueChange={(v) => goMonth(v)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                {months.map((x) => <SelectItem key={x.month} value={x.month}>{monthLong(x.month)}{x.status === "closed" ? " (closed)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {isCfo && (
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><FileUp className="h-3.5 w-3.5 mr-1" />Import Excel pack</Button>
          )}
          {m && <Button size="sm" variant="outline" onClick={exportPack}><Download className="h-3.5 w-3.5 mr-1" />Excel (with formulas)</Button>}
          {m && <Button size="sm" variant="outline" onClick={() => managementPdf(m, sum, lines, opening, bankMemoQ.data?.total_inr ?? null, removedQ.data ?? [])}><Download className="h-3.5 w-3.5 mr-1" />PDF summary</Button>}
          <Button size="sm" variant="ghost" onClick={refresh} title="Reload"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {!months.length && !monthsQ.isLoading && (
        <Card className="p-6 text-sm space-y-2">
          <p>No Fund Flow month has been started yet.</p>
          {isCfo ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run(`${monthLong(thisMonth)} started`, () => openMonth(thisMonth))}>Start {monthLong(thisMonth)}</Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>Import an Excel pack</Button>
            </div>
          ) : <p className="text-muted-foreground">The CFO starts the first month; after that each month opens by itself.</p>}
        </Card>
      )}

      {m && win && (
        <>
          {/* ── state banner ─────────────────────────────────────────────── */}
          <Card className={cn("p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs", m.status === "closed" ? "bg-muted/50" : "")}>
            <span className="flex items-center gap-1.5 font-medium">
              {m.status === "closed" ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5 text-emerald-600" />}
              {m.status === "closed" ? `Closed ${m.closed_at ? new Date(m.closed_at).toLocaleDateString("en-GB") : ""}`
                : m.reopened ? "Reopened by the CFO" : editable ? `Open · closes ${shortDate(win.closesOn)}` : today < win.opensOn ? `Opens ${shortDate(win.opensOn)}` : "Window passed"}
            </span>
            <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Window {shortDate(win.opensOn)} → {shortDate(win.closesOn)}</span>
            <span className="flex items-center gap-1.5">Std rate <span className="font-mono font-semibold">{rate}</span> INR/USD
              {m.rate_fixed_at
                ? <Badge variant="outline" className="text-[10px] gap-1" title={`Fixed ${new Date(m.rate_fixed_at).toLocaleDateString("en-GB")} — cannot change for the month`}><Lock className="h-3 w-3" />fixed</Badge>
                : <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700" title="Last month's rate, used until the CFO enters this month's">provisional — not yet entered</Badge>}
            </span>
            <span className="flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" />
              Opening ₹{fmtInr(opening)} {m.opening_override != null ? <Badge variant="outline" className="text-[10px]">override</Badge> : <span className="text-muted-foreground">Daily Report {shortDate(openIso!)}</span>}
            </span>
            <span className="flex items-center gap-1.5">
              {locked
                ? <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">CFO approved {new Date(m.plan_approved_at!).toLocaleDateString("en-GB")}</Badge>
                : <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">Plan not yet approved</Badge>}
              {locked && (m.final_approved_at
                ? <Badge className="text-[10px] bg-emerald-700 hover:bg-emerald-700" title={m.final_note ?? undefined}>Directors approved {new Date(m.final_approved_at).toLocaleDateString("en-GB")}</Badge>
                : <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">Directors&apos; approval pending</Badge>)}
              {notApproved.length > 0 && (
                <button className="underline text-red-700" onClick={() => goTab("notapproved")}>{notApproved.length} not approved</button>
              )}
              {pending.length > 0 && (
                <button className="underline text-amber-800" onClick={() => goTab("approval")}>{pending.length} waiting for the CFO</button>
              )}
            </span>
            <span className="text-muted-foreground">You: {role === "cfo" ? "CFO" : role === "director" ? "Director" : role}</span>
            <div className="ml-auto flex gap-2">
              {isCfo && editable && !locked && (
                <Button size="sm" disabled={saving || !m.rate_fixed_at}
                  title={m.rate_fixed_at ? "Approves every line as budgeted except those you marked Not approved, and fixes the plan. After this, every addition, edit and removal waits for you." : "Enter the month's std rate first (Rate / opening)"}
                  onClick={() => setPlanOpen(true)}>
                  Approve plan
                </Button>
              )}
              {isDirector && locked && !m.final_approved_at && (
                <Button size="sm" disabled={saving} onClick={() => setFinalOpen(true)}>Final approval (Directors)</Button>
              )}
              {isCfo && editable && <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5 mr-1" />Rate / opening</Button>}
              {isCfo && m.status === "open" && <Button size="sm" variant="outline" disabled={saving} onClick={() => run(`${monthLong(m.month)} closed`, () => closeMonth(m.month, null))}><Lock className="h-3.5 w-3.5 mr-1" />Close month</Button>}
              {isCfo && m.status === "closed" && <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)}><LockOpen className="h-3.5 w-3.5 mr-1" />Reopen</Button>}
              {isCfo && !months.find((x) => x.month === addMonths(m.month, 1)) && (
                <Button size="sm" variant="outline" disabled={saving} onClick={() => run(`${monthLong(addMonths(m.month, 1))} opened`, () => openMonth(addMonths(m.month, 1)))}>
                  Open {monthLong(addMonths(m.month, 1))}
                </Button>
              )}
            </div>
          </Card>
          {(isCfo || isDirector) && (
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <BellRing className="h-3 w-3" />
              Reminders by Hub bell and email: month opening and closing (9:30 AM), every Saturday (the working day before if
              Saturday is a holiday) to follow up the editors, and a change summary at 4 PM and 7 PM. Changes after closing or after
              the Directors&apos; approval also go to the Directors.
            </div>
          )}
          {bankOpenQ.data && m.opening_override == null && <BankGaps pos={bankOpenQ.data} label={`Opening (${shortDate(openIso!)})`} />}

          <FfDirtyContext.Provider value={reportDirty}>
          <Tabs key={month} value={tab} onValueChange={(v) => goTab(v as Tab)}>
            <TabsList className="flex flex-wrap h-auto justify-start">
              <TabsTrigger value="mgmt">Management Summary</TabsTrigger>
              <TabsTrigger value="summary">Fund Flow Summary</TabsTrigger>
              <TabsTrigger value="approval">For CFO approval{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
              <TabsTrigger value="notapproved">Not approved{notApproved.length ? ` (${notApproved.length})` : ""}</TabsTrigger>
              <TabsTrigger value="plan">Changes after plan</TabsTrigger>
              <TabsTrigger value="import_due">Import Due</TabsTrigger>
              <TabsTrigger value="import_advance">Advances</TabsTrigger>
              <TabsTrigger value="customs_duty">Customs Duty</TabsTrigger>
              <TabsTrigger value="emi">EMI</TabsTrigger>
              <TabsTrigger value="other_vendor">Other Vendor</TabsTrigger>
              <TabsTrigger value="local_advance">Local Advance</TabsTrigger>
              <TabsTrigger value="tax">Tax and Statutory</TabsTrigger>
              <TabsTrigger value="investment">Capex/Loan/INV</TabsTrigger>
              <TabsTrigger value="fixed_expense">Fixed Expenses</TabsTrigger>
              <TabsTrigger value="machine_advance">Machine Advances</TabsTrigger>
              <TabsTrigger value="collections">Collections</TabsTrigger>
              <TabsTrigger value="log"><History className="h-3.5 w-3.5 mr-1" />Changes</TabsTrigger>
            </TabsList>

            <TabsContent value="mgmt">
              <ManagementSummary m={m} sum={sum} lines={lines} removed={removedQ.data ?? []} opening={opening}
                bankMemo={bankMemoQ.data?.total_inr ?? null} memoIso={memoIso!}
                bankGaps={bankMemoQ.data ? (bankMemoQ.data.accounts.filter((a) => a.missing || a.stale).map((a) => a.label).join(", ") || null) : null} prevSum={prevSum} prevM={prevM} />
            </TabsContent>
            <TabsContent value="summary" className="space-y-3">
              <QuickPosition sum={sum} bank={bankMemoQ.data?.total_inr ?? null} bankIso={memoIso} />
              <SummaryTable sum={sum} label={monthLong(m.month)} />
            </TabsContent>
            <TabsContent value="approval">
              <ApprovalQueue m={m} pending={pending} isCfo={isCfo} editable={editable} saving={saving} onApprove={onApprove} />
            </TabsContent>
            <TabsContent value="notapproved">
              <NotApprovedList m={m} lines={notApproved} isCfo={isCfo} editable={editable} saving={saving} onApprove={onApprove} />
            </TabsContent>
            <TabsContent value="plan"><PlanChanges m={m} lines={lines} removed={removedQ.data ?? []} /></TabsContent>

            {(["import_due", "import_advance", "customs_duty", "emi", "local_advance", "investment", "fixed_expense", "machine_advance"] as FfHead[]).map((h) => (
              <TabsContent key={h} value={h}>
                <FfGrid planLocked={locked} heads={[h]} lines={linesOf([h])} rate={rate} fields={FIELDS[h]!} layout={LAYOUT[h]}
                  calcs={h === "customs_duty" ? customsCalcs : h === "import_advance" ? advCalcs : h === "machine_advance" ? machineCalcs
                    : HEAD_META[h].currency === "USD" ? usdCalcs : inrCalcs}
                  canEdit={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove}
                  newLine={h === "import_advance" ? { block: "mach" } : h === "customs_duty" ? { duty_mode: "freight_in_base" } : undefined}
                  emptyMessage={`No ${HEAD_META[h].label} lines this month.`}
                  above={h === "import_advance" ? <BlockStrip lines={linesOf([h])} rate={rate} /> : undefined} />
              </TabsContent>
            ))}

            <TabsContent value="other_vendor">
              <OtherVendorTab month={m} lines={lines} rate={rate} editable={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove} />
            </TabsContent>
            <TabsContent value="tax">
              <FfGrid planLocked={locked} heads={["tds", "gst"]} lines={linesOf(["tds", "gst"])} rate={rate} fields={TAX_FIELDS} calcs={inrCalcs} layout={TAX_LAYOUT}
                canEdit={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove} emptyMessage="No TDS / GST lines this month." />
            </TabsContent>
            <TabsContent value="collections">
              <CollectionsTab month={m} lines={lines} rate={rate} editable={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove}
                opening={opening} />
            </TabsContent>
            <TabsContent value="log"><ChangeLog month={m.month} /></TabsContent>
          </Tabs>
          </FfDirtyContext.Provider>
        </>
      )}

      {m && settingsOpen && <MonthSettings m={m} onClose={() => setSettingsOpen(false)} onSave={(r, o, why) => run("Month updated", () => setMonth(m.month, r, o, why)).then(() => setSettingsOpen(false))} />}
      {leave && (
        <Dialog open onOpenChange={(x) => !x && setLeave(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Unsaved changes</DialogTitle>
              <DialogDescription>You have {unsaved} unsaved change{unsaved === 1 ? "" : "s"}. Click <b>Save changes</b> first, or they will be lost.</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => {
                const to = leave; setLeave(null); setDirtyBy({});
                if (to.tab) setTab(to.tab); else if (to.month) setPicked(to.month); else if (to.href) navigate(to.href);
              }}>Discard and leave</Button>
              <Button onClick={() => setLeave(null)}>Stay and save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {m && planOpen && (
        <Dialog open onOpenChange={(x) => !x && setPlanOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Approve the {monthLong(m.month)} plan</DialogTitle>
              <DialogDescription>
                {lines.filter((l) => !l.approved_at && !l.not_approved).length} line(s) will be approved as budgeted.{" "}
                {notApproved.length} line(s) you marked Not approved stay as they are: kept, counted 0, listed under Not approved.
                After this the Directors are asked for the final approval, and every later change waits for you.
              </DialogDescription></DialogHeader>
            <DialogFooter><Button variant="ghost" onClick={() => setPlanOpen(false)}>Cancel</Button>
              <Button disabled={saving} onClick={() => run(`${monthLong(m.month)} plan approved — sent to the Directors`, () => approvePlan(m.month)).then(() => setPlanOpen(false))}>Approve plan</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {m && finalOpen && <FinalApproveDialog m={m} sum={sum} notApproved={notApproved.length} saving={saving} onClose={() => setFinalOpen(false)}
        onOk={(note) => run(`${monthLong(m.month)} budget finally approved`, () => finalApprove(m.month, note)).then(() => setFinalOpen(false))} />}
      {m && reopenOpen && <ReasonDialog title={`Reopen ${monthLong(m.month)}`} onClose={() => setReopenOpen(false)}
        onOk={(why) => run(`${monthLong(m.month)} reopened`, () => reopenMonth(m.month, why)).then(() => setReopenOpen(false))} />}
      {importOpen && <ImportDialog months={months} onClose={() => setImportOpen(false)} onDone={(mm) => { setPicked(mm); setImportOpen(false); refresh(); }} />}
    </div>
  );
}

/* ===================================================== summary sheets == */

/**
 * The one-glance position, laid out as the user's own sheet (24-Oct-2026): Opening, Total Payment,
 * Total Collection, Closing; Budgeted (the approved figure) / Paid / Balance / %; then the bank
 * balance as on today against the paid-basis closing, and the difference in red.
 */
function QuickPosition({ sum, bank, bankIso }: { sum: ReturnType<typeof summarise>; bank: number | null; bankIso: string | null }) {
  const num = (x: number | null | undefined) => (x == null ? "" : fmtInr(x));
  const closingBal = sum.opening + sum.totalCollection.balance - sum.totalPayment.balance;
  const diff = bank == null ? null : sum.closingPaid - bank;
  const cell = "py-1.5 px-3 text-right font-mono tabular-nums";
  const rows: { label: string; b: number | null; p: number | null; bal: number | null; pct?: number | null; bold?: boolean }[] = [
    { label: "Opening Balance", b: sum.opening, p: sum.opening, bal: sum.opening },
    { label: "Total Payment", b: sum.totalPayment.approved, p: sum.totalPayment.paid, bal: sum.totalPayment.balance, pct: sum.totalPayment.achieved },
    { label: "Total Collection", b: sum.totalCollection.approved, p: sum.totalCollection.paid, bal: sum.totalCollection.balance, pct: sum.totalCollection.achieved },
    { label: "Closing Balance", b: sum.closingBudget, p: sum.closingPaid, bal: closingBal, bold: true },
  ];
  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted">
            {["", "Budgeted (approved)", "Paid / Received", "Balance", "%"].map((h, i) =>
              <th key={i} className={cn("py-1.5 px-3 font-semibold", i === 0 ? "text-left" : "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={cn("border-t border-border/60", r.bold && "font-semibold")}>
              <td className="py-1.5 px-3">{r.label}</td>
              <td className={cn(cell, r.bold && "bg-yellow-200 dark:bg-yellow-900/40")}>{num(r.b)}</td>
              <td className={cell}>{num(r.p)}</td>
              <td className={cell}>{num(r.bal)}</td>
              <td className={cn(cell, r.pct != null && "bg-yellow-200 dark:bg-yellow-900/40")}>{r.pct == null ? "" : fmtPct(r.pct)}</td>
            </tr>
          ))}
          <tr className="border-t border-border/60 font-semibold">
            <td className="py-1.5 px-3">Balance as on {bankIso ? shortDate(bankIso) : "today"} <span className="font-normal text-muted-foreground">(Daily Report)</span></td>
            <td className={cell} />
            <td className={cn(cell, !bank && "bg-red-200 text-red-800 dark:bg-red-900/40")}>{bank == null ? "not entered" : num(bank)}</td>
            <td className={cell} /><td className={cell} />
          </tr>
          <tr className="border-t border-border/60 font-semibold">
            <td className="py-1.5 px-3">Difference <span className="font-normal text-muted-foreground">(paid-basis closing less bank)</span></td>
            <td className={cell} />
            <td className={cn(cell, diff != null && Math.abs(diff) >= 1 && "bg-red-200 text-red-800 dark:bg-red-900/40")}>{num(diff)}</td>
            <td className={cell} /><td className={cell} />
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function SummaryTable({ sum, label }: { sum: ReturnType<typeof summarise>; label: string }) {
  const row = (title: string, f: Fig, cls = "") => (
    <TableRow className={cls}>
      <TableCell className="py-1.5 text-xs">{title}</TableCell>
      {[f.budget, f.approved, f.paid, f.balance].map((x, i) => <TableCell key={i} className="py-1.5 text-xs text-right font-mono tabular-nums">{fmtInr(x)}</TableCell>)}
      <TableCell className="py-1.5 text-xs text-right">{fmtPct(f.achieved)}</TableCell>
    </TableRow>
  );
  const B = sum.byHead;
  const sec = (t: string) => <TableRow className="bg-[#39628C] hover:bg-[#39628C]"><TableCell colSpan={6} className="py-1 text-xs font-semibold text-white">{t}</TableCell></TableRow>;
  const subCls = "bg-emerald-50 font-semibold";
  const totCls = "bg-emerald-100 font-bold";
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 py-2 text-sm font-semibold">Budgeted Fund Flow Summary - {label}</div>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#33527A] hover:bg-[#33527A]">
            {["Particulars", "Budgeted (INR)", "Approved (INR)", "Paid / Received (INR)", "Balance (INR)", "Achieved %"].map((h, i) =>
              <TableHead key={h} className={cn("text-white text-xs h-8", i > 0 && "text-right")}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="font-semibold"><TableCell className="py-1.5 text-xs">Opening Balance</TableCell>
            {[sum.opening, sum.opening, sum.opening].map((x, i) => <TableCell key={i} className="py-1.5 text-xs text-right font-mono tabular-nums">{fmtInr(x)}</TableCell>)}<TableCell /><TableCell /></TableRow>
          {sec("PAYMENTS")}
          {row(HEAD_META.import_due.label, B.import_due)}
          {row(HEAD_META.import_advance.label, B.import_advance)}
          {row(HEAD_META.local_advance.label, B.local_advance)}
          {row("Subtotal - Import and Local Advance Payments", sum.subA, subCls)}
          {row(HEAD_META.customs_duty.label, B.customs_duty)}
          {row(HEAD_META.emi.label, B.emi)}
          {row(HEAD_META.other_vendor.label, B.other_vendor)}
          {row("Subtotal - Duty, EMI and Other Vendors", sum.subB, subCls)}
          {row("TDS", B.tds)}
          {row("GST", B.gst)}
          {row("Subtotal - Tax and Statutory", sum.subC, subCls)}
          {row(HEAD_META.investment.label, B.investment)}
          {row(HEAD_META.fixed_expense.label, B.fixed_expense)}
          {row("TOTAL PAYMENT", sum.totalPayment, totCls)}
          {sec("RECEIPTS")}
          {row(HEAD_META.machine_advance.label, B.machine_advance)}
          {row(HEAD_META.collection.label, B.collection)}
          {row(HEAD_META.refund.label, B.refund)}
          {row("TOTAL COLLECTION", sum.totalCollection, totCls)}
          <TableRow className={totCls}>
            <TableCell className="py-1.5 text-xs">CLOSING BALANCE (Opening + Collection − Payment)</TableCell>
            <TableCell /><TableCell className="py-1.5 text-xs text-right font-mono tabular-nums">{fmtInr(sum.closingBudget)}</TableCell>
            <TableCell className="py-1.5 text-xs text-right font-mono tabular-nums">{fmtInr(sum.closingPaid)}</TableCell><TableCell /><TableCell />
          </TableRow>
          <TableRow>
            <TableCell className="py-1.5 text-xs">Still to collect less still to pay</TableCell><TableCell /><TableCell /><TableCell />
            <TableCell className="py-1.5 text-xs text-right font-mono tabular-nums">{fmtInr(sum.netToCome)}</TableCell><TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function Tile({ label, value, sub, tone, subTone, alert }: {
  label: string; value: string; sub?: string; tone?: "bad" | "good"; subTone?: "bad"; alert?: boolean;
}) {
  return (
    <Card className={cn("p-3 space-y-0.5", alert && "border-red-500 bg-red-50")}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold font-mono tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-emerald-700")}>{value}</div>
      {sub && <div className={cn("text-[11px]", subTone === "bad" ? "text-destructive font-semibold" : "text-muted-foreground")}>{sub}</div>}
    </Card>
  );
}

function MiniTable({ title, rows, empty }: { title: string; rows: { a: string; b?: string; v: number; v2?: number }[]; empty: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs font-semibold mb-1.5">{title}</div>
      {rows.length === 0 ? <div className="text-xs text-muted-foreground">{empty}</div> : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1 pr-2">{r.a}{r.b && <span className="text-muted-foreground"> · {r.b}</span>}</td>
                <td className="py-1 text-right font-mono tabular-nums whitespace-nowrap">₹{fmtInr(r.v)}</td>
                {r.v2 != null && <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">₹{fmtInr(r.v2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ManagementSummary({ m, sum, lines, removed, opening, bankMemo, bankGaps, memoIso, prevSum, prevM }: {
  m: FfMonth; sum: ReturnType<typeof summarise>; lines: FfLine[]; opening: number; bankMemo: number | null; bankGaps: string | null; memoIso: string;
  prevSum: ReturnType<typeof summarise> | null; prevM: FfMonth | null; removed: FfLine[];
}) {
  const logQ = useFfLog(m.month, true);
  const pay = lines.filter((l) => HEAD_META[l.head].side === "payment");
  const name = (l: FfLine) => l.party || l.description || l.line_type || HEAD_META[l.head].label;
  const topUnpaid = [...pay].filter((l) => l.balance_inr > 0.5).sort((a, b) => b.balance_inr - a.balance_inr).slice(0, 10)
    .map((l) => ({ a: name(l), b: HEAD_META[l.head].sheet, v: l.balance_inr }));
  const over = pay.filter((l) => l.paid_inr > l.approved_inr + 0.5).map((l) => ({ a: name(l), b: HEAD_META[l.head].sheet, v: l.paid_inr - l.approved_inr }));
  const carried = lines.filter((l) => l.carried_from_line_id && HEAD_META[l.head].carries && l.paid_before > 0.005)
    .map((l) => ({ a: name(l), b: HEAD_META[l.head].sheet, v: l.balance_inr }));
  const changed = lines.filter((l) => l.changed_after_approval).map((l) => ({ a: name(l), b: HEAD_META[l.head].sheet, v: l.budget_inr, v2: l.approved_inr }));
  const unapproved = lines.filter((l) => !l.approved_at).length;
  const rateChanges = (logQ.data ?? []).filter((x) => x.action === "month" && x.old_row && x.new_row
    && Number(x.old_row.std_rate) !== Number(x.new_row.std_rate));
  const col = sum.byHead.collection;
  return (
    <div className="space-y-3">
      <QuickPosition sum={sum} bank={bankMemo} bankIso={memoIso} />
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
        <Tile label="Opening balance" value={fmtCr(opening)} />
        <Tile label="Total payment (approved)" value={fmtCr(sum.totalPayment.approved)} sub={`paid ${fmtCr(sum.totalPayment.paid)} · ${fmtPct(sum.totalPayment.achieved)}`} />
        <Tile label="Total collection (target)" value={fmtCr(sum.totalCollection.approved)} sub={`received ${fmtCr(sum.totalCollection.paid)} · ${fmtPct(sum.totalCollection.achieved)}`} />
        <Tile label="Closing (approved basis)" value={fmtCr(sum.closingBudget)} tone={sum.closingBudget < 0 ? "bad" : undefined} />
        <Tile label="Closing (paid basis)" value={fmtCr(sum.closingPaid)} />
        {/* Red when the bank is zero / not entered, or does not agree with the paid-basis closing
            (user, 24-Oct-2026). The same check is emailed each morning to the CFO and Dimple. */}
        <Tile label={`Bank balance ${shortDate(memoIso)} (Daily Report)`} value={bankMemo == null ? "—" : fmtCr(bankMemo)}
          tone={!bankMemo || bankGaps ? "bad" : undefined}
          alert={!bankMemo || Boolean(bankGaps) || (bankMemo != null && Math.abs(sum.closingPaid - bankMemo) >= 1)}
          sub={bankMemo == null ? "No Daily Report entry" : [
            !bankMemo ? "ZERO on the Daily Report" : "",
            bankGaps ? `not entered: ${bankGaps}` : "",
            `paid-basis closing less bank ₹${fmtInr(sum.closingPaid - bankMemo)}`,
          ].filter(Boolean).join(" · ")}
          subTone={!bankMemo || bankGaps || Math.abs(sum.closingPaid - (bankMemo ?? 0)) >= 1 ? "bad" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {unapproved > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700">{unapproved} line(s) not yet approved by the CFO</Badge>}
        {changed.length > 0 && <Badge variant="destructive">{changed.length} line(s) changed after approval</Badge>}
        {rateChanges.map((x) => (
          <Badge key={x.id} variant="outline">Rate changed {String(x.old_row!.std_rate)} → {String(x.new_row!.std_rate)} on {new Date(x.at).toLocaleDateString("en-GB")}</Badge>
        ))}
        {col.approved > 0 && <Badge variant="outline">Collection shortfall vs target ₹{fmtInr(Math.max(0, col.approved - col.paid))}</Badge>}
        {prevSum && prevM && (
          <Badge variant="outline" title="Last month's paid-basis movement; compare with this month's opening">
            {monthLong(prevM.month)}: collected − paid ₹{fmtInr(prevSum.totalCollection.paid - prevSum.totalPayment.paid)}
          </Badge>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <MiniTable title="Top 10 approved payments still unpaid" rows={topUnpaid} empty="Nothing approved is left to pay." />
        <MiniTable title="Paid more than approved" rows={over} empty="No line is over its approved amount." />
        <MiniTable title="Carried from earlier months, part-paid" rows={carried} empty="No part-paid carried lines." />
        <MiniTable title="Budget changed after approval (budget · approved)" rows={changed} empty="None." />
      </div>
      {m.plan_approved_at && <BridgeCard bridge={planChanges(m, lines, removed).bridge} />}
      <SummaryTable sum={sum} label={monthLong(m.month)} />
    </div>
  );
}

/** Plan → current approved, in one line of tiles. */
function BridgeCard({ bridge: b }: { bridge: PlanBridge }) {
  const cell = (label: string, v: number, sub?: string, tone?: "bad" | "good") => (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold font-mono tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-emerald-700")}>₹{fmtInr(v)}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
  return (
    <Card className="p-3">
      <div className="text-xs font-semibold mb-2">Changes after plan — approved payments and receipts together</div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {cell("Approved plan", b.plan)}
        {cell("+ Added after plan", b.added, b.pendingAdd ? `₹${fmtInr(b.pendingAdd)} more awaiting CFO` : undefined, b.added > 0.5 ? "bad" : undefined)}
        {cell("− Removed from plan", b.removed, b.pendingRemove ? `₹${fmtInr(b.pendingRemove)} removal asked` : undefined)}
        {cell("± Amounts changed", b.changed, b.pendingChange ? `₹${fmtInr(b.pendingChange)} change awaiting CFO` : undefined)}
        {cell("= Approved now", b.current)}
      </div>
    </Card>
  );
}

/** Everything waiting for the CFO, across every head, with the decision buttons. */
function ApprovalQueue({ m, pending, isCfo, editable, saving, onApprove }: {
  m: FfMonth; pending: FfLine[]; isCfo: boolean; editable: boolean; saving: boolean; onApprove: (i: FfDecision[]) => Promise<void>;
}) {
  const rate = m.std_rate;
  const can = isCfo && editable;
  const kind = (l: FfLine) => (l.delete_requested ? "Removal asked" : l.approved_at ? "Changed after approval" : m.plan_approved_at ? "Added after plan" : "Not yet approved");
  if (!m.plan_approved_at) {
    return (
      <Card className="p-4 text-sm space-y-1">
        <div>The {monthLong(m.month)} plan is not approved yet. The CFO approves it with <b>Approve plan</b> in the bar above.</div>
        <div className="text-muted-foreground text-xs">Until then lines can be added and changed freely. After it, every addition, change and removal comes here for the CFO.</div>
      </Card>
    );
  }
  const approvable = pending.filter((l) => !l.delete_requested);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="text-sm font-semibold">For CFO approval — {pending.length} item(s)</div>
        {can && approvable.length > 0 && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={saving} onClick={() => onApprove(approvable.map((l) => ({ id: l.id })))}>
            Approve all additions and changes ({approvable.length})
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted">
            {["What", "Sheet", "Line", "Approved now (INR)", "Asked (INR)", "Difference", "By / remarks", ""].map((h, i) =>
              <TableHead key={i} className={cn("h-8 text-xs", i >= 3 && i <= 5 && "text-right")}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending.map((l) => {
            const v = lineValues(l, rate, true);
            const asked = l.delete_requested ? 0 : v.budgetInr;
            return (
              <TableRow key={l.id}>
                <TableCell className="py-1 text-xs"><Badge variant={l.delete_requested ? "destructive" : "outline"} className="text-[10px]">{kind(l)}</Badge></TableCell>
                <TableCell className="py-1 text-xs">{HEAD_META[l.head].sheet}</TableCell>
                <TableCell className="py-1 text-xs">{l.party || l.description || l.line_type}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(v.approvedInr)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(asked)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(asked - v.approvedInr)}</TableCell>
                <TableCell className="py-1 text-xs text-muted-foreground">{l.remarks ?? ""}</TableCell>
                <TableCell className="py-1 text-xs whitespace-nowrap">
                  {can && (l.delete_requested ? (
                    <>
                      <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px] mr-1" disabled={saving} onClick={() => onApprove([{ id: l.id, approve_delete: true }])}>Remove</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => onApprove([{ id: l.id, reject: true }])}>Keep</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" className="h-7 px-2 text-[11px] mr-1" disabled={saving} onClick={() => onApprove([{ id: l.id }])}>Approve</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => onApprove([{ id: l.id, reject: true }])}>Reject</Button>
                    </>
                  ))}
                </TableCell>
              </TableRow>
            );
          })}
          {pending.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">Nothing is waiting for the CFO.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        Reject: an addition is removed, a change goes back to the approved budget, a removal request is cleared. To approve a different amount, use the Approved column on the line&apos;s own tab.
      </div>
    </Card>
  );
}

/** The report: what was added, removed and changed after the plan, with the bridge. */
function PlanChanges({ m, lines, removed }: { m: FfMonth; lines: FfLine[]; removed: FfLine[] }) {
  if (!m.plan_approved_at) {
    return <Card className="p-4 text-sm">The plan is not approved yet — this report starts from the moment the CFO approves it.</Card>;
  }
  const { rows, bridge } = planChanges(m, lines, removed);
  return (
    <div className="space-y-3">
      <BridgeCard bridge={bridge} />
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 text-sm font-semibold">Lines that are not as planned — plan approved {new Date(m.plan_approved_at).toLocaleString("en-IN")}</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted">
              {["Change", "Sheet", "Line", "In plan (INR)", "Approved now (INR)", "Effect (INR)", "Budget typed (INR)", "Status"].map((h, i) =>
                <TableHead key={h} className={cn("h-8 text-xs", i >= 3 && i <= 6 && "text-right")}>{h}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="py-1 text-xs"><Badge variant={r.kind === "removed" ? "destructive" : "outline"} className="text-[10px]">{KIND_LABEL[r.kind]}</Badge></TableCell>
                <TableCell className="py-1 text-xs">{r.sheet}</TableCell>
                <TableCell className="py-1 text-xs">{r.name}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(r.plan)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(r.approved)}</TableCell>
                <TableCell className={cn("py-1 text-xs text-right font-mono tabular-nums", r.effect > 0.5 && "text-destructive")}>{fmtInr(r.effect)}</TableCell>
                <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(r.budget)}</TableCell>
                <TableCell className="py-1 text-xs">{r.status}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">Everything is as planned.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function BlockStrip({ lines, rate }: { lines: FfLine[]; rate: number }) {
  return (
    <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
      {BLOCKS.map((b) => {
        const rows = lines.filter((l) => l.block === b.block);
        const s = summarise(rows.map((l) => ({ head: l.head, values: lineValues(l, rate, l.plan_locked) })), 0).byHead.import_advance;
        return (
          <Card key={b.block} className="p-2 text-xs">
            <div className="font-medium truncate" title={b.label}>{b.short} <span className="font-normal text-muted-foreground">{b.label.replace("Advances - ", "")}</span></div>
            <div className="font-mono tabular-nums">₹{fmtInr(s.approved)} <span className="text-muted-foreground">paid ₹{fmtInr(s.paid)} · {fmtPct(s.achieved)}</span></div>
          </Card>
        );
      })}
    </div>
  );
}

function bankNote(p: { accounts: { label: string; stale: boolean; missing: boolean; date: string | null }[] }): string {
  const stale = p.accounts.filter((a) => a.stale).map((a) => `${a.label} (${a.date})`);
  const missing = p.accounts.filter((a) => a.missing).map((a) => a.label);
  return [stale.length ? `Earlier day used: ${stale.join(", ")}` : "", missing.length ? `Not recorded: ${missing.join(", ")}` : ""].filter(Boolean).join("; ");
}

function BankGaps({ pos, label }: { pos: { accounts: { label: string; stale: boolean; missing: boolean; date: string | null }[] }; label: string }) {
  const note = bankNote(pos);
  if (!note) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{label} from the Daily Report — {note}. Missing accounts are not counted as zero; ask for the entry or set an override.</span>
    </div>
  );
}

/* ============================================================ vendors == */

function OtherVendorTab({ month, lines, rate, editable, isCfo, saving, onSave, onApprove }: {
  month: FfMonth; lines: FfLine[]; rate: number; editable: boolean; isCfo: boolean; saving: boolean;
  onSave: (i: FfSaveItem[]) => Promise<void>; onApprove: (i: FfDecision[]) => Promise<void>;
}) {
  const { toast } = useToast();
  const [pullOpen, setPullOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = Boolean(month.plan_approved_at);
  const own = lines.filter((l) => l.head === "other_vendor");
  const linked = own.filter((l) => l.tally_ledger && l.tally_company_guid);

  /** Re-read Tally due and Tally paid for every linked line, and save them with their time. */
  const refreshTally = async () => {
    setBusy(true);
    try {
      const due = await loadVendorsDue(month.month, monthEnd(month.month));
      const byKey = new Map(due.vendors.map((v) => [`${v.book.companyGuid}|${v.ledger}`, v]));
      const items: FfSaveItem[] = [];
      for (const l of linked) {
        const v = byKey.get(`${l.tally_company_guid}|${l.tally_ledger}`);
        const book = due.vendors.find((x) => x.book.companyGuid === l.tally_company_guid)?.book
          ?? due.refreshedAt.find((x) => x.book.companyGuid === l.tally_company_guid)?.book;
        let guid = l.tally_ledger_guid;
        let paid: number | null = null;
        if (book) {
          guid = guid ?? await ledgerGuidOf(book.tenant, l.tally_ledger!);
          if (guid) paid = (await tallyPaidInMonth(book.tenant, guid, month.month, monthEnd(month.month))).paid;
        }
        items.push({
          id: l.id, expected_updated_at: l.updated_at, tally_ledger_guid: guid,
          tally_due_inr: v?.due ?? 0, tally_due_as_at: due.readAt,
          ...(paid != null ? { tally_paid_inr: paid, tally_paid_as_at: new Date().toISOString() } : {}),
        });
      }
      if (due.failed.length) toast({ title: "Some companies could not be read", description: due.failed.map((f) => `${f.book.companyName}: ${f.error}`).join("; "), variant: "destructive" });
      if (items.length) await onSave(items);
    } catch (e) {
      toast({ title: "Tally not available", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const extra = useMemo<TableColumn<FfLine>[]>(() => [
    { key: "tdue", label: "Tally due", right: true, filter: false, head: "min-w-[110px]",
      value: (l) => (l.tally_due_inr == null ? "" : fmtInr(l.tally_due_inr)), sortValue: (l) => l.tally_due_inr ?? -Infinity,
      cell: (l) => l.tally_ledger
        ? <span title={l.tally_due_as_at ? `as at ${new Date(l.tally_due_as_at).toLocaleString("en-IN")}` : "not read yet"}>{l.tally_due_inr == null ? "—" : fmtInr(l.tally_due_inr)}</span>
        : <span className="text-muted-foreground">—</span> },
    { key: "tpaid", label: "Tally paid this month", right: true, filter: false, head: "min-w-[140px]",
      value: (l) => (l.tally_paid_inr == null ? "" : fmtInr(l.tally_paid_inr)), sortValue: (l) => l.tally_paid_inr ?? -Infinity,
      cell: (l) => {
        if (!l.tally_ledger) return <span className="text-muted-foreground">—</span>;
        if (l.tally_paid_inr == null) return <span className="text-muted-foreground">not read</span>;
        const differs = Math.abs((l.amt_paid ?? 0) - l.tally_paid_inr) > 0.5;
        return (
          <span className="inline-flex items-center gap-1" title={l.tally_paid_as_at ? `as at ${new Date(l.tally_paid_as_at).toLocaleString("en-IN")}` : undefined}>
            {fmtInr(l.tally_paid_inr)}
            {editable && differs && (
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={saving}
                onClick={() => onSave([{ id: l.id, expected_updated_at: l.updated_at, amt_paid: l.tally_paid_inr, paid_source: "tally" }])}>Use</Button>
            )}
          </span>
        );
      } },
  ], [editable, saving, onSave]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {editable && <Button size="sm" onClick={() => setPullOpen(true)}><Wallet className="h-3.5 w-3.5 mr-1" />Pull vendors due from Tally</Button>}
        {editable && linked.length > 0 && (
          <Button size="sm" variant="outline" disabled={busy || saving} onClick={refreshTally}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", busy && "animate-spin")} />Refresh Tally due &amp; paid ({linked.length})
          </Button>
        )}
        <span className="self-center text-xs text-muted-foreground">Tally figures are saved on the line with the time they were read, so a closed month never moves.</span>
      </div>
      <FfGrid planLocked={locked} heads={["other_vendor"]} lines={own} rate={rate} fields={FIELDS.other_vendor!} calcs={inrCalcs} layout={LAYOUT.other_vendor}
        canEdit={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove}
        extraColumns={extra} emptyMessage="No vendor lines this month — pull them from Tally or add a line." />
      {pullOpen && <VendorPull month={month} lines={lines} onClose={() => setPullOpen(false)}
        onAdd={async (items) => { await onSave(items); setPullOpen(false); }} />}
    </div>
  );
}

function VendorPull({ month, lines, onClose, onAdd }: {
  month: FfMonth; lines: FfLine[]; onClose: () => void; onAdd: (items: FfSaveItem[]) => Promise<void>;
}) {
  const end = monthEnd(month.month);
  const q = useQuery<VendorDueResult>({ queryKey: [...FF_KEY, "vendors-due", month.month], queryFn: () => loadVendorsDue(month.month, end), staleTime: 5 * 60_000 });
  const [showOther, setShowOther] = useState(false);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");

  const listed = useMemo(() => new Set(lines.filter((l) => l.tally_ledger).map((l) => `${l.tally_company_guid}|${l.tally_ledger}`)), [lines]);
  // Suppliers already budgeted on another head (import dues / advances / duty agents), by name.
  // A party is its first two DISTINCTIVE words — generic words ("CHEMICAL", "LIMITED") and month
  // labels are dropped — and a vendor matches only when it carries all of them, so "SUN CHEMICAL"
  // does not hide every chemical supplier and "SHANGHAI HEXUAN" does not hide all of Shanghai.
  const otherHeadNames = useMemo(() => {
    const out: string[][] = [];
    for (const l of lines) {
      if (!["import_due", "import_advance", "customs_duty"].includes(l.head) || !l.party) continue;
      const words = l.party.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/)
        .filter((x) => x.length > 2 && !GENERIC_WORDS.has(x)).slice(0, 2);
      if (words.length) out.push(words);
    }
    return out;
  }, [lines]);
  const key = (v: VendorDue) => `${v.book.companyGuid}|${v.ledger}`;
  const isOtherHead = (v: VendorDue) => {
    const name = ` ${v.ledger.toUpperCase().replace(/[^A-Z ]/g, " ")} `;
    return otherHeadNames.some((ws) => ws.every((w) => name.includes(` ${w} `) || name.replace(/\s+/g, "").includes(w)));
  };
  const vendors = (q.data?.vendors ?? []).filter((v) => (showOther || !isOtherHead(v)) && (!search || v.ledger.toLowerCase().includes(search.toLowerCase())));
  const defaultTicked = useMemo(() => new Set((q.data?.vendors ?? [])
    .filter((v) => !listed.has(key(v)) && !isOtherHead(v) && ageBucket(v.oldestDays) !== "180+").map(key)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [q.data, listed]);
  const sel = ticked ?? defaultTicked;
  const chosen = (q.data?.vendors ?? []).filter((v) => sel.has(key(v)) && !listed.has(key(v)));

  const add = () => onAdd(chosen.map((v, i) => ({
    id: null, head: "other_vendor", currency: "INR", line_type: "Other Vendor", party: v.ledger,
    company: v.book.company, location: v.book.location, amt_budget: Math.round(v.due),
    tally_company_guid: v.book.companyGuid, tally_ledger: v.ledger, tally_due_inr: v.due, tally_due_as_at: q.data!.readAt,
    remarks: `${v.bills.length} bill(s) due by ${shortDate(end)}; oldest ${v.oldestDays} days`, sort_order: 5000 + i,
  })));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Vendors with bills due by {shortDate(end)} — from Tally</DialogTitle>
          <DialogDescription>
            Sundry Creditors, all companies, from the nightly payables snapshot. Tick the vendors to budget; each becomes an Other Vendor line with
            the due amount as its budget (editable). Bills over 180 days and suppliers already on Import / Advances / Duty start unticked.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading && <div className="text-sm text-muted-foreground py-6">Reading Tally…</div>}
        {q.error && <div className="text-sm text-destructive py-2">Tally due not available — {(q.error as Error).message}</div>}
        {q.data && (
          <div className="space-y-2">
            {q.data.failed.map((f) => (
              <div key={f.book.tenant} className="text-xs text-destructive">{f.book.companyName}: not read ({f.error}) — its vendors are missing from this list, not zero.</div>
            ))}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Input className="h-8 w-56 text-xs" placeholder="Search vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} />Show suppliers on other heads</label>
              <span className="text-muted-foreground">Snapshot: {q.data.refreshedAt.map((r) => `${r.book.company} ${r.book.location} ${r.at ? new Date(r.at).toLocaleString("en-IN") : "?"}`).join(" · ")}</span>
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    {["", "Company", "Vendor", "Bills", "Oldest due", "Age", "Due (INR)", "On account", "Advance"].map((h) => <TableHead key={h} className="h-8 text-xs">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map((v) => {
                    const k = key(v);
                    const already = listed.has(k);
                    return (
                      <TableRow key={k} className={already ? "opacity-50" : undefined}>
                        <TableCell className="py-1"><input type="checkbox" disabled={already} checked={already || sel.has(k)}
                          onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(k); else n.delete(k); setTicked(n); }} /></TableCell>
                        <TableCell className="py-1 text-xs">{v.book.company} {v.book.location}</TableCell>
                        <TableCell className="py-1 text-xs">{v.ledger}{already && <Badge variant="secondary" className="ml-1 text-[10px]">already listed</Badge>}</TableCell>
                        <TableCell className="py-1 text-xs text-right">{v.bills.length}</TableCell>
                        <TableCell className="py-1 text-xs">{v.oldestDue.slice(6, 8)}-{v.oldestDue.slice(4, 6)}-{v.oldestDue.slice(0, 4)}</TableCell>
                        <TableCell className="py-1 text-xs"><Badge variant={ageBucket(v.oldestDays) === "180+" ? "destructive" : "outline"} className="text-[10px]">{ageBucket(v.oldestDays)}</Badge></TableCell>
                        <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(v.due)}</TableCell>
                        <TableCell className="py-1 text-xs text-right font-mono tabular-nums text-muted-foreground">{v.onAccount ? fmtInr(v.onAccount) : ""}</TableCell>
                        <TableCell className="py-1 text-xs text-right font-mono tabular-nums text-muted-foreground">{v.advance ? fmtInr(v.advance) : ""}</TableCell>
                      </TableRow>
                    );
                  })}
                  {vendors.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-6">No vendor matches.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">{chosen.length} vendor(s) · ₹{fmtInr(chosen.reduce((s, v) => s + v.due, 0))}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!chosen.length} onClick={add}>Add {chosen.length} line(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ======================================================== collections == */

function CollectionsTab({ month, lines, rate, editable, isCfo, saving, onSave, onApprove, opening }: {
  month: FfMonth; lines: FfLine[]; rate: number; editable: boolean; isCfo: boolean; saving: boolean;
  onSave: (i: FfSaveItem[]) => Promise<void>; onApprove: (i: FfDecision[]) => Promise<void>; opening: number;
}) {
  const label = monthLabel(month.month);
  const locked = Boolean(month.plan_approved_at);
  const { allCustomers, customerDetail, dashboard, loading } = useAppData({});
  const fyMonths = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const plans = useCollectionPlan(fyMonths);
  const scope = useReceivablesScope();
  const isLive = useReceivablesSource() === "connectwave";
  const scoped = scope.restrictToSalespersons !== null || scope.restrictToCollectionTeams !== null;
  const inFy = fyMonths.includes(label);
  const link = useMemo(() => (loading || !inFy ? null : collectionMonthTotals({
    month: label, allCustomers, customerDetail, asOfDate: dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10),
    months: fyMonths, isLive, plannedFor: plans.plannedFor,
  })), [loading, inFy, label, allCustomers, customerDetail, dashboard, fyMonths, isLive, plans.plannedFor]);

  const col = lines.filter((l) => l.head === "collection");
  const line = col[0];
  // Customer Collections takes the Customer Collection (Salesperson Collection Report) figures
  // ONLY — nothing typed, no override (user, 24-Oct-2026). While the month is open they are kept in
  // step automatically; a closed month keeps the figures it closed with.
  const canSync = editable && !scoped && inFy && !loading && Boolean(link);
  const differs = Boolean(link && (!line
    || Math.abs((line.amt_budget ?? 0) - Math.round(link.total.target)) > 1
    || Math.abs((line.amt_paid ?? 0) - Math.round(link.total.received)) > 1
    || Math.abs((line.total_due ?? 0) - Math.round(link.total.due)) > 1));
  const synced = useRef(false);
  useEffect(() => {
    if (!canSync || !differs || synced.current || saving || !link) return;
    synced.current = true;
    const t = link.total;
    void onSave([{
      ...(line ? { id: line.id, expected_updated_at: line.updated_at } : { id: null, head: "collection", currency: "INR", line_type: "Customer Collections", sort_order: 0 }),
      amt_budget: Math.round(t.target), amt_paid: Math.round(t.received), total_due: Math.round(t.due),
      link_target_inr: t.target, link_received_inr: t.received, link_due_inr: t.due, link_as_at: new Date().toISOString(), paid_source: "linked",
      override_reason: null, remarks: `Customer Collection (Salesperson Collection Report) ${label}, ${link.customers} customers`,
    }]);
  }, [canSync, differs, saving, link, line, label, onSave]);

  const v = line ? lineValues(line, rate, line.plan_locked) : null;
  const live = canSync && link;
  const fig = live ? { target: link!.total.target, received: link!.total.received, due: link!.total.due }
    : line ? { target: v!.approvedInr, received: v!.paidInr, due: line.total_due ?? line.link_due_inr ?? 0 } : null;
  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">Customer Collections — from Customer Collection (Salesperson Collection Report), {label}</div>
          <a className="text-xs underline text-primary" href="/outstanding-dashboard/salesperson-collection" target="_blank" rel="noreferrer">open report</a>
          {loading && <span className="text-xs text-muted-foreground">loading…</span>}
        </div>
        {scoped && <div className="text-xs text-amber-800">Your receivables view is limited to some salespeople, so the figures below are the ones last saved by someone with the full view.</div>}
        {!inFy && <div className="text-xs text-muted-foreground">{label} is outside the financial year loaded for the receivables screens; the figures last saved are shown.</div>}
        {fig ? (
          <div className="grid gap-3 md:grid-cols-2 text-xs">
            <div className="space-y-1">
              <div>Target (planned) <span className="font-mono">₹{fmtInr(fig.target)}</span></div>
              <div>Received <span className="font-mono">₹{fmtInr(fig.received)}</span> · {fmtPct(fig.target ? fig.received / fig.target : null)}</div>
              <div>Balance to collect <span className="font-mono">₹{fmtInr(Math.max(0, fig.target - fig.received))}</span></div>
              <div>Total due <span className="font-mono">₹{fmtInr(fig.due)}</span>{live ? ` · ${link!.customers} customers` : ""}</div>
              <div className="text-muted-foreground">{live ? "Live — saved to the Fund Flow automatically" : line?.link_as_at ? `As saved ${new Date(line.link_as_at).toLocaleString("en-IN")}` : "Not linked yet"}</div>
            </div>
            {live && (
              <table className="w-full self-start">
                <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Company</th><th className="text-right font-normal">Target</th><th className="text-right font-normal">Received</th></tr></thead>
                <tbody>{link!.byCompany.map((c) => (
                  <tr key={c.company} className="border-t border-border/60">
                    <td className="py-0.5 pr-2">{c.company}</td>
                    <td className="py-0.5 text-right font-mono">₹{fmtInr(c.fig.target)}</td>
                    <td className="py-0.5 text-right font-mono">₹{fmtInr(c.fig.received)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ) : <div className="text-xs text-muted-foreground">No collection figures yet.</div>}
        <div className="text-[11px] text-muted-foreground">
          Opening ₹{fmtInr(opening)} · Machine advances and refunds are their own lines below and in the Machine Advances tab — they are not part of the plan, so nothing is counted twice.
        </div>
      </Card>
      <div className="text-sm font-semibold">Refunds / Compensation</div>
      <FfGrid planLocked={locked} heads={["refund"]} lines={lines.filter((l) => l.head === "refund")} rate={rate} fields={FIELDS.refund!} calcs={inrCalcs} layout={LAYOUT.refund}
        canEdit={editable} isCfo={isCfo} saving={saving} onSave={onSave} onApprove={onApprove} emptyMessage="No refunds expected this month." />
    </div>
  );
}

/* ================================================================ log == */

const ACTION_LABEL: Record<string, string> = {
  add: "Added", edit: "Changed", delete: "Deleted", delete_request: "Asked to remove", delete_approved: "Removal approved",
  approve: "Approved", reject: "Not approved / rejected", unapprove: "Approval taken back", plan_approved: "Plan approved (CFO)",
  final_approved: "Final approval (Directors)", month: "Rate / opening", open: "Month opened", close: "Month closed", reopen: "Month reopened",
};
const FIELD_LABEL: Record<string, string> = {
  amt_budget: "Budget", amt_approved: "Approved", amt_paid: "Paid", approved: "Approved", std_rate: "Rate", opening_override: "Opening",
  carried: "Carried", copied: "Copied", carried_added: "Carried added", carried_dropped: "Carried dropped",
};
const logVal = (k: string, x: unknown) => (x == null || x === "" ? "—" : k === "std_rate" || Number.isNaN(Number(x)) ? String(x) : fmtInr(Number(x)));

function ChangeLog({ month }: { month: string }) {
  const q = useFfLog(month, true);
  const rows = q.data ?? [];
  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader><TableRow className="bg-muted">{["When", "By", "What", "Line", "Before → after", "Reason"].map((h) => <TableHead key={h} className="h-8 text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const o = r.old_row ?? {}; const n = r.new_row ?? {};
            const keys = Object.keys(FIELD_LABEL).filter((k) => (k in n || k in o) && String(o[k] ?? "") !== String(n[k] ?? ""));
            return (
              <TableRow key={r.id}>
                <TableCell className="py-1 text-xs whitespace-nowrap">{new Date(r.at).toLocaleString("en-IN")}</TableCell>
                <TableCell className="py-1 text-xs font-medium whitespace-nowrap">{r.by_name ?? (r.by_user ? "—" : "System")}</TableCell>
                <TableCell className="py-1 text-xs">{ACTION_LABEL[r.action] ?? r.action}</TableCell>
                <TableCell className="py-1 text-xs">{String(n.party ?? o.party ?? n.description ?? o.description ?? "")}</TableCell>
                <TableCell className="py-1 text-xs font-mono tabular-nums">{keys.map((k) => `${FIELD_LABEL[k]}: ${logVal(k, o[k])} → ${logVal(k, n[k])}`).join("; ")}</TableCell>
                <TableCell className="py-1 text-xs">{r.reason ?? ""}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">No changes recorded.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

/* ============================================================ dialogs == */

function MonthSettings({ m, onClose, onSave }: { m: FfMonth; onClose: () => void; onSave: (rate: number | null, opening: number | null, why: string | null) => void }) {
  // The rate is entered ONCE (user, 24-Oct-2026): blank = leave it provisional; once saved it is fixed.
  const fixed = Boolean(m.rate_fixed_at);
  const [rate, setRate] = useState("");
  const [opening, setOpening] = useState(m.opening_override == null ? "" : String(m.opening_override));
  const [why, setWhy] = useState(m.opening_reason ?? "");
  const r = fixed || rate.trim() === "" ? null : Number(rate);
  const o = opening.trim() === "" ? null : Number(opening.replace(/,/g, ""));
  const ok = (r == null || r > 0) && (o == null || (!Number.isNaN(o) && why.trim()));
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{monthLong(m.month)} — rate and opening</DialogTitle>
          <DialogDescription>Every USD line is valued at this one rate. Once entered it is fixed for the month and cannot be changed. Leave the opening blank to use the Daily Report bank total.</DialogDescription></DialogHeader>
        <div className="space-y-2 text-sm">
          {fixed ? (
            <div><div className="text-xs text-muted-foreground">Std rate (INR per USD)</div>
              <div className="flex items-center gap-1.5 font-mono font-semibold"><Lock className="h-3.5 w-3.5" />{m.std_rate}
                <span className="font-sans font-normal text-xs text-muted-foreground">fixed {new Date(m.rate_fixed_at!).toLocaleDateString("en-GB")}</span></div></div>
          ) : (
            <div><div className="text-xs text-muted-foreground">Std rate (INR per USD) — enter once; it cannot be changed after saving</div>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder={`provisional ${m.std_rate}`} />
              {r != null && r > 0 && <div className="mt-1 text-xs text-amber-700">Saving fixes {monthLong(m.month)} at {r} INR/USD for the whole month.</div>}</div>
          )}
          <div><div className="text-xs text-muted-foreground">Opening override (INR)</div><Input value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="blank = Daily Report" /></div>
          {o != null && <div><div className="text-xs text-muted-foreground">Reason (required)</div><Input value={why} onChange={(e) => setWhy(e.target.value)} /></div>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!ok} onClick={() => onSave(r, o, o == null ? null : why.trim())}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lines the CFO did not approve: kept in the month, counted 0, listed here (user, 24-Oct-2026). */
function NotApprovedList({ m, lines, isCfo, editable, saving, onApprove }: {
  m: FfMonth; lines: FfLine[]; isCfo: boolean; editable: boolean; saving: boolean; onApprove: (i: FfDecision[]) => Promise<void>;
}) {
  if (!lines.length) {
    return <Card className="p-4 text-sm text-muted-foreground">No line is marked Not approved in {monthLong(m.month)}.</Card>;
  }
  const can = isCfo && editable;
  const total = lines.reduce((t, l) => t + l.budget_inr, 0);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 py-2 text-sm">
        <span className="font-semibold">Not approved — {lines.length} line(s), budget ₹{fmtInr(total)}</span>
        <span className="ml-2 text-xs text-muted-foreground">Kept as entered and counted 0 in Approved. The CFO can still approve any of them.
          Unpaid import / duty lines carry to next month at their budget.</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted">
            {["Sheet", "Company", "Line", "Budgeted (INR)", "Paid (INR)", "Marked on", ""].map((h, i) =>
              <TableHead key={i} className={cn("h-8 text-xs", (i === 3 || i === 4) && "text-right")}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="py-1 text-xs">{HEAD_META[l.head].sheet}</TableCell>
              <TableCell className="py-1 text-xs">{l.company ?? ""}</TableCell>
              <TableCell className="py-1 text-xs">{[l.party, l.ref_no, l.description].filter(Boolean).join(" · ") || l.line_type}</TableCell>
              <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(l.budget_inr)}</TableCell>
              <TableCell className="py-1 text-xs text-right font-mono tabular-nums">{fmtInr(l.paid_inr)}</TableCell>
              <TableCell className="py-1 text-xs">{l.not_approved_at ? new Date(l.not_approved_at).toLocaleDateString("en-GB") : ""}</TableCell>
              <TableCell className="py-1 text-xs text-right">
                {can && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={saving}
                  onClick={() => onApprove([{ id: l.id }])}>Approve</Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** A Director's final approval, after the CFO. Shows what is being approved. */
function FinalApproveDialog({ m, sum, notApproved, saving, onClose, onOk }: {
  m: FfMonth; sum: ReturnType<typeof summarise>; notApproved: number; saving: boolean; onClose: () => void; onOk: (note: string | null) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Final approval — {monthLong(m.month)} budget</DialogTitle>
          <DialogDescription>Approved by the CFO on {new Date(m.plan_approved_at!).toLocaleDateString("en-GB")}. Later changes still go to
            the CFO line by line, and you are told of every change made after your approval.</DialogDescription></DialogHeader>
        <div className="space-y-1 text-sm">
          <div>Opening ₹{fmtInr(sum.opening)}</div>
          <div>Payments approved ₹{fmtInr(sum.totalPayment.approved)} · Collections ₹{fmtInr(sum.totalCollection.approved)}</div>
          <div className="font-semibold">Closing (approved) ₹{fmtInr(sum.closingBudget)}</div>
          {notApproved > 0 && <div className="text-red-700">{notApproved} line(s) not approved by the CFO (counted 0).</div>}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={() => onOk(note.trim() || null)}>Give final approval</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ title, onClose, onOk }: { title: string; onClose: () => void; onOk: (why: string) => void }) {
  const [why, setWhy] = useState("");
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Reopening lets the team edit again until you close it. The reason is logged.</DialogDescription></DialogHeader>
        <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason" />
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!why.trim()} onClick={() => onOk(why.trim())}>Reopen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * CFO only: load a month from its "Budgeted Fund Flow Summary.xlsx" pack — the first month, and the
 * side-by-side month while the Excel is retired. Shows what will be loaded before anything is saved.
 */
function ImportDialog({ months, onClose, onDone }: { months: FfMonth[]; onClose: () => void; onDone: (month: string) => void }) {
  const { toast } = useToast();
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const exists = res?.month ? months.find((x) => x.month === res.month) : undefined;
  // Opening a month whose previous month is in Hub carries that month's lines in; importing the
  // pack on top would then hold every carried line twice. So a pack loads only into a month that
  // is new AND has no Hub month before it — the first month, or a side-by-side trial.
  const prevInHub = res?.month ? months.find((x) => x.month === addMonths(res.month!, -1)) : undefined;
  const blocked = Boolean(exists || prevInHub);
  const read = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer(), { cellFormula: true, sheetStubs: true });
    setRes(parseFundFlowPack((s, a) => (wb.Sheets[s] ? (wb.Sheets[s][a] as never) : undefined), wb.SheetNames));
  };
  const load = async () => {
    if (!res?.month) return;
    setBusy(true);
    try {
      if (!exists) await openMonth(res.month);
      await setMonth(res.month, res.stdRate ?? 95, res.opening, res.opening != null ? "Opening as in the imported Excel pack" : null);
      const items: FfSaveItem[] = res.lines.map((l) => ({ ...l, id: null } as FfSaveItem));
      for (let i = 0; i < items.length; i += 200) await saveLines(res.month, items.slice(i, i + 200));
      toast({ title: `${res.lines.length} lines loaded into ${monthLong(res.month)}` });
      onDone(res.month);
    } catch (e) {
      toast({ title: "Import stopped", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const counts = res ? Object.entries(res.lines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.head]: (a[l.head] ?? 0) + 1 }), {})) : [];
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Import an Excel Fund Flow pack</DialogTitle>
          <DialogDescription>The &quot;Budgeted Fund Flow Summary.xlsx&quot; built from the month&apos;s 0F cashflow. Input cells are read; the pack&apos;s formulas are recomputed here.</DialogDescription></DialogHeader>
        <Input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        {res && (
          <div className="space-y-2 text-xs">
            <div>Month <b>{res.month ? monthLong(res.month) : "not found in the title"}</b> · rate {res.stdRate ?? "—"} · opening ₹{fmtInr(res.opening)} · {res.lines.length} lines</div>
            <div className="flex flex-wrap gap-1">{counts.map(([h, n]) => <Badge key={h} variant="outline">{HEAD_META[h as FfHead].sheet}: {n}</Badge>)}</div>
            {res.missingSheets.length > 0 && <div className="text-destructive">Missing sheets: {res.missingSheets.join(", ")}</div>}
            {res.skipped.map((s, i) => <div key={i} className="text-muted-foreground">Skipped {s.sheet} row {s.row}: {s.why}</div>)}
            {exists && <div className="text-destructive">{monthLong(res.month!)} already exists in Hub ({exists.status}) — a pack loads only into a new month.</div>}
            {!exists && prevInHub && <div className="text-destructive">{monthLong(prevInHub.month)} is in Hub, so {monthLong(res.month!)} opens from it with its carried and copied lines. Loading the pack as well would count them twice.</div>}
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!res?.month || !res.lines.length || busy || blocked} onClick={load}>{busy ? "Loading…" : "Load lines"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ PDF == */

/** One page: the headline figures and the Fund Flow Summary lines, for the management meeting. */
function managementPdf(m: FfMonth, sum: ReturnType<typeof summarise>, lines: FfLine[], opening: number, bank: number | null, removed: FfLine[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const label = monthLong(m.month);
  doc.setFillColor(31, 61, 90); doc.rect(0, 0, 210, 18, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.text(`Budgeted Fund Flow - ${label}`, 10, 12);
  doc.setTextColor(0, 0, 0); doc.setFontSize(8);
  doc.text(`Orange O Tec / Colorix Group · ${m.status === "closed" ? "closed" : "open"} · std rate ${m.std_rate} INR/USD · printed ${new Date().toLocaleString("en-IN")}`, 10, 24);
  const B = sum.byHead;
  const rows: [string, Fig | null, string?][] = [
    ["Opening Balance", { budget: opening, approved: opening, paid: opening, balance: 0, achieved: null }, "b"],
    ["PAYMENTS", null, "h"],
    [HEAD_META.import_due.label, B.import_due], [HEAD_META.import_advance.label, B.import_advance], [HEAD_META.local_advance.label, B.local_advance],
    ["Subtotal - Import and Local Advance", sum.subA, "b"],
    [HEAD_META.customs_duty.label, B.customs_duty], [HEAD_META.emi.label, B.emi], [HEAD_META.other_vendor.label, B.other_vendor],
    ["Subtotal - Duty, EMI and Vendors", sum.subB, "b"],
    ["TDS", B.tds], ["GST", B.gst], ["Subtotal - Tax and Statutory", sum.subC, "b"],
    [HEAD_META.investment.label, B.investment], [HEAD_META.fixed_expense.label, B.fixed_expense],
    ["TOTAL PAYMENT", sum.totalPayment, "t"],
    ["RECEIPTS", null, "h"],
    [HEAD_META.machine_advance.label, B.machine_advance], [HEAD_META.collection.label, B.collection], [HEAD_META.refund.label, B.refund],
    ["TOTAL COLLECTION", sum.totalCollection, "t"],
  ];
  let y = 32;
  doc.setFontSize(8); doc.setFont("helvetica", "bold");
  const cols = [10, 95, 125, 155, 185];
  // POSITION first — the user's one-glance layout (24-Oct-2026). Yellow as in their sheet; the
  // bank and the difference in red when zero / not agreeing.
  {
    const closingBal = sum.opening + sum.totalCollection.balance - sum.totalPayment.balance;
    const diff = bank == null ? null : sum.closingPaid - bank;
    const yellow = (c: number) => { doc.setFillColor(255, 255, 0); doc.rect(cols[c] + 2, y - 3.5, 24, 5, "F"); };
    const red = (c: number) => { doc.setFillColor(255, 199, 206); doc.rect(cols[c] + 2, y - 3.5, 24, 5, "F"); };
    doc.text("POSITION", 11, y);
    ["Budgeted (approved)", "Paid / Received", "Balance", "%"].forEach((h, i) => doc.text(h, cols[i + 1] + 25 - (i === 3 ? 13 : 0), y, { align: "right" }));
    y += 2; doc.line(10, y, 200, y); y += 4;
    const prow = (label: string, b: number | null, p: number | null, bal: number | null, pct?: number | null, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      if (bold) yellow(1);
      if (pct != null) { doc.setFillColor(255, 255, 0); doc.rect(cols[4] - 2, y - 3.5, 16, 5, "F"); }
      doc.text(label, 11, y);
      if (b != null) doc.text(fmtInr(b), cols[1] + 25, y, { align: "right" });
      if (p != null) doc.text(fmtInr(p), cols[2] + 25, y, { align: "right" });
      if (bal != null) doc.text(fmtInr(bal), cols[3] + 25, y, { align: "right" });
      if (pct != null) doc.text(fmtPct(pct), cols[4] + 12, y, { align: "right" });
      y += 5;
    };
    prow("Opening Balance", sum.opening, sum.opening, sum.opening);
    prow("Total Payment", sum.totalPayment.approved, sum.totalPayment.paid, sum.totalPayment.balance, sum.totalPayment.achieved);
    prow("Total Collection", sum.totalCollection.approved, sum.totalCollection.paid, sum.totalCollection.balance, sum.totalCollection.achieved);
    prow("Closing Balance", sum.closingBudget, sum.closingPaid, closingBal, null, true);
    doc.setFont("helvetica", "bold");
    if (!bank) red(2);
    doc.text("Balance as on today (Daily Report)", 11, y);
    doc.text(bank == null ? "not entered" : fmtInr(bank), cols[2] + 25, y, { align: "right" }); y += 5;
    if (diff != null && Math.abs(diff) >= 1) red(2);
    doc.text("Difference (paid-basis closing less bank)", 11, y);
    if (diff != null) doc.text(fmtInr(diff), cols[2] + 25, y, { align: "right" });
    y += 9;
    doc.setFont("helvetica", "bold");
  }
  ["Particulars", "Approved (INR)", "Paid (INR)", "Balance (INR)", "Ach."].forEach((h, i) => doc.text(h, cols[i] + (i ? 25 : 0), y, { align: i ? "right" : "left" }));
  y += 2; doc.line(10, y, 200, y); y += 4;
  for (const [t, f, kind] of rows) {
    doc.setFont("helvetica", kind ? "bold" : "normal");
    if (kind === "h") { doc.setFillColor(57, 98, 140); doc.rect(10, y - 3.5, 190, 5, "F"); doc.setTextColor(255, 255, 255); doc.text(t, 11, y); doc.setTextColor(0, 0, 0); y += 5.5; continue; }
    if (kind === "t") { doc.setFillColor(198, 239, 206); doc.rect(10, y - 3.5, 190, 5, "F"); }
    doc.text(t, 11, y);
    if (f) {
      doc.text(fmtInr(f.approved), cols[1] + 25, y, { align: "right" });
      doc.text(fmtInr(f.paid), cols[2] + 25, y, { align: "right" });
      if (t !== "Opening Balance") { doc.text(fmtInr(f.balance), cols[3] + 25, y, { align: "right" }); doc.text(fmtPct(f.achieved), cols[4] + 12, y, { align: "right" }); }
    }
    y += 5.5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFillColor(198, 239, 206); doc.rect(10, y - 3.5, 190, 5, "F");
  doc.text("CLOSING BALANCE (Opening + Collection - Payment)", 11, y);
  doc.text(fmtInr(sum.closingBudget), cols[1] + 25, y, { align: "right" }); doc.text(fmtInr(sum.closingPaid), cols[2] + 25, y, { align: "right" });
  y += 8;
  doc.setFont("helvetica", "normal");
  if (bank != null) { doc.text(`Bank balance per Daily Report: ${fmtInr(bank)}   ·   paid-basis closing less bank: ${fmtInr(sum.closingPaid - bank)}`, 11, y); y += 6; }
  const top = lines.filter((l) => HEAD_META[l.head].side === "payment" && l.balance_inr > 0.5).sort((a, b) => b.balance_inr - a.balance_inr).slice(0, 10);
  doc.setFont("helvetica", "bold"); doc.text("Top 10 approved payments still unpaid", 11, y); y += 5; doc.setFont("helvetica", "normal");
  for (const l of top) {
    doc.text(`${(l.party || l.description || l.line_type || "").slice(0, 70)} (${HEAD_META[l.head].sheet})`, 13, y);
    doc.text(fmtInr(l.balance_inr), cols[3] + 25, y, { align: "right" }); y += 4.5;
  }
  if (m.plan_approved_at) {
    const { rows, bridge: b } = planChanges(m, lines, removed);
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.text("Changes after plan", 11, y); y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(`Plan ${fmtInr(b.plan)}  + added ${fmtInr(b.added)}  - removed ${fmtInr(b.removed)}  +/- changed ${fmtInr(b.changed)}  = approved now ${fmtInr(b.current)}`, 13, y); y += 4.5;
    if (b.pendingAdd || b.pendingChange || b.pendingRemove) {
      doc.text(`Awaiting CFO: additions ${fmtInr(b.pendingAdd)} · changes ${fmtInr(b.pendingChange)} · removals asked ${fmtInr(b.pendingRemove)}`, 13, y); y += 4.5;
    }
    for (const r of rows.slice(0, Math.max(0, Math.floor((285 - y) / 4.5) - 2))) {
      doc.text(`${KIND_LABEL[r.kind]}: ${r.name.slice(0, 55)} (${r.sheet})`, 13, y);
      doc.text(fmtInr(r.effect), cols[3] + 25, y, { align: "right" });
      doc.text(r.status.slice(0, 26), cols[3] + 27, y); y += 4.5;
    }
  }
  const pendingN = lines.filter((l) => l.changed_after_approval || l.awaiting_approval || l.delete_requested).length;
  y = Math.min(y + 3, 290);
  doc.setFontSize(7);
  doc.text(m.plan_approved_at
    ? `Plan approved ${new Date(m.plan_approved_at).toLocaleDateString("en-GB")} · ${pendingN} item(s) waiting for the CFO.`
    : "Plan not yet approved: Approved follows Budgeted until the CFO approves the plan.", 11, y);
  doc.save(`Fund Flow Summary - ${label}.pdf`);
}
