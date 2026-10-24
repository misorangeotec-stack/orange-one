import { createContext, useContext, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { Badge } from "@hub/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hub/components/ui/select";
import { TableCell, TableRow } from "@hub/components/ui/table";
import { GridTable, GRID_NUM, type TableColumn } from "@hub/components/GridTable";
import { useColumnGrid } from "@hub/lib/useColumnGrid";
import { cn } from "@hub/lib/utils";
import {
  BLOCKS, DUTY_MODES, HEAD_META, fmtInr, fmtPct, fmtUsd, lineValues, type FfHead, type FfLineValues,
} from "@hub/lib/fundFlowCalc";
import type { FfDecision, FfLine, FfSaveItem } from "@hub/lib/fundFlow";

/**
 * One head's lines as an editable grid — the shape every Fund Flow tab shares.
 *
 * Edits are held as a DRAFT (per line) and saved together through ff_save_lines, so a reader
 * typing a column of figures makes one round trip and one log entry per line, and "Discard"
 * genuinely puts everything back. Every figure on screen is recomputed from the draft by
 * fundFlowCalc as you type — the same function the export and the summary use.
 *
 * Grid rules (Hub CLAUDE.md): every column sorts and filters, cascading; an empty RESULT keeps
 * the table standing with a Clear filters row. Rows are not grouped: Advances' blocks (MACH / INK /
 * HEAD / PAPER / PARTS) are a filterable Block column with their subtotals shown above the table.
 */

/**
 * The page listens here for unsaved edits, so it can stop a tab / month switch or a click away
 * until the user saves or discards (user, 24-Oct-2026). Each grid reports its own count.
 */
export const FfDirtyContext = createContext<((gridId: string, unsaved: number) => void) | null>(null);

export type FieldKind = "text" | "usd" | "inr" | "pct" | "date" | "bool" | "block" | "company" | "duty_mode" | "head";

export interface FieldDef {
  key: keyof FfLine;
  label: string;
  kind: FieldKind;
  head?: string;
  /** Not editable even when the month is (e.g. a Tally-read figure). */
  readOnly?: boolean;
  /** An amount field: locked on a carried line that still follows its source month. */
  amount?: boolean;
  /** Frozen on the left while the table scrolls sideways (the first two columns only). */
  freeze?: keyof typeof FREEZE_HEAD;
  /** Placed after every figure column, at the far right (long notes like Payment Terms). */
  tail?: boolean;
}

/**
 * Frozen columns. Fixed widths, because the second column's left offset must equal the first's
 * width exactly. Header cells get !z-30 so they sit above both the sticky header row (z-20) and
 * the frozen body cells (z-10); body cells need an opaque background or rows slide under them.
 * Literal class strings so Tailwind's scanner sees them.
 */
const FREEZE_HEAD = {
  first: "sticky left-0 !z-30 w-[84px] min-w-[84px] max-w-[84px]",
  second: "sticky left-[84px] !z-30 w-[220px] min-w-[220px] max-w-[220px] border-r border-border",
  // Type + Vendor on the list sheets: Type needs more room than Advances' short Block code.
  wide1: "sticky left-0 !z-30 w-[130px] min-w-[130px] max-w-[130px]",
  wide2: "sticky left-[130px] !z-30 w-[220px] min-w-[220px] max-w-[220px] border-r border-border",
  // Customs Duty: everything up to Item stays put (user, 24-Oct-2026).
  cd1: "sticky left-0 !z-30 w-[112px] min-w-[112px] max-w-[112px]",
  cd2: "sticky left-[112px] !z-30 w-[150px] min-w-[150px] max-w-[150px]",
  cd3: "sticky left-[262px] !z-30 w-[150px] min-w-[150px] max-w-[150px]",
  cd4: "sticky left-[412px] !z-30 w-[130px] min-w-[130px] max-w-[130px]",
  cd5: "sticky left-[542px] !z-30 w-[100px] min-w-[100px] max-w-[100px] border-r border-border",
} as const;
const FREEZE_CELL = {
  first: "sticky left-0 z-10 bg-background w-[84px] min-w-[84px] max-w-[84px]",
  second: "sticky left-[84px] z-10 bg-background w-[220px] min-w-[220px] max-w-[220px] border-r border-border",
  wide1: "sticky left-0 z-10 bg-background w-[130px] min-w-[130px] max-w-[130px]",
  wide2: "sticky left-[130px] z-10 bg-background w-[220px] min-w-[220px] max-w-[220px] border-r border-border",
  cd1: "sticky left-0 z-10 bg-background w-[112px] min-w-[112px] max-w-[112px]",
  cd2: "sticky left-[112px] z-10 bg-background w-[150px] min-w-[150px] max-w-[150px]",
  cd3: "sticky left-[262px] z-10 bg-background w-[150px] min-w-[150px] max-w-[150px]",
  cd4: "sticky left-[412px] z-10 bg-background w-[130px] min-w-[130px] max-w-[130px]",
  cd5: "sticky left-[542px] z-10 bg-background w-[100px] min-w-[100px] max-w-[100px] border-r border-border",
} as const;

/**
 * Formula columns are tinted and never editable (user, 24-Oct-2026), so a reader can tell at a
 * glance which figures they type and which the sheet works out.
 */
const CALC_HEAD = "bg-sky-100 dark:bg-sky-900/40";
const CALC_CELL = "bg-sky-50 dark:bg-sky-950/30";

export interface CalcDef {
  key: string;
  label: string;
  value: (v: FfLineValues, l: FfLine) => number | null;
  fmt?: "inr" | "usd" | "pct";
  title?: string;
}

/**
 * Approval status as a short coloured code, so the column stays narrow (user, 24-Oct-2026):
 * A = approved (green), NA = not approved (red), E = edited after approval and waiting for the CFO
 * (amber), AE = approved again after an edit or added after the plan (blue), DEL = removal asked.
 */
export const APPROVAL_CODES = [
  { code: "A", label: "Approved", cls: "bg-emerald-600 text-white" },
  { code: "NA", label: "Not approved — kept, counts 0", cls: "bg-red-600 text-white" },
  { code: "E", label: "Edited after approval — waiting for the CFO", cls: "bg-amber-500 text-white" },
  { code: "AE", label: "Approved after an edit / added after the plan", cls: "bg-sky-600 text-white" },
  { code: "DEL", label: "Removal asked — waiting for the CFO", cls: "bg-red-900 text-white" },
] as const;
type ApprovalCode = (typeof APPROVAL_CODES)[number]["code"];

function approvalCode(l: FfLine): ApprovalCode {
  if (l.delete_requested) return "DEL";
  if (!l.approved_at) return "NA";
  if (l.changed_after_approval) return "E";
  const reapproved = l.plan_locked && (l.added_after_plan || (l.plan_unit != null && l.amt_approved != null
    && Math.abs(Number(l.amt_approved) - Number(l.plan_unit)) > 0.005));
  return reapproved ? "AE" : "A";
}

function CodeChip({ code, onClick, disabled, title }: { code: ApprovalCode; onClick?: () => void; disabled?: boolean; title?: string }) {
  const c = APPROVAL_CODES.find((x) => x.code === code)!;
  const cls = cn("inline-flex h-5 min-w-[26px] items-center justify-center rounded px-1 text-[10px] font-bold", c.cls);
  return onClick
    ? <button type="button" className={cn(cls, "hover:opacity-80 disabled:opacity-50")} disabled={disabled} title={title ?? c.label} onClick={onClick}>{c.code}</button>
    : <span className={cls} title={c.label}>{c.code}</span>;
}

type Draft = Partial<FfLine> & { __new?: boolean; __delete?: boolean };

const COMPANIES = ["O Tec", "Enterprises", "Colorix", "Group"];
const NONE = "__none";

function display(l: FfLine, f: FieldDef): string {
  const v = l[f.key] as unknown;
  if (v == null || v === "") return "";
  switch (f.kind) {
    case "usd": return fmtUsd(Number(v));
    case "inr": return fmtInr(Number(v));
    case "pct": return `${(Number(v) * 100).toFixed(2)}%`;
    case "bool": return v ? "Yes" : "";
    case "block": return BLOCKS.find((b) => b.block === v)?.short ?? String(v);
    case "duty_mode": return DUTY_MODES.find((m) => m.mode === v)?.label ?? String(v);
    case "head": return HEAD_META[v as FfHead]?.label ?? String(v);
    case "date": return String(v).split("-").reverse().join("-");
    default: return String(v);
  }
}

function sortValue(l: FfLine, f: FieldDef): string | number {
  const v = l[f.key] as unknown;
  if (f.kind === "usd" || f.kind === "inr" || f.kind === "pct") return v == null ? -Infinity : Number(v);
  return v == null ? "" : String(v);
}

/** A cell editor. Numbers commit on every keystroke into the draft; blank means "not set". */
function Editor({ f, value, onChange, headOptions }: {
  f: FieldDef; value: unknown; onChange: (v: unknown) => void; headOptions?: FfHead[];
}) {
  const cls = "h-7 text-xs px-1.5";
  if (f.kind === "bool") {
    return <input type="checkbox" className="h-4 w-4 accent-primary" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (f.kind === "block" || f.kind === "company" || f.kind === "duty_mode" || f.kind === "head") {
    const opts = f.kind === "block" ? BLOCKS.map((b) => ({ v: b.block, l: b.short }))
      : f.kind === "duty_mode" ? DUTY_MODES.map((m) => ({ v: m.mode, l: `${m.label}: ${m.formula}` }))
      : f.kind === "head" ? (headOptions ?? []).map((h) => ({ v: h, l: HEAD_META[h].label }))
      : COMPANIES.map((c) => ({ v: c, l: c }));
    // Radix Select forbids an empty item value, so "not set" travels as a sentinel.
    return (
      <Select value={(value as string) || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger className={cn(cls, "w-full")}><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {opts.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (f.kind === "date") {
    return <Input type="date" className={cls} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
  }
  if (f.kind === "usd" || f.kind === "inr" || f.kind === "pct") {
    const shown = value == null ? "" : f.kind === "pct" ? String(Math.round(Number(value) * 1e6) / 1e4) : String(value);
    return (
      <Input inputMode="decimal" className={cn(cls, "text-right font-mono tabular-nums")} value={shown}
        placeholder={f.kind === "pct" ? "%" : ""}
        onChange={(e) => {
          const t = e.target.value.replace(/,/g, "").trim();
          if (t === "") return onChange(null);
          const n = Number(t);
          if (!Number.isNaN(n)) onChange(f.kind === "pct" ? n / 100 : n);
        }} />
    );
  }
  // Text WRAPS and the box grows with it, so the whole entry is always readable (user, 24-Oct-2026).
  // field-sizing:content grows the height in Chromium; `rows` is the fallback elsewhere.
  const t = (value as string) ?? "";
  return (
    <textarea
      className="w-full min-h-7 resize-none rounded-md border border-input bg-background px-1.5 py-1 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-ring"
      style={{ fieldSizing: "content" } as CSSProperties}
      rows={Math.max(1, Math.min(8, Math.ceil(t.length / 26)))}
      value={t}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function FfGrid({
  heads, lines, rate, planLocked, fields, calcs, layout, canEdit, isCfo, saving, onSave, onApprove, extraColumns, newLine, emptyMessage, above,
}: {
  /** The head(s) this grid holds. More than one (TDS + GST) shows a Head column. */
  heads: FfHead[];
  lines: FfLine[];
  rate: number;
  /** The month's plan is approved: additions count 0 approved and every change waits for the CFO. */
  planLocked: boolean;
  fields: FieldDef[];
  calcs: CalcDef[];
  /**
   * Column order by key (field key, calc key, "approval", "head"), as in the Excel sheet. Columns
   * not named follow in their usual order (Notes, extra columns, delete).
   */
  layout?: string[];
  canEdit: boolean;
  isCfo: boolean;
  saving: boolean;
  onSave: (items: FfSaveItem[]) => Promise<void>;
  onApprove: (items: FfDecision[]) => Promise<void>;
  extraColumns?: TableColumn<FfLine>[];
  newLine?: Partial<FfLine>;
  emptyMessage: string;
  above?: ReactNode;
}) {
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [approveDraft, setApproveDraft] = useState<Map<string, number | null>>(new Map());
  const [newSeq, setNewSeq] = useState(0);
  const gridId = useId();
  const reportDirty = useContext(FfDirtyContext);
  useEffect(() => { reportDirty?.(gridId, drafts.size); }, [reportDirty, gridId, drafts.size]);
  useEffect(() => () => reportDirty?.(gridId, 0), [reportDirty, gridId]);
  const unit = HEAD_META[heads[0]].currency;

  const merged: FfLine[] = useMemo(() => {
    const out: FfLine[] = [];
    for (const l of lines) {
      const d = drafts.get(l.id);
      out.push(d ? ({ ...l, ...d } as FfLine) : l);
    }
    for (const [id, d] of drafts) {
      if (d.__new) out.push({ ...(d as FfLine), id });
    }
    return out.filter((l) => !(drafts.get(l.id)?.__delete));
  }, [lines, drafts]);

  const valuesOf = useMemo(() => {
    const m = new Map<string, FfLineValues>();
    for (const l of merged) m.set(l.id, lineValues(l, rate, planLocked));
    return m;
  }, [merged, rate, planLocked]);

  const patch = (l: FfLine, key: keyof FfLine, v: unknown) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const d = { ...(next.get(l.id) ?? {}) } as Draft;
      (d as Record<string, unknown>)[key as string] = v;
      next.set(l.id, d);
      return next;
    });
  };

  const addLine = () => {
    const id = `new-${newSeq}`;
    setNewSeq((x) => x + 1);
    setDrafts((prev) => new Map(prev).set(id, {
      __new: true, head: heads[0], currency: HEAD_META[heads[0]].currency, amt_budget: null, amt_approved: null, amt_paid: null,
      paid_before: 0, not_this_month: false, paid_in_full: false, carry_frozen: true, paid_source: "manual",
      sort_order: 10_000 + newSeq, budget_inr: 0, approved_inr: 0, paid_inr: 0, balance_inr: 0, achieved: null,
      changed_after_approval: false, awaiting_approval: planLocked, added_after_plan: planLocked, delete_requested: false, not_approved: false,
      plan_unit: null, delete_requested_at: null, plan_locked: planLocked, ...(newLine ?? {}),
    } as Draft));
  };

  const removeLine = (l: FfLine) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (l.id.startsWith("new-")) next.delete(l.id);
      else next.set(l.id, { ...(next.get(l.id) ?? {}), __delete: true });
      return next;
    });
  };

  const dirty = drafts.size;
  const save = async () => {
    const items: FfSaveItem[] = [];
    for (const [id, d] of drafts) {
      const { __new, __delete, ...rest } = d;
      const fieldsOnly: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (["id", "budget_inr", "approved_inr", "paid_inr", "balance_inr", "achieved", "changed_after_approval", "carry_frozen",
          "paid_before", "updated_at", "updated_by", "approved_at", "approved_by", "carried_from_line_id", "month", "amt_approved",
          "plan_unit", "delete_requested_at", "awaiting_approval", "added_after_plan", "delete_requested", "plan_locked",
          "not_approved", "not_approved_at"].includes(k)) continue;
        fieldsOnly[k] = v;
      }
      if (__new) items.push({ ...(fieldsOnly as FfSaveItem), id: null });
      else {
        const orig = lines.find((x) => x.id === id);
        items.push({ ...(fieldsOnly as FfSaveItem), id, expected_updated_at: orig?.updated_at, delete: __delete || undefined });
      }
    }
    await onSave(items);
    setDrafts(new Map());
  };

  const locked = (l: FfLine, f: FieldDef) =>
    !canEdit || f.readOnly || (f.amount && !l.carry_frozen) || (l.head === "customs_duty" && f.key === "amt_paid" && Boolean(l.paid_in_full));

  const columns = useMemo<TableColumn<FfLine>[]>(() => {
    const cols: TableColumn<FfLine>[] = [];
    if (heads.length > 1) {
      cols.push({ key: "head", label: "Head", head: "min-w-[90px]", value: (l) => HEAD_META[l.head].label,
        cell: (l) => (canEdit && l.id.startsWith("new-")
          ? <Editor f={{ key: "head", label: "Head", kind: "head" }} value={l.head} headOptions={heads} onChange={(v) => patch(l, "head", v)} />
          : HEAD_META[l.head].label) });
    }
    const fieldCol = (f: FieldDef): TableColumn<FfLine> => {
      const numeric = f.kind === "usd" || f.kind === "inr" || f.kind === "pct";
      return {
        key: String(f.key), label: f.label,
        head: f.freeze ? FREEZE_HEAD[f.freeze] : f.head ?? (numeric ? "min-w-[110px]" : "min-w-[140px]"),
        cellClass: f.freeze ? FREEZE_CELL[f.freeze] : undefined,
        right: numeric, filter: !numeric, value: (l) => display(l, f), sortValue: (l) => sortValue(l, f),
        cell: (l) => (locked(l, f)
          ? l.head === "customs_duty" && f.key === "amt_paid" && l.paid_in_full
            // Paid in full: the paid figure is the line's total, worked out — show it, not the blank.
            ? <span className="font-mono tabular-nums">{fmtInr(valuesOf.get(l.id)!.paidInr)}</span>
            : <span className={cn(numeric ? "font-mono tabular-nums" : "whitespace-normal break-words")}>{display(l, f)}</span>
          : <Editor f={f} value={l[f.key]} onChange={(v) => patch(l, f.key, v)} />),
      };
    };
    for (const f of fields) if (!f.tail) cols.push(fieldCol(f));
    for (const c of calcs) {
      const fmt = (x: number | null) => (x == null ? "" : c.fmt === "usd" ? fmtUsd(x) : c.fmt === "pct" ? fmtPct(x) : fmtInr(x));
      cols.push({
        key: c.key, label: c.label, title: c.title ?? "Formula — worked out, not editable", right: true, filter: false,
        head: cn("min-w-[110px]", CALC_HEAD), cellClass: CALC_CELL,
        value: (l) => fmt(c.value(valuesOf.get(l.id)!, l)),
        sortValue: (l) => c.value(valuesOf.get(l.id)!, l) ?? -Infinity,
        cell: (l) => {
          const x = c.value(valuesOf.get(l.id)!, l);
          return <span className={cn(x != null && x < -0.5 && "text-destructive")}>{fmt(x)}</span>;
        },
      });
    }
    // Approval: the CFO's figure, in the line's unit, with its status code. The CFO approves by
    // clicking the code (an amount typed in the box first approves that amount instead).
    cols.push({
      key: "approval", label: unit === "USD" ? "USD Approved" : "INR Approved", head: isCfo && canEdit ? "min-w-[150px]" : "min-w-[110px]", right: true,
      value: (l) => APPROVAL_CODES.find((c) => c.code === approvalCode(l))!.code,
      sortValue: (l) => valuesOf.get(l.id)!.approvedUnit,
      cell: (l) => {
        const v = valuesOf.get(l.id)!;
        const shownUnit = v.approvedUnit - (l.paid_before ?? 0);
        const fmt = unit === "USD" ? fmtUsd : fmtInr;
        const code = approvalCode(l);
        if (!isCfo || !canEdit || l.id.startsWith("new-") || drafts.has(l.id)) {
          return <div className="flex items-center justify-end gap-1.5"><span className="font-mono tabular-nums">{fmt(shownUnit)}</span><CodeChip code={code} /></div>;
        }
        if (l.delete_requested) {
          return (
            <div className="flex items-center justify-end gap-1">
              <span className="font-mono tabular-nums mr-1">{fmt(shownUnit)}</span>
              <Button size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]" disabled={saving}
                onClick={() => onApprove([{ id: l.id, approve_delete: true }])}>Remove</Button>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={saving}
                onClick={() => onApprove([{ id: l.id, reject: true }])}>Keep</Button>
            </div>
          );
        }
        const pending = approveDraft.has(l.id);
        const waiting = code === "NA" || code === "E";
        // An approval can be taken back by the CFO (user, 24-Oct-2026): the line becomes NA, kept.
        const unapprove = async () => {
          if (!window.confirm(`Take back the approval of "${l.party || l.description || l.line_type || "this line"}"? It becomes Not approved (kept, counts 0) and can be approved again.`)) return;
          await onApprove([{ id: l.id, unapprove: true }]);
        };
        // A line already marked Not approved has nothing to turn down — only Approve.
        const canReject = waiting && !l.not_approved;
        const approve = async () => {
          const typed = approveDraft.get(l.id);
          // A typed figure is this month's due; the line stores it gross of earlier payments.
          const approved = typed == null ? null : typed + (l.paid_before ?? 0);
          await onApprove([{ id: l.id, ...(pending ? { approved } : {}) }]);
          setApproveDraft((p) => { const n = new Map(p); n.delete(l.id); return n; });
        };
        return (
          <div className="flex items-center justify-end gap-1">
            <Input inputMode="decimal" className="h-6 w-20 px-1 text-xs text-right font-mono tabular-nums"
              placeholder={fmt(shownUnit)} value={pending ? String(approveDraft.get(l.id) ?? "") : ""}
              onChange={(e) => {
                const t = e.target.value.replace(/,/g, "").trim();
                setApproveDraft((p) => new Map(p).set(l.id, t === "" ? null : Number(t)));
              }} />
            <CodeChip code={code} disabled={saving}
              onClick={waiting || pending ? approve : unapprove}
              title={pending ? "Click to approve the amount typed" : waiting ? "Click to approve as budgeted" : "Approved — click to take the approval back"} />
            {canReject && (
              <button type="button" className="text-muted-foreground hover:text-destructive disabled:opacity-50" disabled={saving}
                title={l.approved_at ? "Reject the change — put the budget back as approved" : "Mark Not approved — the line is kept, counts 0, and can be approved later"}
                onClick={() => onApprove([{ id: l.id, reject: true }])}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    });
    cols.push({
      key: "flags", label: "Notes", head: "min-w-[120px]",
      value: (l) => [l.carried_from_line_id && l.paid_before !== undefined && HEAD_META[l.head].carries ? "Carried" : "",
        !l.carry_frozen ? "Follows last month" : "", l.paid_source === "tally" ? "Paid from Tally" : "",
        l.added_after_plan ? "Added after plan" : "", l.delete_requested ? "Removal asked" : "",
        l.changed_after_approval || l.awaiting_approval ? "Awaiting CFO" : "",
        valuesOf.get(l.id)!.paidInr > valuesOf.get(l.id)!.approvedInr + 0.5 ? "Paid exceeds budget" : ""].filter(Boolean).join(", "),
      cell: (l) => {
        const v = valuesOf.get(l.id)!;
        return (
          <div className="flex flex-wrap gap-1">
            {l.carried_from_line_id && HEAD_META[l.head].carries && <Badge variant="outline" className="text-[10px] px-1">Carried</Badge>}
            {!l.carry_frozen && <Badge variant="secondary" className="text-[10px] px-1" title="Budget follows last month's line until last month closes">Follows last month</Badge>}
            {l.paid_source === "tally" && <Badge variant="outline" className="text-[10px] px-1 border-sky-500 text-sky-700">Tally</Badge>}
            {v.paidInr > v.approvedInr + 0.5 && <Badge variant="destructive" className="text-[10px] px-1">Paid &gt; budget</Badge>}
            {l.added_after_plan && !l.id.startsWith("new-") && <Badge variant="outline" className="text-[10px] px-1 border-violet-500 text-violet-700">Added after plan</Badge>}
            {l.id.startsWith("new-") && <Badge variant="secondary" className="text-[10px] px-1">New</Badge>}
            {drafts.has(l.id) && !l.id.startsWith("new-") && <Badge variant="secondary" className="text-[10px] px-1">Edited</Badge>}
          </div>
        );
      },
    });
    if (extraColumns) cols.push(...extraColumns);
    for (const f of fields) if (f.tail) cols.push(fieldCol(f));
    if (canEdit) {
      cols.push({ key: "del", label: "", sortable: false, value: () => "", head: "w-8",
        cell: (l) => (
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={l.delete_requested}
            title={l.approved_at && !isCfo ? "Ask the CFO to remove this approved line" : "Delete line"} onClick={() => removeLine(l)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ) });
    }
    if (!layout) return cols;
    const byKey = new Map(cols.map((c) => [c.key, c]));
    const first = layout.map((k) => byKey.get(k)).filter((c): c is TableColumn<FfLine> => Boolean(c));
    return [...first, ...cols.filter((c) => !layout.includes(c.key))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, calcs, layout, canEdit, isCfo, valuesOf, approveDraft, drafts, saving, extraColumns, heads, unit, planLocked]);

  const grid = useColumnGrid(merged, columns, undefined, undefined);

  const t = useMemo(() => {
    let b = 0, a = 0, p = 0;
    for (const l of grid.rows) { const v = valuesOf.get(l.id)!; b += v.budgetInr; a += v.approvedInr; p += v.paidInr; }
    return { b, a, p };
  }, [grid.rows, valuesOf]);

  // Waiting for the CFO on this tab (removal requests are decided one by one, never in bulk).
  // Lines the CFO marked Not approved stay so: "approve all" never sweeps them up.
  const unapproved = merged.filter((l) => !l.id.startsWith("new-") && !l.delete_requested && !l.not_approved
    && (!l.approved_at || l.changed_after_approval));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>}
        {canEdit && (
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            <Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : `Save changes${dirty ? ` (${dirty})` : ""}`}
          </Button>
        )}
        {canEdit && dirty > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setDrafts(new Map())}><RotateCcw className="h-3.5 w-3.5 mr-1" />Discard</Button>
        )}
        {isCfo && canEdit && unapproved.length > 0 && (
          <Button size="sm" variant="outline" disabled={saving || dirty > 0} title={dirty ? "Save or discard edits first" : undefined}
            onClick={() => onApprove(unapproved.map((l) => ({ id: l.id })))}>
            <Check className="h-3.5 w-3.5 mr-1" />{planLocked ? "Approve all waiting on this tab" : "Approve all as budgeted"} ({unapproved.length})
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {APPROVAL_CODES.map((c) => <span key={c.code} className="flex items-center gap-0.5 mr-1"><CodeChip code={c.code} />{c.label.split(" — ")[0]}</span>)}
          <span className={cn("inline-block h-3 w-3 rounded-sm border border-sky-300", CALC_CELL)} />Formula, not editable ·
          {grid.rows.length} line{grid.rows.length === 1 ? "" : "s"}
          {unit === "USD" && <> · USD at the month's std rate {rate}</>}
        </span>
      </div>
      {above}
      {canEdit && dirty > 0 && (
        // Shown for as long as anything is unsaved: a reminder that edits only count once saved.
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm shadow-lg">
          <span className="font-medium text-amber-900">{dirty} unsaved change{dirty === 1 ? "" : "s"} — click Save before leaving this page</span>
          <Button size="sm" disabled={saving} onClick={save}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving…" : "Save changes"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDrafts(new Map())}>Discard</Button>
        </div>
      )}
      <GridTable
        columns={columns} grid={grid} pageRows={grid.rows} rowKey={(l) => l.id}
        rowClass={(l) => (drafts.has(l.id) ? "bg-amber-50/60" : undefined)}
        sourceCount={merged.length} emptyMessage={emptyMessage}
        onClearFilters={grid.clearFilters}
        footer={grid.rows.length > 0 ? (
          <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
            <TableCell colSpan={columns.length} className="px-2.5 py-1.5 text-xs">
              <span className="mr-4">Total{grid.anyFilter ? " (filtered)" : ""}:</span>
              <span className={cn(GRID_NUM, "mr-4")}>Budgeted ₹{fmtInr(t.b)}</span>
              <span className={cn(GRID_NUM, "mr-4")}>Approved ₹{fmtInr(t.a)}</span>
              <span className={cn(GRID_NUM, "mr-4")}>Paid ₹{fmtInr(t.p)}</span>
              <span className={GRID_NUM}>Balance ₹{fmtInr(t.a - t.p)}</span>
            </TableCell>
          </TableRow>
        ) : undefined}
      />
    </div>
  );
}
