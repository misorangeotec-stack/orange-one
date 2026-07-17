import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import {
  fetchGlobalMasters,
  fetchMasterUsage,
  saveGlobalMasters,
  newMasterId,
  isActive,
  MASTER_META,
  type Masters,
  type MasterType,
  type MasterItem,
  type MasterUsage,
} from "../lib/mastersWrites";

/** Preset accent colors for interest levels. */
const COLORS = ["#E5484D", "#F8B62B", "#3B82F6", "#27AE60", "#8B5CF6", "#EC4899", "#0EA5E9", "#64748B"];

const MASTER_TYPES: MasterType[] = ["source", "categories", "interestLevels", "askedAbout", "followUpActions"];

/** Renumber `order` to match array position — array order is what every consumer renders. */
const renumber = (items: MasterItem[]): MasterItem[] => items.map((i, idx) => ({ ...i, order: idx + 1 }));

/**
 * Global lead masters admin. The five dropdown lists the Leads surfaces use,
 * managed centrally here (add / rename / reorder / deactivate; interest levels
 * also carry a color). One shared set for the whole org — the mobile Leads app
 * and this dashboard both read it read-only. Admin-only (route-gated; RLS: is_admin).
 *
 * Two things to know before editing this page:
 *
 * 1. Leads reference masters BY ID with NO foreign key (masters are one jsonb
 *    blob, not rows), so nothing in the database can stop a destructive delete.
 *    That guard lives here: an item any lead uses shows no delete button at all —
 *    only Deactivate. Counts come from the `lead_master_usage()` RPC and are
 *    re-checked at save time, because edits batch until Save and a lead can be
 *    captured in between.
 *
 * 2. Display order IS array order on every surface (the mobile picker does a raw
 *    .map with no sort), so saving the array in the order shown here is what
 *    actually reorders the app — including on already-installed phones. `order`
 *    is renumbered in lockstep as the durable record.
 */
export default function Masters() {
  const [masters, setMasters] = useState<Masters | null>(null);
  const [usage, setUsage] = useState<MasterUsage | null>(null);
  const [active, setActive] = useState<MasterType>("categories");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchGlobalMasters(), fetchMasterUsage()])
      .then(([m, u]) => { if (live) { setMasters(m); setUsage(u); } })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const meta = useMemo(() => MASTER_META.find((m) => m.type === active)!, [active]);
  // Sort by `order` on load so the admin sees the stored order; stable, so items
  // sharing an order keep their array position (which is what phones render).
  const items = useMemo(
    () => [...(masters?.[active] ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [masters, active]
  );
  const usesOf = (id: string) => usage?.[active]?.[id] ?? 0;

  const mutate = (type: MasterType, next: MasterItem[]) => {
    setMasters((m) => (m ? { ...m, [type]: renumber(next) } : m));
    setDirty(true);
    setSavedAt(null);
  };
  const addItem = () => {
    const base: MasterItem = { id: newMasterId(), label: "", order: items.length + 1 };
    if (meta.hasColor) base.color = COLORS[items.length % COLORS.length];
    mutate(active, [...items, base]);
  };
  const setLabel = (id: string, label: string) => mutate(active, items.map((i) => (i.id === id ? { ...i, label } : i)));
  const setColor = (id: string, color: string) => mutate(active, items.map((i) => (i.id === id ? { ...i, color } : i)));
  const remove = (id: string) => mutate(active, items.filter((i) => i.id !== id));
  const toggleActive = (id: string) =>
    mutate(active, items.map((i) => (i.id === id ? { ...i, active: !isActive(i) } : i)));
  /** Swap with the neighbour — array position is the thing that matters. */
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    mutate(active, next);
  };

  const save = async () => {
    if (!masters || saving) return;
    setSaving(true);
    setError("");
    try {
      // Drop blank rows so we never persist empty labels, and renumber every list
      // so `order` matches the array we're about to write.
      const cleaned = MASTER_TYPES.reduce((acc, t) => {
        acc[t] = renumber(masters[t].filter((i) => i.label.trim()));
        return acc;
      }, {} as Masters);

      // Re-check usage for exactly the ids being dropped. Edits batch locally, so
      // the counts loaded on mount can be stale — without this, a lead captured
      // mid-edit would be silently orphaned (no FK to catch it).
      const removed = MASTER_TYPES.flatMap((t) => {
        const kept = new Set(cleaned[t].map((i) => i.id));
        return masters[t].filter((i) => i.label.trim() && !kept.has(i.id)).map((i) => ({ type: t, item: i }));
      });
      if (removed.length) {
        const fresh = await fetchMasterUsage();
        const blocked = removed.filter(({ type, item }) => (fresh[type]?.[item.id] ?? 0) > 0);
        if (blocked.length) {
          const { type, item } = blocked[0];
          const n = fresh[type][item.id];
          setUsage(fresh);
          throw new Error(
            `"${item.label}" is now used by ${n} lead${n === 1 ? "" : "s"} — it can't be deleted. Mark it inactive instead.`
          );
        }
      }

      await saveGlobalMasters(cleaned);
      setMasters(cleaned);
      setDirty(false);
      setSavedAt(Date.now());
      setUsage(await fetchMasterUsage());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-grey">
          Shared lists used by the mobile Leads app and this dashboard. Changes apply to everyone the next time their app syncs.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {savedAt && !dirty && <span className="text-[12px] text-[#27AE60]">Saved</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving || loading}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Master-type selector */}
      <div className="flex flex-wrap gap-2">
        {MASTER_META.map((m) => {
          const count = masters?.[m.type].filter(isActive).length ?? 0;
          const on = active === m.type;
          return (
            <button
              key={m.type}
              type="button"
              onClick={() => setActive(m.type)}
              className={cn(
                "inline-flex items-center gap-2 rounded-pill border px-3.5 py-1.5 text-[12.5px] transition",
                on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-navy hover:border-orange/40"
              )}
            >
              {m.label}
              <span className={cn("text-[11px] rounded-full px-1.5", on ? "bg-orange/15 text-orange" : "bg-grey-2/15 text-grey-2")}>{count}</span>
            </button>
          );
        })}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-[15px] font-semibold text-navy">{meta.label}</h3>
            <p className="text-[12px] text-grey-2">{meta.hint}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={addItem} disabled={loading}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add
          </Button>
        </div>

        {loading ? (
          <p className="text-[13px] text-grey-2 py-6 text-center">Loading masters…</p>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-grey-2 py-6 text-center">No items yet — click “Add” to create one.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((it, idx) => {
              const uses = usesOf(it.id);
              const on = isActive(it);
              return (
                <li key={it.id} className={cn("flex items-center gap-3 py-2.5", !on && "opacity-55")}>
                  {/* Reorder — array position is what every surface renders. */}
                  <div className="flex flex-col shrink-0 -my-1">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      className="text-grey-2 hover:text-orange disabled:opacity-25 disabled:hover:text-grey-2 transition p-0.5"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={idx === items.length - 1}
                      title="Move down"
                      className="text-grey-2 hover:text-orange disabled:opacity-25 disabled:hover:text-grey-2 transition p-0.5"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                  </div>

                  {meta.hasColor && (
                    <div className="flex items-center gap-1 shrink-0">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(it.id, c)}
                          title={c}
                          className={cn("w-4 h-4 rounded-full border transition", it.color === c ? "ring-2 ring-offset-1 ring-navy/40 border-transparent" : "border-white/60")}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  )}

                  <TextInput
                    value={it.label}
                    onChange={(e) => setLabel(it.id, e.target.value)}
                    placeholder={`New ${meta.label.toLowerCase()}…`}
                    className="flex-1"
                  />

                  {!on && (
                    <span className="text-[11px] rounded-pill bg-grey-2/15 text-grey-2 px-2 py-0.5 shrink-0">Inactive</span>
                  )}
                  {uses > 0 && (
                    <span className="text-[11.5px] text-grey-2 shrink-0 tabular-nums" title="Leads using this item — it can't be deleted">
                      {uses} lead{uses === 1 ? "" : "s"}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleActive(it.id)}
                    title={on ? "Hide from the mobile capture form (keeps existing leads intact)" : "Show again in the mobile capture form"}
                    className="text-[12px] font-semibold text-grey-2 hover:text-orange transition px-1 shrink-0"
                  >
                    {on ? "Deactivate" : "Activate"}
                  </button>

                  {/* No delete once a lead uses it — there is no FK to protect us, so
                      removing it would silently blank that field on every such lead. */}
                  {uses === 0 ? (
                    <button
                      onClick={() => remove(it.id)}
                      title="Delete"
                      className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  ) : (
                    <span className="w-[26px] shrink-0" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      {dirty && !saving && <p className="text-[12.5px] text-grey-2">You have unsaved changes.</p>}
    </div>
  );
}
