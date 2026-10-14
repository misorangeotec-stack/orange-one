import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { isTeamsLink, parseIcs } from "../../lib/training";
import type { TrainingCategory, TrainingSession } from "../../types";

/**
 * Add or edit ONE calendar training (requirement 1 + 2 of 14-10-2026).
 *
 * Laid out like creating a Teams meeting: what, when, the Teams link, and the
 * people invited. Attendees can be picked one by one, a whole department at a
 * time, or "everyone" — the same choices HR makes when inviting in Teams.
 *
 * ⚠ THE ATTENDEE LIST IS THE FULL LIST. On an edit, taking somebody off removes
 *   them (and if they already had the invite mail, they get a cancellation for
 *   themselves). The server does that; this form only says so.
 */
export default function TrainingFormModal({
  open,
  onClose,
  session,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Present = edit. */
  session?: TrainingSession | null;
  defaultDate?: string | null;
  onSaved?: (id: string) => void;
}) {
  const s = useLdStore();
  const d = s.data;
  const editing = !!session;

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TrainingCategory>("internal");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [link, setLink] = useState("");
  const [description, setDescription] = useState("");
  const [trainerUser, setTrainerUser] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [trainerText, setTrainerText] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [dept, setDept] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const icsRef = useRef<HTMLInputElement>(null);

  /** Fill the form from a meeting saved out of Outlook / Teams (.ics). Only fills what the file has. */
  const importIcs = async (file: File) => {
    setErr(null);
    setImported(null);
    try {
      const m = parseIcs(await file.text());
      if (!m.date && !m.teamsLink && !m.title) throw new Error("No meeting found in this file. Save the meeting from Outlook as an .ics file and try again.");
      if (m.title && !title.trim()) setTitle(m.title);
      if (m.date) setDate(m.date);
      if (m.start) setStart(m.start);
      if (m.end) setEnd(m.end);
      if (m.teamsLink) setLink(m.teamsLink);
      if (m.description && !description.trim()) setDescription(m.description);
      setImported(
        [m.date && "date", m.start && "time", m.teamsLink && "Teams link", m.title && "title"].filter(Boolean).join(", "),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Load the row being edited (or reset) whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setImported(null);
    setDept("");
    if (session) {
      setTitle(session.title);
      setCategory(session.category ?? "internal");
      setDate(session.sessionDate);
      setStart((session.startTime ?? "10:00").slice(0, 5));
      setEnd((session.endTime ?? "11:00").slice(0, 5));
      setLink(session.meetingLink ?? "");
      setDescription(session.description ?? "");
      setTrainerUser(session.trainerUserId ?? "");
      setTrainerId(session.trainerId ?? "");
      setTrainerText(session.externalTrainerName ?? "");
      setTypeIds(session.sessionTypeIds ?? []);
      setAttendees(
        (d?.nominations ?? [])
          .filter((n) => n.sessionId === session.id && n.status === "approved")
          .map((n) => n.employeeId),
      );
    } else {
      setTitle("");
      setCategory("internal");
      setDate(defaultDate ?? "");
      setStart("10:00");
      setEnd("11:00");
      setLink("");
      setDescription("");
      setTrainerUser("");
      setTrainerId("");
      setTrainerText("");
      setTypeIds([]);
      setAttendees([]);
    }
  }, [open, session, defaultDate, d?.nominations]);

  const people = s.orgPeople;
  const peopleOptions: MultiOption[] = useMemo(
    () =>
      people
        .map((p) => ({
          value: p.id,
          label: p.designation ? `${p.name} · ${p.designation}` : p.name,
          group: s.departmentName(p.departmentId),
        }))
        // Grouped by department — the list shows a group where it FIRST appears.
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)),
    [people, s.departmentName],
  );
  const deptOptions = useMemo(
    () =>
      s.orgDepartments
        .map((x) => ({
          value: x.id,
          label: x.name,
          sublabel: `${people.filter((p) => p.departmentId === x.id).length} people`,
        }))
        .filter((o) => o.sublabel !== "0 people")
        .sort((a, b) => a.label.localeCompare(b.label)),
    [s.orgDepartments, people],
  );

  const externalTrainers = (d?.trainers ?? []).filter((t) => t.active && t.trainerType === "external");
  const sessionTypes = (d?.sessionTypes ?? []).filter((t) => t.active);

  const addDept = (deptId: string) => {
    const ids = people.filter((p) => p.departmentId === deptId).map((p) => p.id);
    setAttendees((cur) => Array.from(new Set([...cur, ...ids])));
    setDept("");
  };

  const linkOk = link.trim() === "" || isTeamsLink(link);
  const hours = (() => {
    const [a, b] = [start, end].map((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
    return b > a ? (b - a) / 60 : 0;
  })();

  const valid =
    // The Teams link is optional (HR, 14-10-2026) — but when typed it must be a Teams one.
    title.trim() !== "" && !!date && !!start && !!end && hours > 0 && linkOk && attendees.length > 0;

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const id = await s.writes.saveCalendarTraining({
        id: session?.id ?? null,
        title: title.trim(),
        category,
        sessionDate: date,
        startTime: start,
        endTime: end,
        teamsLink: link.trim(),
        description: description.trim() || null,
        trainerUserId: category === "internal" ? trainerUser || null : null,
        trainerId: category === "external" ? trainerId || null : null,
        externalTrainerName: category === "external" && !trainerId ? trainerText.trim() || null : null,
        sessionTypeIds: typeIds,
        attendeeIds: attendees,
      });
      await s.refresh();
      onSaved?.(id);
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
      size="xl"
      title={editing ? "Edit training" : "Add training"}
      subtitle={
        editing
          ? "Changing the date, time, title or Teams link sends an “Updated” mail to anyone who already had the invite."
          : "Attendees get the Teams-style invitation 3 days before the training."
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={() => void save()} disabled={busy || !valid}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add to calendar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Category first — it decides who the trainer can be. */}
        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-navy">Category <span className="text-orange">*</span></div>
          <div className="inline-flex rounded-xl border border-line bg-white p-1">
            {(["internal", "external"] as TrainingCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={
                  "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition " +
                  (category === c
                    ? c === "internal"
                      ? "bg-[#EAF1FE] text-[#1D4ED8]"
                      : "bg-[#F1ECFE] text-[#6D28D9]"
                    : "text-grey-2 hover:text-navy")
                }
              >
                {c === "internal" ? "Internal training" : "External training"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-grey-2">
            {category === "internal" ? "Conducted by our own team." : "Conducted by an outside trainer or agency."}
          </p>
        </div>

        {/* A Teams link alone carries no date or time — the calendar entry does, so
            the meeting saved from Outlook (.ics) is what can fill the form. */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[#C7C9F2] bg-[#F7F7FD] px-3.5 py-2.5">
          <div className="text-[12.5px] text-navy">
            <b>Already created the meeting in Outlook / Teams?</b>{" "}
            <span className="text-grey-2">Save it as an .ics file and import it — date, time, title and Teams link fill in.</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => icsRef.current?.click()}>Import meeting (.ics)</Button>
          <input
            ref={icsRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importIcs(f);
              if (icsRef.current) icsRef.current.value = "";
            }}
          />
        </div>
        {imported && <p className="-mt-2 text-[12.5px] text-ryg-green">Filled from the meeting: {imported}. Check them below.</p>}

        <FieldLabel label="Training title" required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Advanced Excel for accounts" />
        </FieldLabel>

        <div className="grid gap-4 sm:grid-cols-4">
          <FieldLabel label="Date" required>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Starts" required>
            <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Ends" required>
            <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Hours">
            <div className={"py-2.5 text-[14px] " + (hours > 0 ? "text-navy" : "text-[#B42318]")}>
              {hours > 0 ? `${Number(hours.toFixed(2))} h` : "End must be after start"}
            </div>
          </FieldLabel>
        </div>

        <FieldLabel
          label="Microsoft Teams meeting link (optional)"
          hint="Add it now or later — attendees get an “Updated” mail when it is added."
        >
          <TextInput
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://teams.microsoft.com/l/meetup-join/…"
          />
        </FieldLabel>
        {!linkOk && (
          <p className="-mt-2 text-[12.5px] text-[#B42318]">
            This is not a Microsoft Teams link. It must start with https://teams.microsoft.com/ (or teams.live.com).
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {category === "internal" ? (
            <FieldLabel label="Trainer (from Orange Hub)" hint="They can press Complete and mark attendance.">
              <Combobox
                value={trainerUser}
                onChange={setTrainerUser}
                options={people.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined }))}
                placeholder="Pick the person conducting it"
                clearable
              />
            </FieldLabel>
          ) : (
            <FieldLabel label="Trainer / agency" hint="Pick from the Trainers list, or type a name.">
              <div className="space-y-2">
                <Combobox
                  value={trainerId}
                  onChange={setTrainerId}
                  options={externalTrainers.map((t) => ({ value: t.id, label: t.name, sublabel: t.agency ?? undefined }))}
                  placeholder={externalTrainers.length ? "Pick from the Trainers list" : "No external trainers on the list yet"}
                  clearable
                />
                {!trainerId && (
                  <TextInput
                    value={trainerText}
                    onChange={(e) => setTrainerText(e.target.value)}
                    placeholder="…or type the trainer / agency name"
                  />
                )}
              </div>
            </FieldLabel>
          )}
          <FieldLabel label="Training type (optional)">
            <MultiSelect
              values={typeIds}
              onChange={setTypeIds}
              options={sessionTypes.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="Technical, Safety, POSH…"
              chips
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Agenda / description">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it covers — goes into the invitation mail." />
        </FieldLabel>

        {/* Attendees — like the "Invite people" box of a Teams meeting. */}
        <div className="rounded-xl border border-line bg-[#FAFBFD] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-navy">
              Attendees <span className="text-orange">*</span>{" "}
              <span className="font-normal text-grey-2">· {attendees.length} selected</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-56">
                <Combobox value={dept} onChange={(v) => v && addDept(v)} options={deptOptions} placeholder="+ Add a department" />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setAttendees(people.map((p) => p.id))}>
                + Everyone ({people.length})
              </Button>
              {attendees.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setAttendees([])}>Clear</Button>
              )}
            </div>
          </div>
          <div className="mt-2.5">
            <MultiSelect
              values={attendees}
              onChange={setAttendees}
              options={peopleOptions}
              placeholder="Search people by name"
              chips
            />
          </div>
          <p className="mt-2 text-[11.5px] text-grey-2">
            Only Orange Hub users can be added — their attendance and training hours hang off their login.
          </p>
        </div>

        {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      </div>
    </Modal>
  );
}
