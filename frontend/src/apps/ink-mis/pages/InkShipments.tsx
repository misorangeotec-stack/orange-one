/**
 * INK MIS — ETD / ETA entry.
 *
 * The typing half of the ink planner. Tally holds no expected-departure or expected-arrival
 * date, so every consignment on this screen is entered by hand, exactly as it is in the Excel
 * sheet this replaces. One card here is one shipment column there.
 *
 * A consignment is deleted once the goods are received. From that moment Tally carries the
 * quantity in closing stock, so keeping the consignment would count the same ink twice and
 * overstate cover — which is the one error this screen exists to prevent.
 *
 * EVERYTHING SAVES TO THIS BROWSER, by an explicit decision not to add a shared table. The
 * banner says so plainly and the export button is the backup. That is not a detail to soften:
 * a planner who assumes the team can see these dates will be wrong.
 *
 * Autosave is immediate rather than behind a Save button. The sheet being replaced saved on
 * every keystroke, and a half-entered consignment is worth more than a lost one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appBasePath } from "../../appInfo";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Download, LayoutDashboard, Plus, Trash2, Upload,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { salesFyOptions } from "@hub/lib/salesReport";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import {
  INK_COMPANIES, SHIPMENT_STATUSES, applyBackup, buildBackup, emptyShipment, fmtQty,
  loadInkPositions, loadShipments, newId, saveShipments,
  type Shipment, type ShipmentStatus,
} from "../lib/inkMis";

const BASE = appBasePath("ink-mis");

/** Status drives the date's meaning, so the label has to move with it. */
/**
 * Filters for the consignment list — the same controls and chips as the item master table.
 * They only HIDE cards; every edit still goes to the full list, so a filtered-out consignment is
 * never lost or overwritten. Adding a consignment clears them, or the new blank card would be
 * created invisible behind a filter it cannot yet match.
 */
interface PipeFilters {
  reference: string;
  statuses: string[];
  books: string[];     // InkCompany.key, or "none" for combined-only
  inks: string[];      // item codes
  from: string;        // ISO date, inclusive
  to: string;
}

const NO_PIPE_FILTERS: PipeFilters = { reference: "", statuses: [], books: [], inks: [], from: "", to: "" };

const DATE_LABEL: Record<ShipmentStatus, string> = {
  ETD: "Expected departure",
  ETA: "Expected arrival",
  "AT PORT": "Landed on",
};

export default function InkShipments() {
  const [shipments, setShipments] = useState<Shipment[]>(() => loadShipments());
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [pf, setPf] = useState<PipeFilters>(NO_PIPE_FILTERS);
  const setPipe = <K extends keyof PipeFilters>(k: K, v: PipeFilters[K]) =>
    setPf((prev) => ({ ...prev, [k]: v }));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveShipments(shipments);
  }, [shipments]);

  // The item dropdown is the real ink list from Tally, not a typed-in code. A consignment
  // against a code that does not exist would never join to a stock line on the dashboard.
  const fy = useMemo(() => salesFyOptions()[0], []);
  const { data, isLoading } = useQuery({
    queryKey: ["inkMis", "positions", fy],
    queryFn: () => loadInkPositions(fy),
    staleTime: 5 * 60 * 1000,
  });
  const items = useMemo(() => data?.rows ?? [], [data]);

  /* ------------------------------------------------------------------ mutators */

  const addShipment = () => {
    setPf(NO_PIPE_FILTERS);
    setShipments((prev) => [...prev, emptyShipment()]);
  };

  const removeShipment = (id: string) =>
    setShipments((prev) => prev.filter((s) => s.id !== id));

  const patchShipment = (id: string, patch: Partial<Shipment>) =>
    setShipments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addLine = (shipmentId: string) =>
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId
          ? { ...s, lines: [...s.lines, { id: newId(), itemCode: "", qty: 0 }] }
          : s,
      ),
    );

  const removeLine = (shipmentId: string, lineId: string) =>
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId ? { ...s, lines: s.lines.filter((l) => l.id !== lineId) } : s,
      ),
    );

  const patchLine = (shipmentId: string, lineId: string, patch: { itemCode?: string; qty?: number }) =>
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId
          ? { ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
          : s,
      ),
    );

  /* ------------------------------------------------------------------- backup */

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ink-mis-backup ${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    try {
      applyBackup(await file.text());
      setShipments(loadShipments());
      setNotice({ kind: "ok", text: "Backup restored." });
    } catch (e) {
      setNotice({ kind: "bad", text: e instanceof Error ? e.message : "Could not read that file." });
    }
  };

  /* --------------------------------------------------------------------- view */

  const statusOpts = SHIPMENT_STATUSES.map((st) => ({ value: st, label: st }));
  const bookOpts = [
    { value: "none", label: "Combined only" },
    ...INK_COMPANIES.map((c) => ({ value: c.key, label: c.label })),
  ];
  const inkOpts = items.map((it) => ({ value: it.itemCode || it.key, label: `${it.itemCode || "(no code)"} — ${it.description}` }));

  const visibleShipments = useMemo(() => {
    const ref = pf.reference.trim().toUpperCase();
    return shipments.filter((s) => {
      if (ref && !s.reference.toUpperCase().includes(ref) && !s.note.toUpperCase().includes(ref)) return false;
      if (pf.statuses.length && !pf.statuses.includes(s.status)) return false;
      if (pf.books.length && !pf.books.includes(s.company || "none")) return false;
      if (pf.inks.length && !s.lines.some((l) => pf.inks.includes(l.itemCode))) return false;
      // An undated consignment is kept out of a date filter rather than guessed into it.
      if ((pf.from || pf.to) && !s.date) return false;
      if (pf.from && s.date < pf.from) return false;
      if (pf.to && s.date > pf.to) return false;
      return true;
    });
  }, [shipments, pf]);

  const labelOf = (v: string, opts: { value: string; label: string }[]) => opts.find((o) => o.value === v)?.label ?? v;
  const chips: ActiveFilter[] = [];
  if (pf.reference.trim()) chips.push({ key: "ref", label: `Reference: ${pf.reference.trim()}`, onClear: () => setPipe("reference", "") });
  if (pf.statuses.length) chips.push({ key: "status", label: `Status: ${pf.statuses.join(", ")}`, onClear: () => setPipe("statuses", []) });
  if (pf.books.length) chips.push({ key: "book", label: `Book: ${pf.books.map((b) => labelOf(b, bookOpts)).join(", ")}`, onClear: () => setPipe("books", []) });
  if (pf.inks.length) chips.push({ key: "ink", label: `Ink: ${pf.inks.join(", ")}`, onClear: () => setPipe("inks", []) });
  if (pf.from || pf.to) chips.push({ key: "date", label: `Date: ${pf.from || "…"} to ${pf.to || "…"}`, onClear: () => setPf((prev) => ({ ...prev, from: "", to: "" })) });

  const slim = "py-1.5 px-2.5 text-[12.5px]";

  const totalIncoming = shipments
    .filter((s) => s.status !== "ETD")
    .reduce((sum, s) => sum + s.lines.reduce((t, l) => t + (l.qty || 0), 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ink pipeline — ETD and ETA entry</h1>
          <p className="text-sm text-muted-foreground">
            One card per consignment. Delete a consignment once the goods are received.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportBackup}>
            <Download className="mr-2 h-4 w-4" /> Export backup
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Import backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" asChild variant="secondary">
            <Link to={`${BASE}/dashboard`}>
              <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          These consignments are saved in <strong>this browser only</strong>. Nobody else can see
          them and clearing your browsing data will erase them. Export a backup regularly.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-md border p-3 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">{shipments.length}</strong> consignment
          {shipments.length === 1 ? "" : "s"}
        </span>
        <span>
          <strong className="text-foreground">{fmtQty(totalIncoming)}</strong> KGS on the water or
          at port
        </span>
      </div>

      {shipments.length > 0 && (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Reference or note</span>
              <Input className="h-9" placeholder="Contains…" value={pf.reference} onChange={(e) => setPipe("reference", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <MultiSelect values={pf.statuses} onChange={(v) => setPipe("statuses", v)} options={statusOpts} placeholder="All" className="w-full" triggerClassName={slim} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Landing book</span>
              <MultiSelect values={pf.books} onChange={(v) => setPipe("books", v)} options={bookOpts} placeholder="All" className="w-full" triggerClassName={slim} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Ink</span>
              <MultiSelect values={pf.inks} onChange={(v) => setPipe("inks", v)} options={inkOpts} placeholder="All" className="w-full" triggerClassName={slim} searchable />
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Date between</span>
              <div className="flex items-center gap-1">
                <Input type="date" className="h-9" value={pf.from} onChange={(e) => setPipe("from", e.target.value)} />
                <Input type="date" className="h-9" value={pf.to} onChange={(e) => setPipe("to", e.target.value)} />
              </div>
            </div>
          </div>
          <ActiveFilters filters={chips} onClearAll={() => setPf(NO_PIPE_FILTERS)} />
          {chips.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing {visibleShipments.length} of {shipments.length} consignments.
            </p>
          )}
        </div>
      )}

      {shipments.length > 0 && visibleShipments.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No consignment matches those filters.
        </div>
      )}

      {shipments.length === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No consignments yet. Add one for every order placed or shipment on the water.
          </p>
          <Button className="mt-4" onClick={addShipment}>
            <Plus className="mr-2 h-4 w-4" /> Add consignment
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {visibleShipments.map((s) => {
          const shipmentQty = s.lines.reduce((t, l) => t + (l.qty || 0), 0);
          return (
            <div key={s.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-5">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Reference</span>
                  <Input
                    value={s.reference}
                    placeholder="OTPL/INK/33"
                    onChange={(e) => patchShipment(s.id, { reference: e.target.value })}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Status</span>
                  <Select
                    value={s.status}
                    onValueChange={(v) => patchShipment(s.id, { status: v as ShipmentStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHIPMENT_STATUSES.map((st) => (
                        <SelectItem key={st} value={st}>
                          {st}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {DATE_LABEL[s.status]}
                  </span>
                  <Input
                    type="date"
                    value={s.date}
                    onChange={(e) => patchShipment(s.id, { date: e.target.value })}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Landing book (optional)
                  </span>
                  <Select
                    value={s.company || "none"}
                    onValueChange={(v) => patchShipment(s.id, { company: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Combined only</SelectItem>
                      {INK_COMPANIES.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Note</span>
                  <Input
                    value={s.note}
                    placeholder="Supplier, vessel, remarks"
                    onChange={(e) => patchShipment(s.id, { note: e.target.value })}
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2">
                {s.lines.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[18rem] flex-1">
                      <Select
                        value={l.itemCode || "none"}
                        onValueChange={(v) =>
                          patchLine(s.id, l.id, { itemCode: v === "none" ? "" : v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose an ink" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {isLoading ? "Loading inks…" : "Choose an ink"}
                          </SelectItem>
                          {items.map((it) => (
                            <SelectItem key={it.itemCode} value={it.itemCode}>
                              {it.itemCode} — {it.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="w-32"
                      placeholder="Qty"
                      value={l.qty || ""}
                      onChange={(e) =>
                        patchLine(s.id, l.id, { qty: Number(e.target.value) || 0 })
                      }
                    />
                    <span className="text-xs text-muted-foreground">KGS</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove this ink"
                      onClick={() => removeLine(s.id, l.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <Button variant="outline" size="sm" onClick={() => addLine(s.id)}>
                  <Plus className="mr-2 h-4 w-4" /> Add ink to this consignment
                </Button>
              </div>

              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">
                  Consignment total{" "}
                  <strong className="text-foreground">{fmtQty(shipmentQty)}</strong> KGS
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => removeShipment(s.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete consignment
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {shipments.length > 0 && (
        <Button onClick={addShipment}>
          <Plus className="mr-2 h-4 w-4" /> Add consignment
        </Button>
      )}
    </div>
  );
}
