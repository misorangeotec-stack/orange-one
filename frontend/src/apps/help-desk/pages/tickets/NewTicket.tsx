import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { useHelpStore } from "../../store";
import { raiseTicketWithFiles } from "../../data/helpWrites";
import { ConfidentialPill } from "../../components/StatusPill";
import { B } from "../../nav";
import type { TicketCategory } from "../../types";
import { appName } from "@/apps/appInfo";

/**
 * Raise a ticket.
 *
 * ⚠ THE CATEGORY IS THE WHOLE FORM. It decides who answers, by when, whether the
 *   ticket is confidential and whether the work belongs to another module — so
 *   the moment one is chosen the form SAYS ALL OF THAT, in the employee's own
 *   terms, before they submit. An employee who is told "Khushi Soni will answer
 *   this within 1 working day" has had their expectation set; one who is told
 *   nothing comes back tomorrow to ask where it got to, which is the phone call
 *   this module exists to stop.
 */
export default function NewTicket() {
  const s = useHelpStore();
  const nav = useNavigate();

  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [otherNote, setOtherNote] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<ComboboxHandle>(null);

  const cat: TicketCategory | undefined = s.categoryById(categoryId || null);

  const categoryOptions = useMemo(
    () =>
      s.raisableCategories.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.tatDays === null ? (c.tatText ?? "No fixed turnaround") : tatLabel(c),
      })),
    [s.raisableCategories],
  );

  const peopleOptions = useMemo(
    () =>
      s.orgPeople
        .filter((p) => p.id !== s.userId)
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople, s.userId],
  );

  const needsNote = !!cat?.requiresNote;
  const canSubmit =
    !!categoryId && subject.trim().length > 0 && (!needsNote || otherNote.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { ticketId, failedFiles } = await raiseTicketWithFiles(
        {
          categoryId,
          subject: subject.trim(),
          body: body.trim() || null,
          otherNote: otherNote.trim() || null,
          mentions,
        },
        file ? [file] : [],
      );
      await s.refresh();
      // ⚠ A FAILED UPLOAD DOES NOT LOSE THE TICKET — it is already raised and
      //   somebody already owes an answer. The employee is told which files to
      //   add again, on the ticket itself, rather than being sent back to a form
      //   whose other fields have gone.
      nav(
        `${B}/tickets/${ticketId}${failedFiles.length ? `?attachFailed=${encodeURIComponent(failedFiles.join(", "))}` : ""}`,
      );
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[20px] font-bold text-navy">Raise a ticket</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        Pick what it is about and we will route it to the right person with a turnaround they are
        held to.
      </p>

      <Card className="mt-4 p-5">
        <FieldLabel label="What is this about?" required>
          <Combobox
            ref={categoryRef}
            options={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            /* Focus moves ON to the next field after a selection, never back to
               the picker that was just answered. `autoAdvance` is the shared
               control's own implementation of that rule — a hand-rolled
               setTimeout(focus) here would race it. */
            autoAdvance
            searchable
            placeholder="Search the list: attendance, payroll, travel, admin…"
          />
        </FieldLabel>

        {cat && <CategoryReadout cat={cat} personName={s.personName} />}

        <div className="mt-4">
          <FieldLabel label="One line: what do you need?" required>
            <TextInput
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Payslip for August has not arrived"
              maxLength={200}
            />
          </FieldLabel>
        </div>

        {needsNote && (
          <div className="mt-4">
            <FieldLabel
              label="Tell us what it is about"
              required
              hint={`"${cat?.name}" has no fixed list, so this is the only thing the person answering will have to go on.`}
            >
              <TextArea
                rows={3}
                value={otherNote}
                onChange={(e) => setOtherNote(e.target.value)}
                placeholder="Describe it in your own words"
              />
            </FieldLabel>
          </div>
        )}

        <div className="mt-4">
          <FieldLabel label="Anything else that would help" hint="Dates, amounts, what you have already tried.">
            <TextArea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </FieldLabel>
        </div>

        <div className="mt-4">
          <FieldLabel
            label="Attach something"
            hint="A screenshot, a bill, a letter. One here, and you can add more from the ticket once it is raised."
          >
            <FileCapture value={file} onChange={setFile} />
          </FieldLabel>
        </div>

        <div className="mt-4">
          <FieldLabel
            label="Anyone else who should know"
            hint="They will be notified. Leave it empty unless somebody specific needs to see this."
          >
            <MultiSelect options={peopleOptions} values={mentions} onChange={setMentions} />
          </FieldLabel>
        </div>

        {err && (
          <p className="mt-4 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
            {err}
          </p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy ? "Sending…" : "Raise the ticket"}
          </Button>
          <button
            type="button"
            className="text-[13px] font-semibold text-grey-2 hover:text-navy"
            onClick={() => nav(`${B}/mine`)}
          >
            Cancel
          </button>
        </div>
      </Card>
    </div>
  );
}

const tatLabel = (c: TicketCategory): string => {
  if (c.tatDays === null) return c.tatText ?? "No fixed turnaround";
  if (c.tatDays === 0) return c.tatText ?? "Same working day";
  return `${c.tatDays} working day${c.tatDays === 1 ? "" : "s"}`;
};

/**
 * What the chosen category commits us to, said before the employee submits.
 *
 * ⚠ IT NAMES THE PERSON WHERE IT CAN, AND SAYS SO WHERE IT CANNOT. A category
 *   whose owner has been removed would otherwise read as a confident promise
 *   with nobody behind it. The same is true of the turnaround: five categories
 *   are deliberately untimed, and the honest line there is the policy's own
 *   words ("As per POSH Policy"), never an invented number of days.
 */
function CategoryReadout({
  cat,
  personName,
}: {
  cat: TicketCategory;
  personName: (id: string | null) => string;
}) {
  const owners = cat.ownerIds.map((id) => personName(id)).filter((n) => n !== "—");

  return (
    <div className="mt-3 rounded-lg border border-line bg-[#FAFAFB] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-navy">
          {owners.length
            ? `${owners.join(", ")} will answer this`
            : "Nobody is currently set to answer this category"}
        </span>
        {cat.confidential && <ConfidentialPill />}
      </div>

      <p className="mt-1 text-[12.5px] text-grey-2">
        {cat.tatDays === null ? (
          <>
            Turnaround: <span className="font-semibold text-navy">{tatLabel(cat)}</span>. This one
            is governed by policy rather than a fixed number of days, so it will not show a due
            date.
          </>
        ) : (
          <>
            Turnaround: <span className="font-semibold text-navy">{tatLabel(cat)}</span> from now.
          </>
        )}
      </p>

      {cat.confidential && (
        <p className="mt-1 text-[12.5px] text-[#B42318]">
          Only you, the HR owner above and anyone this is formally escalated to will be able to read
          it. The rest of the HR team cannot.
        </p>
      )}

      {/* Decision D1: Help Desk is the front door, but the work belongs elsewhere. */}
      {cat.handoffAppId && (
        <p className="mt-1 text-[12.5px] text-grey-2">
          This is handled in <span className="font-semibold text-navy">{appName(cat.handoffAppId)}</span>.
          Raise it here and HR will start it there for you, and you will get the reference back on this
          ticket.
        </p>
      )}

      {!owners.length && (
        <p className="mt-1 text-[12.5px] text-[#B54708]">
          You can still raise it, and an admin will route it. Tell HR that this category has no owner.
        </p>
      )}
    </div>
  );
}
