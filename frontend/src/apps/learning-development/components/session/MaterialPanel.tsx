import { useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, NotYours, useRun } from "./panelKit";
import DocField from "../DocField";
import type { TrainingSession } from "../../types";

const KIND_LABEL: Record<string, string> = {
  agenda: "Agenda",
  pre_read: "Pre-read",
  slides: "Slides",
  other: "Other",
};

/**
 * Step 12 — what people get before the session.
 *
 * ⚠ EVERY ITEM IS DELETABLE FROM DAY ONE. NR-5 is on the work list because every
 *   HR attachment shipped write-once and the RPCs structurally could not clear a
 *   value. Not repeating that.
 *
 * ⚠ AN EXTERNAL TRAINER HAS NO LOGIN, so HR uploads on their behalf — which is
 *   why this panel is offered to the step owner and not only to the trainer.
 */
export default function MaterialPanel({
  session: x,
  onError,
}: {
  session: TrainingSession;
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { busy, run } = useRun(onError);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("agenda");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const items = (s.data?.materials ?? []).filter((m) => m.sessionId === x.id);
  const mayEdit = s.canActOnSession("pre_material", x.id);
  const participant = s.isParticipant(x.id);

  return (
    <Panel
      title="Pre-training material"
      hint={
        x.readinessConfirmedAt
          ? `Marked ready ${dmy(x.readinessConfirmedAt)}`
          : "The agenda, the pre-read, anything people should see beforehand."
      }
      right={
        mayEdit && !x.readinessConfirmedAt && items.length > 0 ? (
          <Button size="sm" disabled={busy} onClick={() => void run(() => s.writes.confirmReadiness(x.id))}>
            Mark ready
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-grey-2">
          {participant ? "Nothing shared yet — you'll be notified when it is." : "Nothing shared yet."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div>
                <span className="text-[13.5px] text-navy">{m.title}</span>
                <span className="ml-2 rounded-full bg-[#F1F4F9] px-2 py-0.5 text-[11px] text-grey-2">
                  {KIND_LABEL[m.kind] ?? m.kind}
                </span>
                {m.linkUrl && (
                  <a
                    href={m.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-[12.5px] font-medium text-orange hover:underline"
                  >
                    Open the link
                  </a>
                )}
                {m.filePath && (
                  <span className="ml-2 inline-block align-middle">
                    {/* Read-only: the file is replaced by removing the item and
                        adding it again, which keeps one version per row. */}
                    <DocField path={m.filePath} disabled onUpload={async () => {}} />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-grey-2">{dmy(m.uploadedAt)}</span>
                {mayEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => s.writes.deleteMaterial(m.id))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {mayEdit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <div className="min-w-[14rem] flex-1">
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is it? e.g. Agenda"
            />
          </div>
          <div className="w-40">
            <Combobox
              value={kind}
              onChange={setKind}
              options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              {file ? file.name.slice(0, 22) : "Choose a file"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !title.trim()}
            onClick={() =>
              void run(
                async () => {
                  // Upload FIRST, then record the reference. If recording fails the
                  // object is orphaned, which is invisible; the reverse would save a
                  // path pointing at nothing and render a broken link forever.
                  const filePath = file ? await s.writes.uploadMaterial(x.id, file) : null;
                  await s.writes.addMaterial(x.id, {
                    title: title.trim(),
                    kind,
                    linkUrl: link.trim() || null,
                    filePath,
                  });
                },
                () => {
                  setTitle("");
                  setLink("");
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                },
              )
            }
          >
            Add
          </Button>
        </div>
      )}
      {!mayEdit && !participant && <NotYours stepKey="pre_material" what="Sharing material" />}
    </Panel>
  );
}
