import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useUpdateAnnouncement, type ManagedAnnouncement } from "@/core/announcements/data";
import AnnouncementFields, { validateFields, type FieldValues } from "./AnnouncementFields";

/**
 * Fix an announcement after it is posted: title, message, link, end date.
 *
 * Who it is for and whether it was emailed cannot change — a new audience or a new
 * mail is a new announcement. Saving NEVER sends email again, and everyone who closed
 * it stays closed (announcement_update keeps the dismissals).
 */
export default function EditAnnouncementModal({ row, onClose }: { row: ManagedAnnouncement | null; onClose: () => void }) {
  const update = useUpdateAnnouncement();
  const [fields, setFields] = useState<FieldValues>({ title: "", body: "", link: "", endsOn: "" });
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!row) return;
    setFields({ title: row.title, body: row.body ?? "", link: row.link_url ?? "", endsOn: row.ends_on });
    setTouched(false);
    setServerError("");
  }, [row]);

  if (!row) return null;
  const endLocked = row.status === "ended";
  // Only a CHANGED end date has to be today or later — fixing a typo on an expired
  // announcement must not demand a new date. The database draws the same line.
  const endChanged = fields.endsOn !== row.ends_on;
  const errors = validateFields(fields, { checkEnd: endChanged && !endLocked });
  const valid = Object.keys(errors).length === 0;

  const save = () => {
    setTouched(true);
    setServerError("");
    if (!valid) return;
    update.mutate(
      {
        id: row.id,
        title: fields.title.trim(),
        body: fields.body,
        link: fields.link,
        endsOn: endLocked || !endChanged ? null : fields.endsOn,
      },
      { onSuccess: onClose, onError: (e) => setServerError((e as Error).message) }
    );
  };

  return (
    <Modal
      open={!!row}
      onClose={() => !update.isPending && onClose()}
      title="Edit announcement"
      subtitle="Saving does not email anyone again, and anyone who closed it stays closed."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending || (touched && !valid)}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <AnnouncementFields value={fields} onChange={setFields} errors={touched ? errors : {}} endLocked={endLocked} />
      {serverError && (
        <div className="mt-4 rounded-xl border border-ryg-red/30 bg-[#FDECEC] px-4 py-3 text-[13px] text-ryg-red">{serverError}</div>
      )}
    </Modal>
  );
}
