import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../store";
import {
  emptyValuesFor,
  findExistingMaster,
  masterFields,
  missingRequired,
  payloadFromValues,
  type MasterValues,
} from "../lib/masterFields";
import { masterTypeLabel, type LdMasterType } from "../types";

/**
 * Ask for a value that is not on a list yet.
 *
 * ⚠ IT SAYS WHO WILL SEE IT. A request that disappears into a void is worse than
 *   no request at all: the person goes back to the step they were blocked on,
 *   finds it still blocked, and concludes the module does not work. An unowned
 *   list falls to the admins, and the modal says that too.
 *
 * ⚠ IT REFUSES A DUPLICATE BEFORE THE DATABASE DOES, case-insensitively — and it
 *   is loudest about an INACTIVE match. A deactivated row is hidden from every
 *   picker, so a requester has no way of knowing it is there, but the unique
 *   index still blocks the insert: approving such a request turns into a 23505
 *   that reads like a bug in the app. That one needs reactivating on the Masters
 *   screen, not adding again, and this is where somebody can still be told so.
 */
export default function RequestMasterModal({
  open,
  onClose,
  type,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  type: LdMasterType;
  initialName?: string;
}) {
  const s = useLdStore();
  const { user } = useSession();
  const d = s.data;

  const employeeOptions = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
    [s.orgPeople],
  );

  const ctx = useMemo(
    () => ({ employeeOptions, forRequest: true }),
    [employeeOptions],
  );

  const [values, setValues] = useState<MasterValues>(() => ({
    ...emptyValuesFor(type, { employeeOptions: [], forRequest: true }),
    name: initialName ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fields = masterFields(type, ctx);
  const label = masterTypeLabel(type).toLowerCase();

  /** Who will see this. An unowned list falls to the admins. */
  const owners = (d?.masterManagers ?? []).filter((m) => m.masterType === type);
  const goesTo =
    owners.length === 1
      ? `the 1 person who owns the ${label} list`
      : owners.length > 1
        ? `the ${owners.length} people who own the ${label} list`
        : "an admin — nobody owns this list yet";

  const existing = findExistingMaster(type, values, {
    sessionTypes: d?.sessionTypes ?? [],
    competencies: d?.competencies ?? [],
    needSources: d?.needSources ?? [],
    venues: d?.venues ?? [],
    trainers: d?.trainers ?? [],
    delayReasons: d?.delayReasons ?? [],
    followupActions: d?.followupActions ?? [],
  });

  const submit = async () => {
    const missing = missingRequired(type, values, ctx);
    if (missing) {
      setErr(missing);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await s.writes.requestMaster(type, payloadFromValues(type, values), user.id);
      await s.refresh();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={fields.length > 4 ? "xl" : "md"}
      title={`Ask for a ${label}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || existing?.active === true}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-grey-2">
          It goes to <strong className="text-navy">{goesTo}</strong>, who can correct it before
          approving. You will see what happened to it on this screen.
        </p>

        {type === "session_type" && (
          <p className="rounded-lg bg-page px-3 py-2 text-[12.5px] text-grey-2">
            A new session type arrives with <strong className="text-navy">no report code</strong>, so
            it counts in the total and on no separate line until an owner gives it one. That is
            deliberate — two types both claiming to be <code>posh</code> would break the year&rsquo;s
            compliance count.
          </p>
        )}

        <div className={fields.length > 4 ? "grid gap-x-5 gap-y-3.5 sm:grid-cols-2" : "space-y-3.5"}>
          {fields.map((f) => (
            <div key={f.key} className={fields.length > 4 && f.type === "textarea" ? "sm:col-span-2" : undefined}>
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
                {f.hint && <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>}
              </FieldLabel>
            </div>
          ))}
        </div>

        {existing && (
          <p
            className={
              existing.active
                ? "rounded-lg bg-[#FEF3F2] px-3 py-2 text-[12.5px] text-[#B42318]"
                : "rounded-lg bg-[#FFFAEB] px-3 py-2 text-[12.5px] text-[#B54708]"
            }
          >
            {existing.active ? (
              <>
                <strong>“{existing.name}” is already on the list.</strong> Go back to the step you
                were on and pick it — there is nothing to ask for.
              </>
            ) : (
              <>
                <strong>“{existing.name}” exists but is switched off,</strong> which is why you
                cannot see it. Asking for it again will be refused by the database when somebody
                approves it. Ask an owner to reactivate it on the Masters screen instead — say so in
                the name box if you send this anyway.
              </>
            )}
          </p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
