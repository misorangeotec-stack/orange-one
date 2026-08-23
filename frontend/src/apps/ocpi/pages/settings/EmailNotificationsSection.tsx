import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useOcpiStore } from "../../store";
import {
  OCPI_MODULE_ID,
  fetchEmailModuleEnabled,
  setEmailModuleEnabled,
} from "../../data/emailSettings";

const QK = ["emailModuleSetting", OCPI_MODULE_ID];

/**
 * The per-module email switch.
 *
 * ⚠ IT INSTALLS OFF, AND TURNING IT ON IS A LIVE SEND. From the moment it is
 *   saved, every approval, every confirmation and every signature mails the
 *   person it is waiting on. The warning below is not decoration: if OCPI is
 *   ever backfilled with historic deals, doing it with this on would mail the
 *   company about contracts signed months ago.
 *
 * ⚠ THE BELL IS UNAFFECTED EITHER WAY. In-app notifications are written by
 *   `fms_ocpi_announce` unconditionally; only the outbox row is gated. Somebody
 *   turning this off is choosing to stop mail, not to stop being told.
 */
export default function EmailNotificationsSection() {
  const s = useOcpiStore();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => fetchEmailModuleEnabled(OCPI_MODULE_ID),
  });

  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (typeof data === "boolean") setEnabled(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (v: boolean) => setEmailModuleEnabled(OCPI_MODULE_ID, v),
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
          <p className="mt-1 text-[12.5px] leading-relaxed text-grey">
            When on, each OCPI event also emails the person it is waiting on &mdash; the same people
            who get the in-app alert. A quotation sent for approval reaches the approvers, an
            approval reaches the salesperson, a customer-signed copy reaches management, and a
            countersignature reaches the salesperson. Sent from support@orangeotec.com. In-app
            alerts are unaffected by this switch.
          </p>
        </div>

        {!enabled && (
          <p className="rounded-xl border border-line bg-page/60 p-3 text-[12.5px] text-grey">
            <b className="text-navy">Before switching this on:</b> it takes effect immediately. If
            old deals are still being entered for history, finish that first &mdash; otherwise
            everyone involved is emailed about contracts that were signed months ago.
          </p>
        )}

        <label className="flex cursor-pointer select-none items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!s.isAdmin || isLoading || mut.isPending}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5 h-4 w-4 accent-orange"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-navy">
              Send email notifications for OCPI
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-grey-2">
              {isLoading ? "Loading…" : enabled ? "Currently ON." : "Currently OFF."}
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => {
              setErr("");
              mut.mutate(enabled);
            }}
            disabled={!s.isAdmin || !dirty || mut.isPending}
          >
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
          {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && !dirty && <span className="text-[12.5px] font-medium text-ryg-green">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
