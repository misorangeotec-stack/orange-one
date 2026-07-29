import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateTime } from "@/shared/lib/time";
import { useAssetStore } from "../store";
import {
  describePayload,
  emptyValuesFor,
  findExistingMaster,
  masterFields,
  masterTypeLabel,
  payloadFromValues,
  type MasterValues,
} from "../lib/masterFields";
import { REQUESTABLE_ASSET_MASTER_TYPES, type AssetMasterType, type MasterRequest } from "../types";

/**
 * "I need a vendor that isn't in the list" — raised by anyone, resolved by that
 * master's owner (or an admin). Approving creates the real master row through the
 * SECURITY DEFINER RPC, so the reviewer does not need write access to the table
 * itself.
 */
export default function MasterRequests() {
  const s = useAssetStore();
  const [tab, setTab] = useState("review");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseType, setRaiseType] = useState<AssetMasterType>(REQUESTABLE_ASSET_MASTER_TYPES[0].value);
  const [raiseValues, setRaiseValues] = useState<MasterValues>(() => emptyValuesFor(REQUESTABLE_ASSET_MASTER_TYPES[0].value));
  const [reviewing, setReviewing] = useState<MasterRequest | null>(null);
  const [reviewValues, setReviewValues] = useState<MasterValues>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (tab === "review") return s.resolvableRequests;
    if (tab === "mine") return s.myMasterRequests;
    return s.masterRequests;
  }, [tab, s]);

  const openRaise = (mt: AssetMasterType) => {
    setRaiseType(mt);
    setRaiseValues(emptyValuesFor(mt));
    setError(null);
    setRaiseOpen(true);
  };

  const submitRaise = async () => {
    const name = (raiseValues.name ?? "").trim();
    if (!name) { setError("A name is required."); return; }
    const dupe = findExistingMaster(s.masterList(raiseType), name);
    if (dupe) {
      // Matches INACTIVE rows too — the unique index does not care, so approving
      // would fail with a constraint error rather than a sentence.
      setError(`"${dupe.name}" already exists${dupe.active ? "" : " (currently inactive)"}.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      await s.requestNewMaster(raiseType, payloadFromValues(raiseType, raiseValues));
      setRaiseOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
    } finally { setBusy(false); }
  };

  const openReview = (r: MasterRequest) => {
    const bag = emptyValuesFor(r.masterType);
    const next: MasterValues = { ...bag };
    for (const k of Object.keys(bag)) {
      const v = r.proposedPayload[k];
      if (v !== undefined && v !== null) next[k] = Array.isArray(v) ? v.join(",") : String(v);
    }
    setReviewValues(next);
    setNote("");
    setError(null);
    setReviewing(r);
  };

  const resolve = async (approve: boolean) => {
    if (!reviewing) return;
    setBusy(true); setError(null);
    try {
      await s.resolveMasterRequest(
        reviewing.id,
        approve,
        approve ? payloadFromValues(reviewing.masterType, reviewValues) : null,
        note.trim() || null,
      );
      setReviewing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the request.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Master requests</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Ask for a list entry you need, and review the ones you own.
          </p>
        </div>
        <Button size="sm" onClick={() => openRaise(REQUESTABLE_ASSET_MASTER_TYPES[0].value)}>
          Request a new entry
        </Button>
      </div>

      <Tabs
        tabs={[
          { key: "review", label: "To review", count: s.resolvableRequests.length },
          { key: "mine", label: "Mine", count: s.myMasterRequests.length },
          { key: "all", label: "All", count: s.masterRequests.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          message={tab === "review" ? "No requests are waiting on you." : "No requests yet."}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-navy">
                    {masterTypeLabel(r.masterType)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.status === "pending" ? "bg-[#FEF6E0] text-[#946200]"
                        : r.status === "approved" ? "bg-[#E7F6EC] text-[#087443]"
                        : "bg-[#FDECEC] text-ryg-red"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-grey">{describePayload(r.masterType, r.proposedPayload)}</p>
                <p className="mt-1 text-[12px] text-grey-2">
                  {s.personName(r.requestedBy)} · {formatDateTime(r.createdAt)}
                  {r.reviewNote ? ` · note: ${r.reviewNote}` : ""}
                </p>
              </div>
              {r.status === "pending" && s.canManage(r.masterType) && (
                <Button size="sm" onClick={() => openReview(r)}>Review</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ---- raise ---- */}
      <Modal
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        title="Request a new entry"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRaiseOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitRaise} disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldLabel label="What kind of entry" required>
            <Combobox
              value={raiseType}
              onChange={(x) => openRaise(x as AssetMasterType)}
              options={REQUESTABLE_ASSET_MASTER_TYPES.map((m) => ({ value: m.value, label: m.label }))}
            />
          </FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            {masterFields(raiseType).filter((f) => f.type !== "custom").map((f) => (
              <FieldLabel key={f.key} label={f.label} required={f.required} hint={f.hint}>
                {f.type === "textarea" ? (
                  <TextArea rows={2} value={raiseValues[f.key] ?? ""}
                    onChange={(e) => setRaiseValues((p) => ({ ...p, [f.key]: e.target.value }))} />
                ) : f.type === "select" ? (
                  <Combobox value={raiseValues[f.key] ?? ""} options={f.options ?? []}
                    onChange={(x) => setRaiseValues((p) => ({ ...p, [f.key]: x }))} />
                ) : (
                  <TextInput value={raiseValues[f.key] ?? ""}
                    onChange={(e) => setRaiseValues((p) => ({ ...p, [f.key]: e.target.value }))} />
                )}
              </FieldLabel>
            ))}
          </div>
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>

      {/* ---- review ---- */}
      <Modal
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title={reviewing ? `Review — ${masterTypeLabel(reviewing.masterType)}` : ""}
        subtitle={reviewing ? `Requested by ${s.personName(reviewing.requestedBy)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewing(null)} disabled={busy}>Close</Button>
            <Button variant="ghost" onClick={() => resolve(false)} disabled={busy}>Reject</Button>
            <Button onClick={() => resolve(true)} disabled={busy}>
              {busy ? "Saving…" : "Approve and create"}
            </Button>
          </>
        }
      >
        {reviewing && (
          <div className="space-y-4">
            <p className="text-[12.5px] text-grey">
              You can correct the details before approving — what you save here is what gets created.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {masterFields(reviewing.masterType).filter((f) => f.type !== "custom").map((f) => (
                <FieldLabel key={f.key} label={f.label} required={f.required} hint={f.hint}>
                  {f.type === "textarea" ? (
                    <TextArea rows={2} value={reviewValues[f.key] ?? ""}
                      onChange={(e) => setReviewValues((p) => ({ ...p, [f.key]: e.target.value }))} />
                  ) : f.type === "select" ? (
                    <Combobox value={reviewValues[f.key] ?? ""} options={f.options ?? []}
                      onChange={(x) => setReviewValues((p) => ({ ...p, [f.key]: x }))} />
                  ) : (
                    <TextInput value={reviewValues[f.key] ?? ""}
                      onChange={(e) => setReviewValues((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                </FieldLabel>
              ))}
            </div>
            <FieldLabel label="Note (optional)">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
            {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
