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
import {
  INK_COMPANIES, SHIPMENT_STATUSES, applyBackup, buildBackup, emptyShipment, fmtQty,
  loadInkPositions, loadShipments, newId, saveShipments,
  type Shipment, type ShipmentStatus,
} from "../lib/inkMis";

const BASE = appBasePath("ink-mis");

/** Status drives the date's meaning, so the label has to move with it. */
const DATE_LABEL: Record<ShipmentStatus, string> = {
  ETD: "Expected departure",
  ETA: "Expected arrival",
  "AT PORT": "Landed on",
};

export default function InkShipments() {
  const [shipments, setShipments] = useState<Shipment[]>(() => loadShipments());
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
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

  const addShipment = () => setShipments((prev) => [...prev, emptyShipment()]);

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
        {shipments.map((s) => {
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
