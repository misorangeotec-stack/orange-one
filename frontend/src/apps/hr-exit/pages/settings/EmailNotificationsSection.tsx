import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useExitStore } from "../../store";
import { fetchEmailModuleEnabled, setEmailModuleEnabled, EXIT_MODULE_ID } from "../../data/emailSettings";

const QK = ["emailModuleSetting", EXIT_MODULE_ID];

/**
 * Admin: the per-module email ON/OFF switch for Employee Exit.
 *
 * NARROWER than the purchase-family apps' equivalent, and the copy says so:
 * fms_exit_announce only enqueues email for MASTER REQUEST events, so this
 * governs master-data governance mail alone. Exit step alerts (assets signed,
 * HR verified, withdrawal) stay bell-only whatever this is set to. The in-app
 * bell is never affected either way.
 */
export default function EmailNotificationsSection() {
  const s = useExitStore();
  const canConfigure = s.canConfigure;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: () => fetchEmailModuleEnabled(EXIT_MODULE_ID) });

  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (typeof data === "boolean") setEnabled(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (v: boolean) => setEmailModuleEnabled(EXIT_MODULE_ID, v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setErr((e as Error).message),
  });

  const dirty = typeof data === "boolean" && enabled !== data;

  return (
    <Card className="p-5 max-w-xl">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Email notifications</h3>
          <p className="text-[12.5px] text-grey-2 mt-1 leading-relaxed">
            When on, master requests are also emailed. Raising one mails the master's owners (or the admins, if that
            master is unassigned); approving or rejecting one mails the person who raised it, with the reviewer's note.
            Emails are sent from support@orangeotec.com. In-app alerts are unaffected.
          </p>
          <p className="text-[12.5px] text-grey-2 mt-2 leading-relaxed">
            Exit step alerts — assets signed, HR verified, exit withdrawn and the rest — stay in-app only and are not
            affected by this switch.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canConfigure || isLoading || mut.isPending}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5 w-4 h-4 accent-orange"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-navy">Email master requests for Employee Exit</span>
            <span className="block text-[11.5px] leading-snug text-grey-2 mt-0.5">
              {isLoading ? "Loading…" : enabled ? "Currently ON." : "Currently OFF."}
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => { setErr(""); mut.mutate(enabled); }} disabled={!canConfigure || !dirty || mut.isPending}>
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
          {!canConfigure && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && !dirty && <span className="text-[12.5px] text-ryg-green font-medium">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
