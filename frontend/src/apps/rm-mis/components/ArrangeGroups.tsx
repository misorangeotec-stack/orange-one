/**
 * ARRANGE BY GROUP OR CATEGORY — copied from Ink IMS (user, 13-10-2026: "the same way as INK IMS,
 * arranging by group or category"). RM differences: a Group / Category switch decides what the
 * buckets are; Category is each item's own (Bushra Central Master's), so the old group-level
 * Category picker is gone, and moving an item to another bucket sets its group or its category.
 * Import/Plant stays a group-level choice, offered in Group mode only. Ink IMS's notes follow.
 *
 * ARRANGE BY GROUP (Ink IMS, 12-10-2026) — number the whole sheet by putting GROUPS in order.
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
 * CLICK A GROUP TO OPEN IT (user, 12-10-2026): its inks are listed underneath, each one draggable
 * (or arrowed) into its own place and tickable on or off the dashboard. Arranging inks by hand
 * turns that group to "Custom" order; choosing Keep order or A–Z again drops the custom order.
 *
 * EDIT IN PLACE (user, 12-10-2026): each ink has a Group box that moves it to another group (saved
 * as that ink's group in the item master), and each group sets its Category and Import/Plant —
 * the same group-level fields as the item master table, so both screens edit one value.
 *
 * TYPE A NUMBER (user, 12-10-2026): an ink's new number can be typed — the ink moves to that place
 * inside its group (a number outside the group's range puts it first or last; moving between
 * groups is the Group box's job). A group's number is where it starts: typing 25 moves the whole
 * group to start at 25, and the groups after it shift down.
 *
 * ONLY THE ITEM MASTER'S OWN ROWS (user, 13-10-2026): the panel is handed exactly the rows the
 * item master lists (its Ink groups / Only items with stock switches apply) and files each ink
 * under the Group those rows show. Where an ink's listed rows show two groups, the one most of
 * them show wins. Nothing else is consulted — not other books' rows the list is not showing.
 * A numbered ink that is not listed keeps its number, after all the groups.
 *
 * The result lands in the DRAFT: the table shows the new numbers and nothing is stored until
 * the planner presses Save changes. Numbers this screen cannot place (items outside the loaded
 * groups) are kept, after everything else, in their old order — never dropped.
 */
import { Fragment, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  INK_SOURCES, lineGroupOf, type InkGroupFields, type InkLineFields, type InkMasterRow,
  type InkOrder,
} from "../lib/rmMis";

/** What the buckets are. */
export type ArrangeBy = "group" | "category";

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
  /** The planner's own ink order for this group, by key. Null = the Keep order / A–Z rule. */
  custom: string[] | null;
  /** Inks the planner unticked: they leave the dashboard. */
  skip: string[];
}

const groupId = (g: string) => g.trim().toUpperCase() || "(NO GROUP)";

/** A number box that shows the live number and acts only on Enter or when it is left. */
function NumberBox({
  value,
  onCommit,
  disabled,
  title,
  bold,
}: {
  value: number | undefined;
  onCommit: (n: number) => void;
  disabled?: boolean;
  title: string;
  bold?: boolean;
}) {
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (raw.trim() && Number.isFinite(n) && n >= 1 && n !== value) onCommit(n);
  };
  return (
    <input
      // Re-mounted when the live number changes, so the box always shows the current one.
      key={value ?? "none"}
      type="number"
      min={1}
      defaultValue={value ?? ""}
      disabled={disabled}
      title={title}
      placeholder={disabled ? "off" : "–"}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
      }}
      className={`h-6 w-14 rounded border bg-background px-1 text-right text-xs tabular-nums disabled:border-transparent disabled:bg-transparent ${
        bold ? "font-medium" : ""
      }`}
    />
  );
}

/** Every ink the group can number, in display order — unticked ones included. */
function candidatesOf(g: GroupEntry): Line[] {
  const members = g.lines.filter((l) => l.num !== undefined || l.inStock);
  if (g.custom) {
    const at = new Map(g.custom.map((k, i) => [k, i]));
    return [...members].sort((a, b) => (at.get(a.key) ?? 1e9) - (at.get(b.key) ?? 1e9));
  }
  if (g.az) return [...members].sort((a, b) => a.label.localeCompare(b.label));
  const numbered = members.filter((l) => l.num !== undefined).sort((a, b) => a.num! - b.num!);
  const fresh = members.filter((l) => l.num === undefined).sort((a, b) => a.label.localeCompare(b.label));
  return [...numbered, ...fresh];
}

/** Members of a group in the order they will be numbered: the candidates still ticked. */
function membersOf(g: GroupEntry): Line[] {
  return candidatesOf(g).filter((l) => !g.skip.includes(l.key));
}

/** The category a line is filed under: the first one its rows show (they describe one item). */
const lineCategoryOf = (rows: InkMasterRow[]) =>
  rows.map((r) => (r.category || "").trim()).find(Boolean) ?? "";

export function buildGroups(master: InkMasterRow[], order: InkOrder, by: ArrangeBy = "group"): GroupEntry[] {
  // The Group each listed row SHOWS, gathered per ink; most rows' group wins (lineGroupOf).
  const rowsOf = new Map<string, InkMasterRow[]>();
  for (const r of master) {
    const list = rowsOf.get(r.mergeKey) ?? [];
    list.push(r);
    rowsOf.set(r.mergeKey, list);
  }
  // One entry per printed line.
  const lines = new Map<string, { line: Line; group: string }>();
  for (const r of master) {
    const existing = lines.get(r.mergeKey);
    if (existing) {
      if (r.closingQty) existing.line.inStock = true;
      continue;
    }
    lines.set(r.mergeKey, {
      group:
        by === "category"
          ? lineCategoryOf(rowsOf.get(r.mergeKey) ?? [r])
          : lineGroupOf(rowsOf.get(r.mergeKey) ?? [r]) || r.effectiveGroup || "",
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
    const g = groups.get(id) ?? {
      id,
      name: group.trim() || (by === "category" ? "(No category)" : "(No group)"),
      lines: [], include: false, az: false, custom: null, skip: [],
    };
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
  // Keys no listed line owns (not in the item master's list, e.g. out of stock): kept, after
  // the rest, in their old order — never dropped.
  const rest = Object.entries(order)
    .filter(([k]) => !handled.has(k))
    .sort((a, b) => a[1] - b[1]);
  for (const [k] of rest) next[k] = n++;
  return next;
}

export default function ArrangeGroups({
  by,
  categories = [],
  master,
  order,
  groupFields,
  onGroupField,
  onApply,
  onClose,
}: {
  by: ArrangeBy;
  /** Every category Bushra Central Master uses — what an item can be moved to in Category mode. */
  categories?: string[];
  master: InkMasterRow[];
  order: InkOrder;
  /** Category and Import/Plant per group (upper-cased name), the item master's own draft. */
  groupFields: InkGroupFields;
  onGroupField: (groupName: string, field: keyof InkLineFields, value: string) => void;
  /** New numbering, plus items moved to another bucket: line key -> group (or category) name. */
  onApply: (next: InkOrder, regroup: Record<string, string>) => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => buildGroups(master, order, by), [master, order, by]);
  const [groups, setGroups] = useState<GroupEntry[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  /** Which ink is being dragged inside the open group — kept apart from group drags. */
  const inkDrag = useRef<number | null>(null);

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

  /** Move one ink inside a group; the group then keeps that exact order. */
  const moveInk = (g: GroupEntry, from: number, to: number) => {
    const keys = candidatesOf(g).map((l) => l.key);
    if (to < 0 || to >= keys.length || from === to) return;
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    patch(g.id, { custom: keys });
  };
  /** Inks moved to another group here, line key -> new group name. */
  const [regroup, setRegroup] = useState<Record<string, string>>({});
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    if (by === "category") {
      for (const c of categories) if (c.trim()) names.add(c.trim());
      for (const r of master) if (r.category?.trim()) names.add(r.category.trim());
    } else {
      for (const r of master) if (r.effectiveGroup?.trim()) names.add(r.effectiveGroup.trim());
    }
    for (const g of groups) names.add(g.name);
    return [...names].sort();
  }, [master, groups, by, categories]);

  /** Move an ink to another group: it joins the end of that group, ticked. */
  const moveToGroup = (from: GroupEntry, line: Line, toName: string) => {
    const toId = groupId(toName);
    if (toId === from.id) return;
    setGroups((prev) => {
      let next = prev.map((g) =>
        g.id === from.id
          ? {
              ...g,
              lines: g.lines.filter((l) => l.key !== line.key),
              custom: g.custom ? g.custom.filter((k) => k !== line.key) : null,
              skip: g.skip.filter((k) => k !== line.key),
            }
          : g,
      );
      if (!next.some((g) => g.id === toId)) {
        next = [
          ...next,
          { id: toId, name: toName, lines: [], include: true, az: false, custom: null, skip: [] },
        ];
      }
      return next.map((g) =>
        g.id === toId
          ? {
              ...g,
              include: true,
              lines: [...g.lines, line],
              // Joins at the END of the group, whatever its rule, so it is easy to find.
              custom: [...candidatesOf(g).map((l) => l.key), line.key],
            }
          : g,
      );
    });
    setRegroup((prev) => ({ ...prev, [line.key]: toName }));
  };

  /** Put an ink at number n inside its group (clamped to the group's own range). */
  const inkToNumber = (g: GroupEntry, key: string, n: number) => {
    const start = starts.get(g.id);
    const members = membersOf(g);
    if (start === undefined || !members.length) return;
    const t = Math.min(Math.max(n - start, 0), members.length - 1);
    const keys = candidatesOf(g).map((l) => l.key);
    const from = keys.indexOf(key);
    const to = keys.indexOf(members[t].key);
    if (from >= 0 && to >= 0) moveInk(g, from, to);
  };

  /** Move a group so it starts at number n: it goes in front of the group that holds n now. */
  const groupToNumber = (g: GroupEntry, n: number) =>
    setGroups((prev) => {
      const others = prev.filter((x) => x.id !== g.id);
      let at = others.length;
      let next = 1;
      for (let k = 0; k < others.length; k++) {
        if (!others[k].include) continue;
        const count = membersOf(others[k]).length;
        if (next + count - 1 >= n) {
          at = k;
          break;
        }
        next += count;
      }
      return [...others.slice(0, at), g, ...others.slice(at)];
    });

  const toggleInk = (g: GroupEntry, key: string, on: boolean) =>
    patch(g.id, { skip: on ? g.skip.filter((k) => k !== key) : [...g.skip, key] });

  // The range each ticked group will get, and where it starts, for the preview columns.
  const { ranges, starts } = useMemo(() => {
    const out = new Map<string, string>();
    const first = new Map<string, number>();
    let n = 1;
    for (const g of groups) {
      if (!g.include) continue;
      const count = membersOf(g).length;
      first.set(g.id, n);
      out.set(g.id, count ? (count === 1 ? `${n}` : `${n}–${n + count - 1}`) : "–");
      n += count;
    }
    return { ranges: out, starts: first };
  }, [groups]);

  const dropped = groups.filter((g) => !g.include && g.lines.some((l) => l.num !== undefined));
  const droppedInks = groups.reduce(
    (t, g) =>
      t + (g.include ? g.lines.filter((l) => g.skip.includes(l.key) && l.num !== undefined).length : 0),
    0,
  );

  return (
    <div className="rounded-md border-2 border-primary/40 bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Arrange by {by}</strong>
        <span className="text-muted-foreground">
          Drag the {by === "category" ? "categories" : "groups"} into order and tick the ones for the
          dashboard. Click one to arrange its items.
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-2 max-h-[55vh] overflow-y-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-[1] bg-muted text-left text-muted-foreground">
            <tr>
              <th className="w-20 px-2 py-1 font-normal">Move</th>
              <th className="w-10 px-1 py-1 font-normal">Show</th>
              <th className="px-2 py-1 font-normal">{by === "category" ? "Category" : "Group"}</th>
              <th className="w-24 px-2 py-1 text-right font-normal">Items</th>
              <th className="w-28 px-2 py-1 font-normal">{by === "group" ? "Import/Plant" : ""}</th>
              <th className="w-28 px-2 py-1 font-normal">Inside</th>
              <th className="w-24 px-2 py-1 text-right font-normal">Numbers</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => {
              const members = membersOf(g);
              const fresh = members.filter((l) => l.num === undefined).length;
              const isOpen = open === g.id;
              const start = starts.get(g.id);
              const inks = isOpen ? candidatesOf(g) : [];
              let pos = 0;
              return (
                <Fragment key={g.id}>
                  <tr
                    draggable
                    onDragStart={() => {
                      dragFrom.current = i;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current !== null) move(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    className={`border-t ${g.include ? "" : "text-muted-foreground"} ${isOpen ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-0.5">
                        <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground" />
                        <button type="button" aria-label="Move group up" onClick={() => move(i, i - 1)} disabled={i === 0} className="disabled:opacity-30">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" aria-label="Move group down" onClick={() => move(i, i + 1)} disabled={i === groups.length - 1} className="disabled:opacity-30">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="checkbox"
                        checked={g.include}
                        onChange={(e) => patch(g.id, { include: e.target.checked })}
                        title="Put this bucket's items on the dashboard"
                      />
                    </td>
                    <td className="px-2 py-1 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-left hover:underline"
                        onClick={() => setOpen(isOpen ? null : g.id)}
                        title="Open to arrange its items"
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {g.name}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {members.length}
                      {fresh > 0 && g.include && <span className="ml-1 text-emerald-700">+{fresh} new</span>}
                    </td>
                    <td className="px-2 py-1">
                      {by === "group" && (
                        <select
                          className="h-6 w-full rounded border bg-background px-1 text-xs"
                          value={groupFields[g.id]?.source ?? ""}
                          onChange={(e) => onGroupField(g.name, "source", e.target.value)}
                          title="Import / Domestic / Plant for every item in this group"
                        >
                          <option value="">—</option>
                          {INK_SOURCES.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="h-6 rounded border bg-background px-1 text-xs"
                        value={g.custom ? "custom" : g.az ? "az" : "keep"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "custom") patch(g.id, { az: v === "az", custom: null });
                        }}
                      >
                        <option value="keep">Keep order</option>
                        <option value="az">A–Z</option>
                        {g.custom && <option value="custom">Custom</option>}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1">
                        <NumberBox
                          value={g.include ? start : undefined}
                          disabled={!g.include}
                          onCommit={(n) => groupToNumber(g, n)}
                          title="Type where this bucket should start"
                          bold
                        />
                        {g.include && <span className="w-12 text-left text-[10px] text-muted-foreground">{ranges.get(g.id)}</span>}
                      </span>
                    </td>
                  </tr>
                  {inks.map((l, j) => {
                    const on = !g.skip.includes(l.key);
                    const newNum = g.include && on && start !== undefined ? start + pos++ : undefined;
                    return (
                      <tr
                        key={`${g.id}|${l.key}`}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          inkDrag.current = j;
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.stopPropagation();
                          if (inkDrag.current !== null) moveInk(g, inkDrag.current, j);
                          inkDrag.current = null;
                        }}
                        className={`bg-muted/30 ${on ? "" : "text-muted-foreground line-through"}`}
                      >
                        <td className="py-0.5 pl-6 pr-2">
                          <span className="inline-flex items-center gap-0.5">
                            <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
                            <button type="button" aria-label="Move item up" onClick={() => moveInk(g, j, j - 1)} disabled={j === 0} className="disabled:opacity-30">
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button type="button" aria-label="Move item down" onClick={() => moveInk(g, j, j + 1)} disabled={j === inks.length - 1} className="disabled:opacity-30">
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </span>
                        </td>
                        <td className="px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => toggleInk(g, l.key, e.target.checked)}
                            title="Put this item on the dashboard"
                          />
                        </td>
                        <td className="py-0.5 pl-6 pr-2">
                          {l.label}
                          {!l.inStock && <span className="ml-2 text-[10px] text-muted-foreground">no stock</span>}
                          {l.num === undefined && <span className="ml-2 text-[10px] text-emerald-700">new</span>}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums text-muted-foreground">
                          {l.num !== undefined ? `was ${l.num}` : ""}
                        </td>
                        <td className="px-2 py-0.5">
                          <select
                            className="h-6 w-full rounded border bg-background px-1 text-xs"
                            value={g.name}
                            onChange={(e) => moveToGroup(g, l, e.target.value)}
                            title={`Move this item to another ${by}`}
                          >
                            {groupNames.map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </td>
                        <td />
                        <td className="px-2 py-0.5 text-right">
                          <NumberBox
                            value={newNum}
                            disabled={newNum === undefined}
                            onCommit={(n) => inkToNumber(g, l.key, n)}
                            title="Type this item's number (within its bucket)"
                          />
                          <span className="inline-block w-12" />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {droppedInks > 0 && (
        <p className="mt-2 text-xs text-amber-800">
          {droppedInks} numbered item{droppedInks === 1 ? " is" : "s are"} unticked and will leave
          the dashboard.
        </p>
      )}
      {dropped.length > 0 && (
        <p className="mt-2 text-xs text-amber-800">
          Unticked {dropped.length === 1 ? "group" : "groups"} with numbers today — their items will
          leave the dashboard: {dropped.map((g) => g.name).join(", ")}.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onApply(numberByGroups(groups, order), regroup)}>
          Number all items
        </Button>
        <span className="text-xs text-muted-foreground">
          Uses only the rows the item master lists; numbered items not listed go after the{" "}
          {by === "category" ? "categories" : "groups"}. Fills the numbers (and any {by} moves) into
          the table. Check, then press Save.
        </span>
      </div>
    </div>
  );
}
