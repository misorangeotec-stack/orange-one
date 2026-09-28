import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useLdStore } from "../store";
import RequestMasterModal from "../components/RequestMasterModal";
import {
  describePayload,
  masterFields,
  masterTypeOptions,
  missingRequired,
  payloadFromValues,
  valuesFromPayload,
  type MasterValues,
} from "../lib/masterFields";
import {
  masterTypeLabel,
  type LdMasterType,
  type MasterRequest,
  type MasterRequestStatus,
} from "../types";

const STATUS_LABEL: Record<MasterRequestStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Ask for a missing master value, and see what happened to the one you asked for.
 *
 * ⚠ NOT ADMIN-ONLY, AND NOT EVERYBODY EITHER. Anybody who works the pipeline hits
 *   these lists — a competency at HR validation, a trainer at finalisation, a
 *   venue at scheduling, a follow-up action at closure — and wants to know the
 *   outcome; being told "somebody will deal with it" and never seeing it again is
 *   the behaviour this replaces. But the module is UNIVERSAL, so "everybody" here
 *   means the whole company, and a warehouse operator has no business being
 *   offered a form for asking after a delay reason. `canUseMasterRequests` draws
 *   that line; DECIDING a request still needs ownership of that particular list.
 */
export default function MasterRequests() {
  const s = useLdStore();

  const [asking, setAsking] = useState<LdMasterType | null>(null);
  const [reviewing, setReviewing] = useState<MasterRequest | null>(null);
  const [values, setValues] = useState<MasterValues>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const employeeOptions = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
    [s.orgPeople],
  );

  const ctx = useMemo(() => ({ employeeOptions, forRequest: true }), [employeeOptions]);

  const openReview = (r: MasterRequest) => {
    setReviewing(r);
    setValues(valuesFromPayload(r.masterType, r.proposedPayload, ctx));
    setNote("");
    setErr(null);
  };

  const decide = async (approve: boolean) => {
    if (!reviewing) return;
    if (approve) {
      const missing = missingRequired(reviewing.masterType, values, ctx);
      if (missing) {
        setErr(missing);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      await s.writes.resolveMasterRequest(
        reviewing.id,
        approve,
        note.trim() || null,
        approve ? payloadFromValues(reviewing.masterType, values) : null,
      );
      await s.refresh();
      setReviewing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: QueueColumn<MasterRequest>[] = [
    {
      key: "type",
      header: "List",
      cell: (r) => masterTypeLabel(r.masterType),
      sortValue: (r) => masterTypeLabel(r.masterType),
      filter: { kind: "select", get: (r) => masterTypeLabel(r.masterType) },
    },
    {
      key: "asked",
      header: "Asked for",
      // The whole proposal, not just its name — a trainer row reading "Bright
      // Minds" hides the one thing worth reviewing about it.
      cell: (r) => (
        <span className="font-semibold text-navy">
          {describePayload(r.masterType, r.proposedPayload)}
        </span>
      ),
      sortValue: (r) => describePayload(r.masterType, r.proposedPayload),
      filter: { kind: "text", get: (r) => describePayload(r.masterType, r.proposedPayload) },
    },
    {
      key: "by",
      header: "Asked by",
      cell: (r) => s.personName(r.requestedBy),
      sortValue: (r) => s.personName(r.requestedBy),
      filter: { kind: "select", get: (r) => s.personName(r.requestedBy) },
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
            r.status === "approved"
              ? "font-semibold text-ryg-green"
              : r.status === "rejected"
                ? "font-semibold text-ryg-red"
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
      key: "reviewer",
      header: "Reviewed by",
      cell: (r) => s.personName(r.reviewedBy),
      sortValue: (r) => s.personName(r.reviewedBy),
      filter: { kind: "select", get: (r) => s.personName(r.reviewedBy) },
    },
    {
      key: "note",
      header: "Reviewer said",
      cell: (r) => r.reviewNote ?? "—",
      sortValue: (r) => r.reviewNote ?? "",
      // Prose, so a search box rather than a dropdown of one-of-each — but a
      // filter all the same: "say why" is how you find the rejections that gave a
      // reason and the ones that did not.
      filter: { kind: "text", get: (r) => r.reviewNote ?? "" },
    },
  ];

  const reviewFields = reviewing ? masterFields(reviewing.masterType, ctx) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Master requests</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
            Ask for a trainer, venue, competency or any other value that is not on a list yet — and
            see what happened to the one you asked for.
          </p>
        </div>
        <div className="w-72">
          <Combobox
            options={masterTypeOptions.map((o) => ({
              value: o.value,
              label: `Ask for a ${o.label.toLowerCase()}`,
            }))}
            value=""
            onChange={(v) => setAsking(v as LdMasterType)}
            placeholder="Ask for something…"
          />
        </div>
      </div>

      <QueueTable<MasterRequest>
        rows={s.masterRequests}
        rowKey={(r) => r.id}
        columns={columns}
        actions={(r) =>
          r.status === "pending" && s.canManageMaster(r.masterType) ? (
            <Button size="sm" onClick={() => openReview(r)}>
              Review
            </Button>
          ) : null
        }
        rowsLabel="requests"
        emptyTitle="Nothing has been asked for"
        emptyMessage="When somebody needs a value that is not on a list, it appears here."
        loading={s.loading}
        initialSort={{ key: "when", dir: "desc" }}
        exportName="learning-development-master-requests"
        exportTitle="Learning & Development — master requests"
      />

      {!s.canSeeMasters && (
        <Card className="p-4">
          <p className="text-[12.5px] text-grey-2">
            You can ask for a value here, but somebody else decides. An admin assigns an owner per
            list in Setup → Master Owners; with nobody set, an admin reviews it.
          </p>
        </Card>
      )}

      {asking && <RequestMasterModal open onClose={() => setAsking(null)} type={asking} />}

      {reviewing && (
        <Modal
          open
          onClose={() => setReviewing(null)}
          size={reviewFields.length > 4 ? "xl" : "md"}
          title={`Review: ${masterTypeLabel(reviewing.masterType)}`}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setReviewing(null)} disabled={busy}>
                Cancel
              </Button>
              {/* Reject stays disabled until a reason is typed: the person who
                  asked has to be told what to do instead, or they will simply
                  ask again. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void decide(false)}
                disabled={busy || !note.trim()}
              >
                Reject
              </Button>
              <Button size="sm" onClick={() => void decide(true)} disabled={busy}>
                {busy ? "Saving…" : "Approve"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-[13px] text-grey-2">
              Correct anything that is wrong before approving —{" "}
              <strong className="text-navy">what you save here is what the list gets</strong>, not
              what was typed. Approving a misspelling because it was quicker than fixing it is how a
              master list rots.
            </p>

            <div
              className={
                reviewFields.length > 4 ? "grid gap-x-5 gap-y-3.5 sm:grid-cols-2" : "space-y-3.5"
              }
            >
              {reviewFields.map((f) => (
                <div
                  key={f.key}
                  className={
                    reviewFields.length > 4 && f.type === "textarea" ? "sm:col-span-2" : undefined
                  }
                >
                  <FieldLabel label={f.label} required={f.required}>
                    {f.type === "select" ? (
                      <Combobox
                        value={values[f.key] ?? ""}
                        onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                        options={f.options ?? []}
                        placeholder={f.placeholder ?? "Select…"}
                        autoAdvance
                      />
                    ) : f.type === "textarea" ? (
                      <TextArea
                        rows={3}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                    ) : (
                      <TextInput
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                    )}
                    {f.hint && (
                      <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>
                    )}
                  </FieldLabel>
                </div>
              ))}
            </div>

            <FieldLabel label="Note back to whoever asked">
              <TextArea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Required when rejecting — say what they should do instead."
              />
            </FieldLabel>

            {reviewing.masterType === "session_type" && (
              <p className="rounded-lg bg-page px-3 py-2 text-[12.5px] text-grey-2">
                This will be created <strong className="text-navy">without a report code</strong>.
                Give it one on Masters → Session types afterwards if it needs to count on its own
                line; without one it still counts in the total.
              </p>
            )}

            {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
