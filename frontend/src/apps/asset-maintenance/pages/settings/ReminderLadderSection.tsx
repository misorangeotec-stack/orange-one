import { useEffect, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useAssetStore } from "../../store";
import { DEFAULT_REMINDER_LADDER } from "../../data/assetFetch";

/**
 * When the reminders fire.
 *
 * ⚠ THIS IS THE ONLY SETTING THE SERVER READS DIRECTLY. Everything else in Setup
 *   is resolved client-side over a code default; `fms_asset_send_reminders` reads
 *   `fms_asset_config.reminder_ladder` inside a pg_cron job, where there is no
 *   frontend to fall back on. Save something nonsensical and the nightly run
 *   honours it.
 *
 * A tier only fires for a track whose own `lead_days` reaches that far out — a
 * 15-day service lead can never fire a 45-day tier, because its job does not
 * exist yet. That cap is per-track and deliberate; this list is the menu, not the
 * schedule.
 */
export default function ReminderLadderSection() {
  const s = useAssetStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setText(s.reminderLadder.join(", ")); }, [s.reminderLadder]);

  const parsed = text
    .split(",")
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 365);
  const unique = Array.from(new Set(parsed)).sort((a, b) => b - a);

  const save = async () => {
    if (!unique.length) { setError("Enter at least one number of days."); return; }
    setBusy(true); setError(null);
    try {
      await s.setConfig("reminder_ladder", { days: unique });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  return (
    <Card className="max-w-2xl p-5">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Reminder ladder</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-grey-2">
            Days before the due date at which an open job reminds its custodian and the step's
            owners. Once past the date it reminds <strong>every day</strong> until somebody acts —
            that part is not configurable, because a reminder you can outlast is not a reminder.
          </p>
        </div>

        <FieldLabel
          label="Days before due"
          hint="Comma separated. Blanks, duplicates and anything over 365 are dropped."
        >
          <TextInput
            value={text}
            disabled={!s.isAdmin}
            placeholder={DEFAULT_REMINDER_LADDER.join(", ")}
            onChange={(e) => { setText(e.target.value); setSaved(false); }}
          />
        </FieldLabel>

        <p className="rounded-lg bg-[#EEF3FF] px-3 py-2 text-[12.5px] text-navy">
          Will fire at:{" "}
          <strong>{unique.length ? unique.map((d) => `T-${d}`).join(", ") : "nothing"}</strong>, then
          daily once overdue. A track only sees the tiers within its own “remind this many days
          ahead” setting — insurance at 45 days gets them all, a 15-day service gets{" "}
          {unique.filter((d) => d <= 15).map((d) => `T-${d}`).join(", ") || "only the day it opens"}.
        </p>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={!s.isAdmin || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && <span className="text-[12.5px] font-medium text-ryg-green">Saved</span>}
          {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
