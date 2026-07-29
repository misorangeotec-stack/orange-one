import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useAssetStore } from "../../store";
import {
  fetchEmailModuleEnabled, setEmailModuleEnabled, ASSET_MAINTENANCE_MODULE_ID,
} from "../../data/emailSettings";

const QK = ["emailModuleSetting", ASSET_MAINTENANCE_MODULE_ID];

/**
 * Admin: the per-module email ON/OFF switch. Email only flows when this is on;
 * the in-app bell is never affected.
 *
 * ⚠ TURN THIS ON ONLY AFTER the first generator run has been reviewed. A freshly
 *   imported register full of already-past dates opens every one of those jobs as
 *   overdue on the first nightly run — with mail on, that is a mass-mail to the
 *   whole company on day one, and the module gets muted before it has proved
 *   itself.
 */
export default function EmailNotificationsSection() {
  const s = useAssetStore();
  const canConfigure = s.isAdmin;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => fetchEmailModuleEnabled(ASSET_MAINTENANCE_MODULE_ID),
  });

  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (typeof data === "boolean") setEnabled(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (v: boolean) => setEmailModuleEnabled(ASSET_MAINTENANCE_MODULE_ID, v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setErr((e as Error).message),
  });

  const dirty = typeof data === "boolean" && enabled !== data;

  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Email notifications</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-grey-2">
            When on, the reminder ladder and every step handover also email the people responsible —
            the asset's custodian and the step's owners. Corrections to a step are bell-only and
            never emailed. Sent from support@orangeotec.com. In-app alerts are unaffected.
          </p>
        </div>

        <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] text-[#946200]">
          Leave this OFF until you have run the first job generation and looked at the result. A
          newly imported register with past due dates will open all of those jobs as overdue at once.
        </p>

        <label className="flex cursor-pointer select-none items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canConfigure || isLoading || mut.isPending}
            onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
            className="mt-0.5 h-4 w-4 accent-orange"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-navy">
              Send email notifications for Asset Maintenance
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-grey-2">
              {isLoading ? "Loading…" : enabled ? "Currently ON." : "Currently OFF."}
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => { setErr(""); mut.mutate(enabled); }}
            disabled={!canConfigure || !dirty || mut.isPending}
          >
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
          {!canConfigure && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && !dirty && <span className="text-[12.5px] font-medium text-ryg-green">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
