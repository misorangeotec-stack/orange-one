import { useNavigate } from "react-router-dom";
import AssetForm, { type AssetFormValues } from "../../components/AssetForm";
import { useAssetStore } from "../../store";
import { estimateNextDue } from "../../lib/schedules";
import type { FrequencyUnit } from "../../types";

/**
 * Add an asset to the register.
 *
 * After the asset is created, each ticked track is created too — with an
 * ESTIMATED next due date (see lib/schedules#estimateNextDue), because the RPC
 * needs one and an asset with no dated tracks reminds nobody. The detail page is
 * then opened in setup mode, which says plainly that those dates are guesses and
 * asks for the real ones.
 *
 * A track whose date cannot be estimated at all — a one-time warranty, or a type
 * with no default frequency — is deliberately NOT created here. Inventing a date
 * for an insurance policy would be worse than leaving it to be added by hand.
 */
export default function NewAsset() {
  const s = useAssetStore();
  const nav = useNavigate();

  if (!s.canRaise) {
    return (
      <div className="rounded-xl border border-line bg-white p-6">
        <h1 className="text-[18px] font-bold text-navy">Adding assets is restricted</h1>
        {/*
          `canRaise` is false for TWO different reasons, and naming only one of
          them sent people hunting for a Service Due owner that had never been
          set. A view-only grant is by far the commoner cause.
        */}
        <p className="mt-1 text-[13.5px] text-grey-2">
          {!s.canEdit
            ? "Your access to Asset Maintenance is view only, so you can read every screen here but not change anything. An admin can widen it under Admin → Users → Module access."
            : "An owner has been set for the Service Due step, so only they, a coordinator or an admin can add to the register."}
        </p>
      </div>
    );
  }

  const submit = async (v: AssetFormValues, trackTypeIds: string[]) => {
    const assetId = await s.submitAsset(v);

    let estimated = 0;
    let needsDate = 0;
    for (const typeId of trackTypeIds) {
      const t = s.scheduleTypes.find((x) => x.id === typeId);
      if (!t) continue;
      /*
        ⚠ THE WARRANTY TRACK IS THE RPC'S, NOT OURS. `fms_asset_submit_asset`
          already creates a one-time "Warranty Expiry" track whenever
          warranty_months is set (it matches the type BY NAME, so this does too).
          Letting the loop try again meant the duplicate insert threw, the catch
          below counted it as `needsDate`, and the setup banner then told the user
          a track "was not created" and to go and add it — while it sat on the
          screen right above the message.
      */
      if (t.name === "Warranty Expiry" && v.warranty_months.trim()) continue;
      const unit: FrequencyUnit = t.defaultFrequencyUnit ?? "months";
      const due = estimateNextDue(v.purchase_date || null, s.todayIso, t.defaultFrequencyValue, unit);
      if (!due) { needsDate += 1; continue; }
      try {
        await s.upsertSchedule(assetId, {
          schedule_type_id: typeId,
          frequency_value: t.defaultFrequencyValue === null ? "" : String(t.defaultFrequencyValue),
          frequency_unit: unit,
          next_due_date: due,
          lead_days: String(t.defaultLeadDays),
        });
        estimated += 1;
      } catch {
        // A track that cannot be created (already present from the warranty
        // auto-track, say) must not lose the asset that was just saved.
        needsDate += 1;
      }
    }

    nav(`/asset-maintenance/assets/${assetId}?setup=1&est=${estimated}&pending=${needsDate}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Add an asset</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Register what was bought, who looks after it, and what needs tracking. The reminders start
          from the tracks you set up on the next screen.
        </p>
      </div>
      <AssetForm submitLabel="Add asset" withTracks onSubmit={submit} onCancel={() => nav("/asset-maintenance/assets")} />
    </div>
  );
}
