import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../store";
import SampleSummary from "./SampleSummary";
import type { SamplingRequest } from "../types";

/**
 * sample_collect — the collector collects the sample and hands it over. Picks the
 * recipient from `Self` + the recipient master, or types a free-text name for
 * someone off-system (a `free:` sentinel; a null recipient id then routes the next
 * step to its owners). Advances the request to awaiting_sample_received.
 */
export default function CollectModal({
  open,
  onClose,
  request,
  editing = false,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  request: SamplingRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useSamplingStore();
  const session = useSession();
  const selfId = session.user?.id ?? "";

  const [pick, setPick] = useState("");        // a userId, selfId, or `free:<name>`
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      // Pre-fill from the request: a chosen user, else a free-text name, else Self.
      setPick(
        request.handoverRecipientId ||
          (request.handoverRecipientName ? `free:${request.handoverRecipientName}` : selfId),
      );
      setErr(null);
      setBusy(false);
    }
  }, [open, request, selfId]);

  const options: ComboOption[] = useMemo(() => {
    const opts: ComboOption[] = [
      ...(selfId ? [{ value: selfId, label: "Self (me)" }] : []),
      ...s.activeRecipients.filter((r) => r.userId !== selfId).map((r) => ({ value: r.userId, label: r.name })),
    ];
    // Keep a typed free-text pick visible in the trigger.
    if (pick.startsWith("free:")) opts.push({ value: pick, label: pick.slice(5) });
    return opts;
  }, [s.activeRecipients, selfId, pick]);

  const save = async () => {
    if (!request) return;
    if (!pick.trim()) {
      setErr("Choose who the sample is handed to.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let recipientId: string | null = null;
      let recipientName: string | null = null;
      if (pick.startsWith("free:")) {
        recipientName = pick.slice(5).trim() || null;
      } else {
        recipientId = pick;
        recipientName =
          pick === selfId ? session.user?.name ?? "Self" : s.activeRecipients.find((r) => r.userId === pick)?.name ?? null;
      }
      // Date collected defaults to today server-side (the entry date).
      const input = { handoverRecipientId: recipientId, handoverRecipientName: recipientName, collectedDate: null };
      if (editing) await s.updateCollect(request, input);
      else await s.recordCollect(request, input);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      size="xl"
      // No subtitle: SampleSummary below already shows the product / description,
      // and repeating it under the title read as the same line twice.
      title={`${editing && !readOnly ? "Edit sample collection" : readOnly ? "Sample collection" : "Sample collect & handover"} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Sample collected & handed over"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {request && <SampleSummary request={request} />}
        <FieldLabel label="Whom did you hand it to" hint="pick a person, or type a name not in the list">
          <Combobox
            value={pick}
            onChange={setPick}
            options={options}
            placeholder="Select or type a name"
            searchable
            onCreate={(name) => {
              const v = `free:${name}`;
              setPick(v);
              return v;
            }}
            createLabel={(q) => `Hand to “${q}”`}
          />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
