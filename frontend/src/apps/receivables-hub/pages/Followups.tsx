import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import {
  PhoneCall, AlarmClock, CalendarClock, HandCoins, TriangleAlert, Download, Search, Plus,
  Pencil, Trash2,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useSession } from "@/core/platform/session";
import { useFollowups, type DueItem } from "@hub/lib/useFollowups";
import { FollowupModal } from "@hub/components/FollowupModal";
import { FollowupEntityPicker } from "@hub/components/FollowupEntityPicker";
import { NextFollowupCell } from "@hub/components/NextFollowupCell";
import { useToast } from "@hub/hooks/use-toast";
import { formatDateDMY, formatDateTimeDMY, fmtINRMoney } from "@hub/lib/utils";
import { HEADER_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import {
  OUTCOME_OPTIONS, entityKey, outcomeBadgeClass, outcomeLabel, todayISO,
  type Followup, type FollowupEntityType,
} from "@hub/lib/followupTypes";

/**
 * Follow-ups — the payment-chase worklist and the management activity log.
 *
 * TWO JOBS, TWO TABS:
 *   "Due"          — what do I have to chase today? (Overdue / Today / Upcoming)
 *   "Activity Log" — what follow-ups did the team actually do? (defaults to TODAY, which is
 *                    the question management asks; filter by person, customer or outcome)
 *
 * Follow-up RECORDS live on ConnectWave now (see lib/followupsApi.ts) and are shared across both
 * sources, so this page follows the topbar "Live (Tally)" toggle like every other screen: the customer
 * universe + the frozen at-entry stats (statsFor via useAppData) come from whichever source is active.
 * It used to be pinned to the pipeline; that pin was lifted when the store moved to ConnectWave.
 */

const PAGE_SIZE = 25;

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

/** Shared 25/page pager (project rule: every table paginates). */
function Pager({
  page, setPage, total,
}: { page: number; setPage: (p: number) => void; total: number }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  if (total === 0) return null;
  const from = (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, total);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {from}–{to} of {total}
      </span>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage(Math.max(1, safePage - 1))}
                aria-disabled={safePage === 1}
                className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {getPageWindow(safePage, pageCount).map((p, i) =>
              p === "..." ? (
                <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink isActive={p === safePage} onClick={() => setPage(p)} className="cursor-pointer">
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                aria-disabled={safePage === pageCount}
                className={safePage === pageCount ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof AlarmClock; label: string; value: string; sub?: string;
  tone: "red" | "amber" | "slate" | "emerald";
}) {
  const tones = {
    red: "text-red-600 bg-red-50 border-red-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    slate: "text-foreground bg-muted border-border",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
  } as const;
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-button border ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-lg font-bold leading-tight text-foreground">{value}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Link to a customer/group detail page — the entity name is what the route carries. */
function EntityLink({ type, name }: { type: FollowupEntityType; name: string }) {
  const path = type === "group"
    ? `/outstanding-dashboard/group/${encodeURIComponent(name)}`
    : `/outstanding-dashboard/customer/${encodeURIComponent(name)}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={path} className="font-medium text-foreground hover:text-primary hover:underline">
        {name}
      </Link>
      {type === "group" && (
        <span className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
          Group
        </span>
      )}
    </span>
  );
}

export default function FollowupsPage() {
  const { user, isAdmin } = useSession();
  const {
    loading, error, all, due, brokenPromises, promisedTotal, personName, canModify, remove,
  } = useFollowups();
  const { toast } = useToast();

  const [modal, setModal] = useState<{ type: FollowupEntityType; name: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** An entry being corrected. Only its author (or an admin) can open this — see canModify. */
  const [editing, setEditing] = useState<Followup | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (f: Followup) => {
    if (!window.confirm("Delete this follow-up? The remark and its history will be removed.")) return;
    setDeletingId(f.id);
    try {
      await remove(f.id);
      toast({ title: "Follow-up deleted" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  // ── "Due" tab state ──────────────────────────────────────────────────────────
  // Default to the whole team, NOT "mine". Ownership here is implicit — whoever logged the last
  // entry owns the next chase — so a supervisor who oversees the team but never logs a call
  // personally owns nothing, and a "mine" default renders them a blank tab (the reported bug).
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [bucket, setBucket] = useState<"overdue" | "today" | "upcoming" | "all">("all");
  const [duePage, setDuePage] = useState(1);

  // ── "Activity Log" tab state ─────────────────────────────────────────────────
  const today = todayISO();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [logUser, setLogUser] = useState("all");
  const [logOutcome, setLogOutcome] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [logPage, setLogPage] = useState(1);

  // ── Due list ─────────────────────────────────────────────────────────────────
  const dueItems = useMemo<DueItem[]>(() => {
    let items = bucket === "all" ? due.all : due[bucket];
    // "Mine" = the last person who touched this customer is me. Ownership is implicit —
    // whoever logged the most recent follow-up owns the next one.
    if (scope === "mine") items = items.filter((i) => i.followup.createdBy === user.id);
    return items;
  }, [due, bucket, scope, user.id]);

  const duePageItems = useMemo(
    () => dueItems.slice((duePage - 1) * PAGE_SIZE, duePage * PAGE_SIZE),
    [dueItems, duePage],
  );

  // ── Activity log ─────────────────────────────────────────────────────────────
  const logRows = useMemo<Followup[]>(() => {
    const q = logSearch.trim().toLowerCase();
    return all.filter((f) => {
      const day = f.createdAt.slice(0, 10); // "YYYY-MM-DD" — the log is filtered by the day it was LOGGED
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (logUser !== "all" && f.createdBy !== logUser) return false;
      if (logOutcome !== "all" && f.outcome !== logOutcome) return false;
      if (q && !f.entityName.toLowerCase().includes(q) && !f.remarks.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, fromDate, toDate, logUser, logOutcome, logSearch]);

  const logPageItems = useMemo(
    () => logRows.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE),
    [logRows, logPage],
  );

  /** Everyone who has ever logged a follow-up in the visible set — the log's user filter. */
  const logUsers = useMemo(() => {
    const ids = [...new Set(all.map((f) => f.createdBy))];
    return ids
      .map((id) => ({ id, name: personName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, personName]);

  const upcoming7 = useMemo(() => {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const cutoff = limit.toISOString().slice(0, 10);
    return due.upcoming.filter((i) => i.nextDate <= cutoff).length;
  }, [due.upcoming]);

  const exportLog = () => {
    const rows = logRows.map((f) => ({
      "Logged On": formatDateTimeDMY(f.createdAt),
      "Customer / Group": f.entityName,
      "Type": f.entityType === "group" ? "Group" : "Customer",
      "Salesperson": f.salesperson ?? "",
      "Outcome": outcomeLabel(f.outcome),
      "Remarks": f.remarks,
      "Next Follow-up": f.nextFollowupDate ? formatDateDMY(f.nextFollowupDate) : "",
      "Promised Amount": f.promisedAmount ?? "",
      "Promised By": f.promisedDate ? formatDateDMY(f.promisedDate) : "",
      "Outstanding (at entry)": f.outstandingAtEntry ?? "",
      "Logged By": personName(f.createdBy),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    styleRow(ws, 0, 11, HEADER_STYLE);
    ws["!cols"] = [
      { wch: 18 }, { wch: 34 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 60 },
      { wch: 15 }, { wch: 16 }, { wch: 13 }, { wch: 20 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Follow-ups");
    XLSX.writeFile(wb, `followups_${fromDate}_to_${toDate}.xlsx`);
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading follow-ups…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load follow-ups: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold text-foreground">Follow-ups</h1>
          <p className="text-xs text-muted-foreground">
            Your payment-chase worklist, and the running history with every client.
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setPickerOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Log follow-up
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icon={AlarmClock} tone="red" label="Overdue" value={String(due.overdue.length)}
             sub="Chase date has passed" />
        <Kpi icon={CalendarClock} tone="amber" label="Due today" value={String(due.today.length)}
             sub="Scheduled for today" />
        <Kpi icon={CalendarClock} tone="slate" label="Upcoming (7d)" value={String(upcoming7)}
             sub="Next 7 days" />
        <Kpi icon={HandCoins} tone="emerald" label="Promised" value={fmtINRMoney(promisedTotal)}
             sub="Standing promises to pay" />
        <Kpi icon={TriangleAlert} tone="red" label="Broken promises" value={String(brokenPromises.length)}
             sub="Promise date passed" />
      </div>

      <Tabs defaultValue="due">
        <TabsList>
          <TabsTrigger value="due">Due</TabsTrigger>
          <TabsTrigger value="log">Activity Log</TabsTrigger>
        </TabsList>

        {/* ── DUE: the worklist ──────────────────────────────────────────────── */}
        <TabsContent value="due" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onValueChange={(v) => { setScope(v as "mine" | "all"); setDuePage(1); }}>
              <SelectTrigger className="h-8 w-[190px] rounded-input border-border text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">My follow-ups</SelectItem>
                <SelectItem value="all">All (in my scope)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bucket} onValueChange={(v) => { setBucket(v as typeof bucket); setDuePage(1); }}>
              <SelectTrigger className="h-8 w-[160px] rounded-input border-border text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scheduled</SelectItem>
                <SelectItem value="overdue">Overdue ({due.overdue.length})</SelectItem>
                <SelectItem value="today">Due today ({due.today.length})</SelectItem>
                <SelectItem value="upcoming">Upcoming ({due.upcoming.length})</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {dueItems.length} customer{dueItems.length === 1 ? "" : "s"} to chase
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              {dueItems.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium text-foreground">Nothing scheduled</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scope === "mine"
                      ? "You haven't logged any follow-ups yourself. Switch to \"All\" to see the team's."
                      : "No follow-up dates are set yet."}
                  </p>
                  <Button size="sm" className="mt-4" onClick={() => setPickerOpen(true)}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Log follow-up
                  </Button>
                </div>
              ) : (
                <ScrollableTable>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Customer</TableHead>
                        <TableHead className="text-right text-xs">Outstanding</TableHead>
                        <TableHead className="text-right text-xs">Overdue</TableHead>
                        <TableHead className="text-xs">Next Follow-up</TableHead>
                        <TableHead className="text-xs">Last Outcome</TableHead>
                        <TableHead className="text-xs">Last Remark</TableHead>
                        <TableHead className="text-xs">Owner</TableHead>
                        <TableHead className="text-right text-xs">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {duePageItems.map((i) => (
                        <TableRow key={entityKey(i.entityType, i.entityName)}>
                          <TableCell className="text-xs">
                            <EntityLink type={i.entityType} name={i.entityName} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmtINRMoney(i.outstanding)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-red-600">{fmtINRMoney(i.overdue)}</TableCell>
                          <TableCell>
                            <NextFollowupCell
                              latest={i.followup}
                              onLog={() => setModal({ type: i.entityType, name: i.entityName })}
                            />
                          </TableCell>
                          <TableCell>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${outcomeBadgeClass(i.followup.outcome)}`}>
                              {outcomeLabel(i.followup.outcome)}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[320px] truncate text-[11px] text-muted-foreground" title={i.followup.remarks}>
                            {i.followup.remarks}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {personName(i.followup.createdBy)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => setModal({ type: i.entityType, name: i.entityName })}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Log
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableTable>
              )}
            </CardContent>
          </Card>

          <Pager page={duePage} setPage={setDuePage} total={dueItems.length} />
        </TabsContent>

        {/* ── ACTIVITY LOG: what the team actually did ───────────────────────── */}
        <TabsContent value="log" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">From</label>
              <Input
                type="date" value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setLogPage(1); }}
                className="h-8 w-[150px] rounded-input text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">To</label>
              <Input
                type="date" value={toDate}
                onChange={(e) => { setToDate(e.target.value); setLogPage(1); }}
                className="h-8 w-[150px] rounded-input text-sm"
              />
            </div>
            {isAdmin && (
              <Select value={logUser} onValueChange={(v) => { setLogUser(v); setLogPage(1); }}>
                <SelectTrigger className="h-8 w-[170px] rounded-input border-border text-sm">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {logUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={logOutcome} onValueChange={(v) => { setLogOutcome(v); setLogPage(1); }}>
              <SelectTrigger className="h-8 w-[170px] rounded-input border-border text-sm">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {OUTCOME_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search customer or remark…"
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); setLogPage(1); }}
                className="h-8 w-[240px] rounded-input pl-7 text-sm"
              />
            </div>
            <Button
              variant="outline" size="sm" className="ml-auto h-8"
              onClick={exportLog} disabled={logRows.length === 0}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {logRows.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium text-foreground">No follow-ups in this range</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Widen the date range, or clear the filters.
                  </p>
                </div>
              ) : (
                <ScrollableTable>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Logged On</TableHead>
                        <TableHead className="text-xs">Customer</TableHead>
                        <TableHead className="text-xs">Outcome</TableHead>
                        <TableHead className="text-xs">Remark</TableHead>
                        <TableHead className="text-xs">Next Follow-up</TableHead>
                        <TableHead className="text-right text-xs">Promised</TableHead>
                        <TableHead className="text-xs">Logged By</TableHead>
                        <TableHead className="text-right text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logPageItems.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {formatDateTimeDMY(f.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <EntityLink type={f.entityType} name={f.entityName} />
                          </TableCell>
                          <TableCell>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${outcomeBadgeClass(f.outcome)}`}>
                              {outcomeLabel(f.outcome)}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[380px] truncate text-[11px] text-foreground" title={f.remarks}>
                            {f.remarks}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {f.nextFollowupDate ? formatDateDMY(f.nextFollowupDate) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono text-xs text-emerald-700">
                            {f.promisedAmount != null ? fmtINRMoney(f.promisedAmount) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {personName(f.createdBy)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="inline-flex items-center justify-end gap-1">
                              {/* Anyone may APPEND to a colleague's thread — that's how a chase is
                                  continued. Correcting an existing entry is author-only (canModify),
                                  so nobody can rewrite what someone else recorded. */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px]"
                                title="Add a new follow-up for this customer"
                                onClick={() => setModal({ type: f.entityType, name: f.entityName })}
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                Log another
                              </Button>
                              {canModify(f) && (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    title="Edit this follow-up"
                                    onClick={() => setEditing(f)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-red-600 hover:text-red-700"
                                    title="Delete this follow-up"
                                    disabled={deletingId === f.id}
                                    onClick={() => handleDelete(f)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableTable>
              )}
            </CardContent>
          </Card>

          <Pager page={logPage} setPage={setLogPage} total={logRows.length} />
        </TabsContent>
      </Tabs>

      <FollowupEntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(entity) => setModal(entity)}
      />

      {modal && (
        <FollowupModal
          open={!!modal}
          onOpenChange={(o) => !o && setModal(null)}
          entityType={modal.type}
          entityName={modal.name}
        />
      )}

      {editing && (
        <FollowupModal
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          entityType={editing.entityType}
          entityName={editing.entityName}
          editing={editing}
        />
      )}
    </div>
  );
}

