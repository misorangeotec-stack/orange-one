import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import { useTravelStore } from "../../store";
import { STEPS, MENU_HIDDEN_DEFAULT } from "../../lib/steps";
import { STATUS_STEP } from "../../types";

/**
 * Which queues the left menu shows.
 *
 * ⚠ HIDE TAKES IT OUT OF THE MENU ONLY. The queue page, its work, its owners
 *   and its URL all stay — so a queue nobody uses any more (the claim half since
 *   2026-10) stops confusing people, and can be shown again with one tick.
 *
 * Until an admin saves this, the default hides the steps the new process does
 * not use and the old Cancellations queue (lib/steps MENU_HIDDEN_DEFAULT).
 */
export default function MenuQueuesSection() {
  const s = useTravelStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hidden = new Set(s.config.menuHiddenQueues ?? MENU_HIDDEN_DEFAULT);

  const rows: { key: string; title: string; waiting: number }[] = [];
  for (const st of STEPS.filter((x) => !x.noQueue)) {
    rows.push({
      key: st.key,
      title: st.title,
      waiting: s.trips.filter((t) => STATUS_STEP[t.status] === st.key).length,
    });
    // The old Cancellations queue sits under Booking in the menu.
    if (st.key === "booking") {
      rows.push({
        key: "cancellations",
        title: "Cancellations (old)",
        waiting: s.trips.filter((t) => t.status === "cancellation_requested").length,
      });
    }
  }

  const toggle = async (key: string, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(key);
    else next.add(key);
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setMenuHiddenQueues([...next]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold text-navy">Menu queues — show or hide</h2>
        {saved && <span className="text-[12px] font-medium text-ryg-green">✓ Saved</span>}
      </div>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        Untick a queue to take it out of the left menu for everyone. Nothing is deleted — the
        queue and its trips stay, and ticking it again brings it back.
      </p>

      <div className="mt-3 divide-y divide-line rounded-xl border border-line">
        {rows.map((r) => {
          const shown = !hidden.has(r.key);
          return (
            <label
              key={r.key}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${busy ? "opacity-60" : "cursor-pointer"}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={busy}
                  onChange={(e) => toggle(r.key, e.target.checked)}
                  className="h-4 w-4 accent-orange"
                />
                <span className="text-[13.5px] font-medium text-navy">{r.title}</span>
              </span>
              <span className="text-[12px] text-grey-2">
                {r.waiting > 0 ? `${r.waiting} ${r.waiting === 1 ? "trip" : "trips"} waiting · ` : ""}
                {shown ? "Shown" : "Hidden"}
              </span>
            </label>
          );
        })}
      </div>
      {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
