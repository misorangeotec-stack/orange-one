/**
 * ARRANGE BY GROUP (user, 12-10-2026) — number the whole sheet by putting GROUPS in order.
 *
 * Typing a number against every ink took the planner too long. Here they order the groups once
 * (drag, or the arrows) and tick which groups belong on the dashboard; every ink inside a ticked
 * group is then numbered for them, 1, 2, 3… straight through, group after group.
 *
 * Starts from the sheet as it is: groups in the order their lowest number puts them, ticked when
 * any of their inks is numbered. So pressing "Number all inks" without touching anything only
 * closes gaps and pulls in a ticked group's new inks; nothing is reshuffled unasked.
 *
 * Inside a group the inks keep their current order and new ones follow A–Z, or the whole group
 * goes A–Z. An ink that is out of stock keeps its place if it has a number; an unnumbered one
 * is only added when it has stock, the same rule as everywhere else on this screen.
 *
 * The result lands in the DRAFT: the table shows the new numbers and nothing is stored until
 * the planner presses Save changes. Numbers this screen cannot place (items outside the loaded
 * groups) are kept, after everything else, in their old order — never dropped.
 */
import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import type { InkMasterRow, InkOrder } from "../lib/inkMis";

interface Line {
  key: string;
  legacyKey: string;
  label: string;
  num: number | undefined;
  inStock: boolean;
}

interface GroupEntry {
  id: string; // upper-cased group name
  name: string;
  lines: Line[];
  include: boolean;
  az: boolean;
}

const groupId = (g: string) => g.trim().toUpperCase() || "(NO GROUP)";

/** Members of a group in the order they will be numbered. */
function membersOf(g: GroupEntry): Line[] {
  const members = g.lines.filter((l) => l.num !== undefined || l.inStock);
  if (g.az) return [...members].sort((a, b) => a.label.localeCompare(b.label));
  const numbered = members.filter((l) => l.num !== undefined).sort((a, b) => a.num! - b.num!);
  const fresh = members.filter((l) => l.num === undefined).sort((a, b) => a.label.localeCompare(b.label));
  return [...numbered, ...fresh];
}

export function buildGroups(master: InkMasterRow[], order: InkOrder): GroupEntry[] {
  // One entry per printed line; its group is the group of the line's first row.
  const lines = new Map<string, { line: Line; group: string }>();
  for (const r of master) {
    const existing = lines.get(r.mergeKey);
    if (existing) {
      if (r.closingQty) existing.line.inStock = true;
      continue;
    }
    lines.set(r.mergeKey, {
      group: r.effectiveGroup || "",
      line: {
        key: r.mergeKey,
        legacyKey: r.legacyKey,
        label: r.effectiveDescription || r.item,
        num: order[r.mergeKey] ?? order[r.legacyKey],
        inStock: Boolean(r.closingQty),
      },
    });
  }
  const groups = new Map<string, GroupEntry>();
  for (const { line, group } of lines.values()) {
    const id = groupId(group);
    const g = groups.get(id) ?? { id, name: group.trim() || "(No group)", lines: [], include: false, az: false };
    g.lines.push(line);
    if (line.num !== undefined) g.include = true;
    groups.set(id, g);
  }
  const low = (g: GroupEntry) =>
    Math.min(...g.lines.map((l) => (l.num === undefined ? Infinity : l.num)));
  // Only groups with something to number: a number already, or stock.
  return [...groups.values()]
    .filter((g) => g.lines.some((l) => l.num !== undefined || l.inStock))
    .sort((a, b) => low(a) - low(b) || a.name.localeCompare(b.name));
}

/** The new numbering: ticked groups in order, then every number this screen could not place. */
export function numberByGroups(groups: GroupEntry[], order: InkOrder): InkOrder {
  const next: InkOrder = {};
  const handled = new Set<string>();
  let n = 1;
  for (const g of groups) {
    for (const l of g.lines) {
      handled.add(l.key);
      handled.add(l.legacyKey);
    }
    if (!g.include) continue;
    for (const l of membersOf(g)) next[l.key] = n++;
  }
  // Keys no loaded line owns (items outside these groups): kept, after the rest, in old order.
  const rest = Object.entries(order)
    .filter(([k]) => !handled.has(k))
    .sort((a, b) => a[1] - b[1]);
  for (const [k] of rest) next[k] = n++;
  return next;
}

export default function ArrangeGroups({
  master,
  order,
  onApply,
  onClose,
}: {
  master: InkMasterRow[];
  order: InkOrder;
  onApply: (next: InkOrder) => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => buildGroups(master, order), [master, order]);
  const [groups, setGroups] = useState<GroupEntry[]>(initial);
  const dragFrom = useRef<number | null>(null);

  const move = (from: number, to: number) =>
    setGroups((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [g] = next.splice(from, 1);
      next.splice(to, 0, g);
      return next;
    });
  const patch = (id: string, p: Partial<GroupEntry>) =>
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...p } : g)));

  // The range each ticked group will get, for the preview column.
  const ranges = useMemo(() => {
    const out = new Map<string, string>();
    let n = 1;
    for (const g of groups) {
      if (!g.include) continue;
      const count = membersOf(g).length;
      out.set(g.id, count ? (count === 1 ? `${n}` : `${n}–${n + count - 1}`) : "–");
      n += count;
    }
    return out;
  }, [groups]);

  const dropped = groups.filter((g) => !g.include && g.lines.some((l) => l.num !== undefined));

  return (
    <div className="rounded-md border-2 border-primary/40 bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Arrange by group</strong>
        <span className="text-muted-foreground">
          Drag the groups into order and tick the ones for the dashboard. Every ink in a ticked
          group is numbered for you.
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-2 max-h-[55vh] overflow-y-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
            <tr>
              <th className="w-16 px-2 py-1 font-normal">Move</th>
              <th className="w-10 px-1 py-1 font-normal">Show</th>
              <th className="px-2 py-1 font-normal">Group</th>
              <th className="w-24 px-2 py-1 text-right font-normal">Inks</th>
              <th className="w-28 px-2 py-1 font-normal">Inside group</th>
              <th className="w-24 px-2 py-1 text-right font-normal">Numbers</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => {
              const members = membersOf(g);
              const fresh = members.filter((l) => l.num === undefined).length;
              return (
                <tr
                  key={g.id}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null) move(dragFrom.current, i);
                    dragFrom.current = null;
                  }}
                  className={`border-t ${g.include ? "" : "text-muted-foreground"}`}
                >
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-0.5">
                      <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground" />
                      <button type="button" aria-label="Move up" onClick={() => move(i, i - 1)} disabled={i === 0} className="disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label="Move down" onClick={() => move(i, i + 1)} disabled={i === groups.length - 1} className="disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="checkbox"
                      checked={g.include}
                      onChange={(e) => patch(g.id, { include: e.target.checked })}
                      title="Put this group's inks on the dashboard"
                    />
                  </td>
                  <td className="px-2 py-1 font-medium">{g.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {members.length}
                    {fresh > 0 && g.include && <span className="ml-1 text-emerald-700">+{fresh} new</span>}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className="h-6 rounded border bg-background px-1 text-xs"
                      value={g.az ? "az" : "keep"}
                      onChange={(e) => patch(g.id, { az: e.target.value === "az" })}
                    >
                      <option value="keep">Keep order</option>
                      <option value="az">A–Z</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{g.include ? ranges.get(g.id) : "off"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dropped.length > 0 && (
        <p className="mt-2 text-xs text-amber-800">
          Unticked {dropped.length === 1 ? "group" : "groups"} with numbers today — their inks will
          leave the dashboard: {dropped.map((g) => g.name).join(", ")}.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onApply(numberByGroups(groups, order))}>
          Number all inks
        </Button>
        <span className="text-xs text-muted-foreground">
          Fills the numbers into the table. Check them, then press Save changes.
        </span>
      </div>
    </div>
  );
}
