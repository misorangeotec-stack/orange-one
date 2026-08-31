import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { appBasePath, appName } from "@/apps/appInfo";
import { fetchPcMasterRequests, resolvePcMasterRequest } from "../data/pcApprovals";
import { prettyFieldKey, prettyMasterType, requestSummary, waitingDays, waitingLabel } from "../lib/labels";
import type { PcMasterRequest } from "../types";

const STATUS_LABEL: Record<PcMasterRequest["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
};

export const PC_REQUESTS_QK = ["pc", "masterRequests"] as const;

/**
 * Every module's master approvals, in one queue.
 *
 * ⚠ PENDING FIRST, HISTORY KEPT. The screen opens on what is waiting, because
 *   that is the whole reason the coordinator came. But "Show decided" is one
 *   click away and nothing is thrown out — the question people come back with is
 *   "I asked for that item last month, did anyone do anything?", and a list that
 *   empties itself on approval cannot answer it. Same rule as every module's own
 *   Master Requests screen.
 *
 * ⚠ APPROVAL GOES THROUGH THE MODULE'S OWN RPC, never a status update from here.
 *   Approving creates the real master row, stamps the request, fires that
 *   module's notification and, in HR and Exit, its email. See data/pcApprovals.ts.
 */
export default function Approvals() {
  const qc = useQueryClient();
  const [showDecided, setShowDecided] = useState(false);
  const [acting, setActing] = useState<PcMasterRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: PC_REQUESTS_QK,
    queryFn: fetchPcMasterRequests,
    staleTime: 60_000,
  });

  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => (showDecided ? all : all.filter((r) => r.status === "pending")),
    [all, showDecided],
  );
  const pendingCount = useMemo(() => all.filter((r) => r.status === "pending").length, [all]);

  /** Only string values are editable — the rest ride along untouched. */
  function open(r: PcMasterRequest) {
    const editable: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.proposedPayload)) {
      if (typeof v === "string") editable[k] = v;
    }
    setActing(r);
    setValues(editable);
    setNote("");
    setError(null);
  }

  const resolve = useMutation({
    mutationFn: async (approve: boolean) => {
      if (!acting) return;
      /*
        ⚠ THE PAYLOAD KEEPS ITS SHAPE. Every key the request arrived with is sent
          back; only the string ones can have been edited. The module's RPC reads
          these keys VERBATIM, so dropping or renaming one silently loses that
          field on approval.
      */
      const payload = { ...acting.proposedPayload, ...values };
      await resolvePcMasterRequest({
        appId: acting.appId,
        requestId: acting.requestId,
        approve,
        payload: approve ? payload : undefined,
        note: note.trim() || undefined,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PC_REQUESTS_QK });
      setActing(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const columns = useMemo<QueueColumn<PcMasterRequest>[]>(
    () => [
      {
        key: "module",
        header: "Module",
        cell: (r) => appName(r.appId),
        sortValue: (r) => appName(r.appId),
        filter: { kind: "select", get: (r) => appName(r.appId) },
      },
      {
        key: "what",
        header: "Asked for",
        cell: (r) => (
          <span className="font-semibold text-navy">{requestSummary(r.proposedPayload)}</span>
        ),
        sortValue: (r) => requestSummary(r.proposedPayload),
        filter: { kind: "text", get: (r) => requestSummary(r.proposedPayload) },
      },
      {
        key: "type",
        header: "List",
        cell: (r) => prettyMasterType(r.masterType),
        sortValue: (r) => prettyMasterType(r.masterType),
        filter: { kind: "select", get: (r) => prettyMasterType(r.masterType) },
      },
      {
        key: "by",
        header: "Asked by",
        cell: (r) => r.requesterName ?? "—",
        sortValue: (r) => r.requesterName ?? "",
        filter: { kind: "select", get: (r) => r.requesterName ?? "—" },
      },
      {
        key: "waiting",
        header: "Waiting",
        align: "right",
        cell: (r) => (
          <span className={r.status === "pending" && waitingDays(r.createdAt) >= 3 ? "font-semibold text-ryg-red" : ""}>
            {waitingLabel(r.createdAt)}
          </span>
        ),
        // Sort by age, not by the rendered text — "9 days" must not sort before "10 days".
        sortValue: (r) => waitingDays(r.createdAt),
        filter: { kind: "select", get: (r) => waitingLabel(r.createdAt) },
      },
      {
        key: "status",
        header: "Status",
        cell: (r) => (
          <span
            className={
              r.status === "pending"
                ? "font-medium text-orange"
                : r.status === "approved"
                  ? "text-ryg-green"
                  : "text-ryg-red"
            }
          >
            {STATUS_LABEL[r.status]}
          </span>
        ),
        sortValue: (r) => STATUS_LABEL[r.status],
        filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Approvals</h1>
          <p className="text-[13px] text-grey">
            {pendingCount === 0
              ? "Nothing waiting for approval."
              : `${pendingCount} ${pendingCount === 1 ? "request is" : "requests are"} waiting on you.`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowDecided((v) => !v)}>
          {showDecided ? "Show waiting only" : "Show decided too"}
        </Button>
      </header>

      <QueueTable<PcMasterRequest>
        rows={rows}
        rowKey={(r) => `${r.appId}:${r.requestId}`}
        columns={columns}
        loading={isLoading}
        rowsLabel="requests"
        initialSort={{ key: "waiting", dir: "desc" }}
        emptyTitle="Nothing waiting"
        emptyMessage="Master requests from every module arrive here."
        exportName="Process_Coordinator_Approvals"
        exportTitle="Master approvals — all modules"
        actions={(r) =>
          r.status === "pending" ? (
            <Button size="sm" onClick={() => open(r)}>
              Review
            </Button>
          ) : null
        }
      />

      <Modal
        open={!!acting}
        onClose={() => setActing(null)}
        title={acting ? `${prettyMasterType(acting.masterType)} · ${appName(acting.appId)}` : ""}
        subtitle={acting ? `Asked by ${acting.requesterName ?? "someone"}, ${waitingLabel(acting.createdAt).toLowerCase()}` : undefined}
        footer={
          acting ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Link
                to={`${appBasePath(acting.appId)}/master-requests`}
                className="text-[13px] text-grey underline-offset-2 hover:text-orange hover:underline"
              >
                Open in {appName(acting.appId)}
              </Link>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={resolve.isPending || !note.trim()}
                  onClick={() => resolve.mutate(false)}
                >
                  {resolve.isPending ? "Working…" : "Reject"}
                </Button>
                <Button disabled={resolve.isPending} onClick={() => resolve.mutate(true)}>
                  {resolve.isPending ? "Working…" : "Approve"}
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {acting ? (
          <div className="space-y-4">
            {Object.keys(values).length === 0 ? (
              <p className="text-[13px] text-grey">This request carries no editable fields.</p>
            ) : (
              Object.entries(values).map(([k, v]) => (
                <FieldLabel key={k} label={prettyFieldKey(k)}>
                  <TextInput
                    value={v}
                    onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                </FieldLabel>
              ))
            )}

            <FieldLabel label="Note" hint="Required to reject">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>

            <p className="text-[12px] leading-relaxed text-grey-2">
              Correcting a spelling here is enough for most requests. Anything needing a different
              choice from one of {appName(acting.appId)}'s own lists should be opened in that module,
              where the full form is.
            </p>

            {error ? <p className="text-[13px] text-ryg-red">{error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
