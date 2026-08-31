import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../store";
import RequestMasterModal from "../components/RequestMasterModal";
import { masterFields, missingRequired, valuesFromPayload, payloadFromValues } from "../lib/masterFields";
import {
  TRAVEL_MASTER_TYPES, REQUESTABLE_MASTERS,
  type TravelMasterRequest, type TravelRequestableMaster,
} from "../types";

const typeLabel = (t: string) => TRAVEL_MASTER_TYPES.find((m) => m.value === t)?.label ?? t;

const STATUS_LABEL: Record<TravelMasterRequest["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Ask for a missing master value, and see what happened to the one you asked
 * for.
 *
 * ⚠ NOT ADMIN-ONLY. Anyone who may act in the module raises requests and wants
 *   to know the outcome — being told "somebody will deal with it" and never
 *   seeing it again is the behaviour this replaces. Deciding a request still
 *   needs ownership of that particular list.
 */
export default function MasterRequests() {
  const s = useTravelStore();
  const orgPersonById = useOrgPersonById();

  const [asking, setAsking] = useState<TravelRequestableMaster | null>(null);
  const [reviewing, setReviewing] = useState<TravelMasterRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cityOptions = useMemo(
    () => s.cities.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
    [s.cities],
  );

  const openReview = (r: TravelMasterRequest) => {
    setReviewing(r);
    setValues(valuesFromPayload(r.masterType, r.proposedPayload));
    setNote("");
    setErr(null);
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!reviewing) return;
    if (decision === "approved") {
      const missing = missingRequired(reviewing.masterType, values);
      if (missing) { setErr(missing); return; }
    }
    setBusy(true);
    setErr(null);
    try {
      await s.resolveMasterRequest(
        reviewing.id,
        decision,
        note.trim() || null,
        decision === "approved" ? payloadFromValues(reviewing.masterType, values) : null,
      );
      setReviewing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: QueueColumn<TravelMasterRequest>[] = [
    {
      key: "type",
      header: "List",
      cell: (r) => typeLabel(r.masterType),
      sortValue: (r) => typeLabel(r.masterType),
      filter: { kind: "select", get: (r) => typeLabel(r.masterType) },
    },
    {
      key: "name",
      header: "Asked for",
      cell: (r) => (
        <span className="font-semibold text-navy">{String(r.proposedPayload.name ?? "—")}</span>
      ),
      sortValue: (r) => String(r.proposedPayload.name ?? ""),
      filter: { kind: "text", get: (r) => String(r.proposedPayload.name ?? "") },
    },
    {
      key: "by",
      header: "Asked by",
      cell: (r) => (r.requestedBy ? orgPersonById(r.requestedBy)?.name ?? "Someone" : "—"),
      sortValue: (r) => (r.requestedBy ? orgPersonById(r.requestedBy)?.name ?? "" : ""),
      filter: { kind: "select", get: (r) => (r.requestedBy ? orgPersonById(r.requestedBy)?.name ?? "Someone" : "—") },
    },
    {
      key: "when",
      header: "Asked",
      cell: (r) => formatDateDMY(r.createdAt),
      sortValue: (r) => r.createdAt,
      filter: { kind: "date", get: (r) => r.createdAt.slice(0, 10) },
    },
    {
      key: "status",
      header: "Outcome",
      cell: (r) => (
        <span
          className={
            r.status === "approved" ? "font-semibold text-ryg-green"
              : r.status === "rejected" ? "font-semibold text-ryg-red"
                : "font-semibold text-orange"
          }
        >
          {STATUS_LABEL[r.status]}
        </span>
      ),
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
    {
      key: "note",
      header: "Reviewer said",
      cell: (r) => r.reviewNote ?? "—",
      sortValue: (r) => r.reviewNote ?? "",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Master requests</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
            Ask for a city, hotel, airline or expense category that is not on the list yet — and see
            what happened to the one you asked for.
          </p>
        </div>
        {s.canEdit && (
          <div className="w-64">
            <Combobox
              options={REQUESTABLE_MASTERS.map((m) => ({ value: m, label: `Ask for a ${typeLabel(m).toLowerCase()}` }))}
              value=""
              onChange={(v) => setAsking(v as TravelRequestableMaster)}
              placeholder="Ask for something…"
            />
          </div>
        )}
      </div>

      <QueueTable<TravelMasterRequest>
        rows={s.masterRequests}
        rowKey={(r) => r.id}
        columns={columns}
        actions={(r) =>
          r.status === "pending" && s.canManageMaster(r.masterType) ? (
            <Button size="sm" onClick={() => openReview(r)}>Review</Button>
          ) : null
        }
        rowsLabel="requests"
        emptyTitle="Nothing has been asked for"
        emptyMessage="When somebody needs a value that is not on a list, it appears here."
        loading={s.isLoading}
        initialSort={{ key: "when", dir: "desc" }}
        exportName="travel-master-requests"
        exportTitle="Travel Desk — master requests"
      />

      {asking && (
        <RequestMasterModal open onClose={() => setAsking(null)} type={asking} />
      )}

      {reviewing && (
        <Modal
          open
          onClose={() => setReviewing(null)}
          title={`Review: ${typeLabel(reviewing.masterType)}`}
        >
          <div className="space-y-3">
            <p className="text-[13px] text-grey-2">
              Correct anything that is wrong before approving —{" "}
              <strong className="text-navy">what you save here is what the list gets</strong>, not
              what was typed. Approving a misspelling because it was quicker than fixing it is how a
              master list rots.
            </p>

            {masterFields(reviewing.masterType, { cityOptions }).map((f) => (
              <label key={f.key} className="block">
                <span className="text-[13px] font-medium text-navy">{f.label}</span>
                {f.type === "select" && f.options ? (
                  <div className="mt-1">
                    <Combobox
                      options={f.options}
                      value={values[f.key] ?? ""}
                      onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                    />
                  </div>
                ) : f.type === "textarea" ? (
                  <textarea
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
                  />
                ) : (
                  <input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
                  />
                )}
                {f.hint && <span className="mt-1 block text-[12px] text-grey-2">{f.hint}</span>}
              </label>
            ))}

            <label className="block">
              <span className="text-[13px] font-medium text-navy">
                Note back to whoever asked
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
                placeholder="Required when rejecting — say what they should do instead."
              />
            </label>

            {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setReviewing(null)} disabled={busy}>
                Cancel
              </Button>
              {/* Reject stays disabled until a reason is typed — the person who
                  asked has to be told what to do instead. */}
              <Button
                variant="outline"
                onClick={() => decide("rejected")}
                disabled={busy || !note.trim()}
              >
                Reject
              </Button>
              <Button onClick={() => decide("approved")} disabled={busy}>
                {busy ? "Saving…" : "Approve"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
