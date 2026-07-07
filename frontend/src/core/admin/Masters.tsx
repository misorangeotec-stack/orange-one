import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import {
  fetchGlobalMasters,
  saveGlobalMasters,
  newMasterId,
  MASTER_META,
  type Masters,
  type MasterType,
  type MasterItem,
} from "./mastersWrites";

/** Preset accent colors for interest levels. */
const COLORS = ["#E5484D", "#F8B62B", "#3B82F6", "#27AE60", "#8B5CF6", "#EC4899", "#0EA5E9", "#64748B"];

/**
 * Global lead masters admin. The four dropdown lists the mobile Leads app uses,
 * managed centrally here (create / rename / delete; interest levels also carry a
 * color). One shared set for the whole org — the mobile app reads it read-only.
 */
export default function Masters() {
  const [masters, setMasters] = useState<Masters | null>(null);
  const [active, setActive] = useState<MasterType>("categories");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchGlobalMasters()
      .then((m) => { if (live) setMasters(m); })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const meta = useMemo(() => MASTER_META.find((m) => m.type === active)!, [active]);
  const items = masters?.[active] ?? [];

  const mutate = (type: MasterType, next: MasterItem[]) => {
    setMasters((m) => (m ? { ...m, [type]: next } : m));
    setDirty(true);
    setSavedAt(null);
  };
  const addItem = () => {
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order)) + 1 : 1;
    const base: MasterItem = { id: newMasterId(), label: "", order: nextOrder };
    if (meta.hasColor) base.color = COLORS[items.length % COLORS.length];
    mutate(active, [...items, base]);
  };
  const setLabel = (id: string, label: string) => mutate(active, items.map((i) => (i.id === id ? { ...i, label } : i)));
  const setColor = (id: string, color: string) => mutate(active, items.map((i) => (i.id === id ? { ...i, color } : i)));
  const remove = (id: string) => mutate(active, items.filter((i) => i.id !== id));

  const save = async () => {
    if (!masters || saving) return;
    // Drop blank rows so we never persist empty labels.
    const cleaned: Masters = {
      categories: masters.categories.filter((i) => i.label.trim()),
      interestLevels: masters.interestLevels.filter((i) => i.label.trim()),
      askedAbout: masters.askedAbout.filter((i) => i.label.trim()),
      followUpActions: masters.followUpActions.filter((i) => i.label.trim()),
    };
    setSaving(true);
    setError("");
    try {
      await saveGlobalMasters(cleaned);
      setMasters(cleaned);
      setDirty(false);
      setSavedAt(Date.now());
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
          Shared lists used by the Orange One mobile app. Changes apply to everyone the next time their app syncs.
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
          const count = masters?.[m.type].length ?? 0;
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
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2.5">
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
                <button
                  onClick={() => remove(it.id)}
                  title="Delete"
                  className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      {dirty && !saving && <p className="text-[12.5px] text-grey-2">You have unsaved changes.</p>}
    </div>
  );
}
