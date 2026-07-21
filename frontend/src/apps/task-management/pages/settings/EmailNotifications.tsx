import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useTaskStore } from "../../mock/store";
import { fetchEmailModuleEnabled, setEmailModuleEnabled, TASK_MODULE_ID } from "../../data/emailSettings";

const QK = ["emailModuleSetting", TASK_MODULE_ID];

/**
 * Admin: the per-module email ON/OFF switch. Email only flows when this is on;
 * the in-app bell is never affected. Backed by public.email_module_settings via
 * the admin-checked set_email_module_enabled RPC (migration 20260721150000).
 */
export default function EmailNotifications() {
  const { canManageWorkspace } = useTaskStore();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: () => fetchEmailModuleEnabled(TASK_MODULE_ID) });

  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (typeof data === "boolean") setEnabled(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (val: boolean) => setEmailModuleEnabled(TASK_MODULE_ID, val),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError((e as Error).message),
  });

  const dirty = typeof data === "boolean" && enabled !== data;
  const save = () => {
    setError("");
    mut.mutate(enabled);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-6 space-y-5">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Email notifications</h3>
          <p className="text-[12.5px] text-grey mt-1 leading-relaxed">
            When on, Task Management also emails the responsible person for the same events that raise an in-app
            alert — a task assigned to them, being <b>@mentioned</b> in a remark, and being assigned a recurring
            task. In-app bell alerts are unaffected.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManageWorkspace || isLoading || mut.isPending}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5 w-4 h-4 accent-orange"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-navy">Send email notifications for Task Management</span>
            <span className="block text-[11.5px] leading-snug text-grey-2 mt-0.5">
              Emails are sent from support@orangeotec.com. {isLoading ? "Loading…" : enabled ? "Currently ON." : "Currently OFF."}
            </span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-3 border-t border-line -mx-6 px-6 pt-4">
          {!canManageWorkspace && <span className="mr-auto text-[12.5px] text-grey-2">Only admins can change email settings.</span>}
          {error && <span className="mr-auto text-[12.5px] text-[#E5484D]">{error}</span>}
          {saved && <span className="text-[12.5px] text-[#27AE60] font-medium">✓ Saved</span>}
          <Button type="button" onClick={save} disabled={!canManageWorkspace || !dirty || mut.isPending}>
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
