import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import RequestMasterModal from "../RequestMasterModal";
import { useHrStore } from "../../store";
import { uploadResume, type CandidateInput } from "../../data/hrWrites";
import { parseResumes, type ParsedResume } from "../../data/parseResume";
import {
  fileSha256,
  isBlocking,
  needsAck,
  signalsBetween,
  describeSignals,
  matchedRequisitionIds,
  type DupIdentity,
  type DupMatch,
  type DupSignal,
} from "../../lib/duplicates";
import { PHASE_OF, PHASE_PILL, STAGE_LABEL } from "../../lib/board";
import { formatDateDMY } from "@/shared/lib/date";
import type { Requisition } from "../../types";

/** What the AI has managed to do with this row's file, if anything. */
type ReadState = "none" | "reading" | "read" | "failed" | "unsupported";

/** The fields the AI can prefill — tracked so we never overwrite what HR typed. */
type Field = "name" | "phone" | "email" | "currentCompany" | "experienceYears" | "skills";

interface Row {
  key: string;
  file: File | null;
  name: string;
  phone: string;
  email: string;
  currentCompany: string;
  experienceYears: string;
  /** Comma-separated while it is being edited; split on save. */
  skills: string;
  read: ReadState;
  /** What the model actually said — stored on the candidate so quality stays auditable. */
  parsed: Record<string, unknown> | null;
  /** Fields the HUMAN has typed in. The AI fills around them, never over them. */
  touched: Partial<Record<Field, boolean>>;
  /** SHA-256 of the file. Null until it is computed, and null forever if it cannot be. */
  sha256: string | null;
  /**
   * The human's decision to add this row despite a duplicate. `null` = not decided.
   * A certain match needs a non-empty REASON; a likely match needs only the tick,
   * so it stores a fixed marker rather than prose.
   */
  ack: string | null;
}

const blank = (key: string): Row => ({
  key,
  file: null,
  name: "",
  phone: "",
  email: "",
  currentCompany: "",
  experienceYears: "",
  skills: "",
  read: "none",
  parsed: null,
  touched: {},
  sha256: null,
  ack: null,
});

/** What a "likely" match's tick records, when no typed reason is asked for. */
const ACK_CONFIRMED = "Confirmed as a different person";

/**
 * Add candidates — several at once, because CVs arrive in batches.
 *
 * The file uploads FIRST and independently of the details, so a candidate is always
 * creatable even if nothing can be read from the CV. The AI reads each CV and
 * PREFILLS these rows; it never writes to the database, because the human always
 * confirms before anything is saved. A parse that fails, times out or hits a .docx
 * leaves the row exactly as usable as it was before — HR just types the details in.
 *
 * ── Duplicates (FIX-5) ─────────────────────────────────────────────────────────
 *
 * This used to warn on a matching phone or email, anywhere, and never block. It
 * warned about Manali Desai and was clicked past; it could say nothing at all about
 * Purvi Upadhyay, whose CV yielded neither — as is true of 30 of the 119 live rows.
 * Seven duplicate rows across three vacancies came of it.
 *
 * Now, before anything is uploaded, each row is checked three ways:
 *
 *   · against the saved candidates on THIS vacancy — a certain match (same file,
 *     email or phone) blocks and needs a written reason; a likely one (filename or
 *     name) needs a tick;
 *   · against the saved candidates on OTHER vacancies — shown as context only,
 *     never blocking, because applying for two jobs is legitimate;
 *   · against the other rows in this same batch, which nothing else can see.
 *
 * The server enforces the certain tier again in `fms_hr_add_candidates`, so a stale
 * tab cannot walk past it.
 */
export default function AddCandidatesModal({
  requisition,
  open,
  onClose,
}: {
  requisition: Requisition;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [rows, setRows] = useState<Row[]>([blank("r0")]);
  const [platformId, setPlatformId] = useState("");
  /** Platform not in the master? Raise it for review without losing this form. */
  const [raisePlatform, setRaisePlatform] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const platforms: ComboOption[] = useMemo(
    () => s.jobPlatforms.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
    [s.jobPlatforms],
  );

  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** A human edit — from here on the AI leaves this field alone. */
  const edit = (key: string, field: Field, value: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, [field]: value, touched: { ...r.touched, [field]: true } } : r,
      ),
    );

  const addRow = () => setRows((rs) => [...rs, blank(`r${Date.now()}`)]);
  const removeRow = (key: string) => setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.key !== key)));

  /** Fill the fields the human has NOT typed in. An empty AI value is not an answer. */
  const applyParsed = (key: string, p: ParsedResume) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const fill = (field: Field, value: string) =>
          !r.touched[field] && value ? value : (r[field] as string);
        return {
          ...r,
          name: fill("name", p.name),
          phone: fill("phone", p.phone),
          email: fill("email", p.email),
          currentCompany: fill("currentCompany", p.currentCompany),
          experienceYears: fill("experienceYears", p.experienceYears === null ? "" : String(p.experienceYears)),
          skills: fill("skills", p.skills.join(", ")),
          read: "read",
          parsed: { ...p },
        };
      }),
    );

  /**
   * A first-guess name from the filename, so the row is savable from the first
   * second. The AI replaces it unless HR has already typed over it.
   *
   * ⚠ The collapse of runs of whitespace is not cosmetic. Without it,
   * "Purvi Upadhyay - EA.pdf" became the name `Purvi Upadhyay   EA` — which is
   * verbatim what a live duplicate row is called — because the hyphen became a
   * third space between two that were already there. Three of the four mangled
   * names in the live data have this shape, and the mangling is what stopped the
   * name from matching its properly-parsed twin.
   */
  const nameFromFile = (fileName: string): string =>
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/^\d{8,}[-_\s]+/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Pick several files at once — one row per CV, and the AI starts reading them now. */
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const added = list.map((f, i) => ({
      ...blank(`f${Date.now()}_${i}`),
      file: f,
      name: nameFromFile(f.name),
      read: "reading" as ReadState,
    }));
    setRows((rs) => [...rs.filter((r) => r.file || r.name.trim()), ...added]);

    // Fingerprint each file. Independent of the parse and of each other, because
    // this is the one duplicate signal that still works when the parse fails —
    // which is exactly the case that produced the duplicates. Never throws:
    // fileSha256 returns null when crypto.subtle is unavailable.
    for (const r of added) {
      if (!r.file) continue;
      void fileSha256(r.file).then((sha) => set(r.key, { sha256: sha }));
    }

    // Fire-and-forget: Save stays usable the whole time, and a row that is still being
    // read simply saves whatever is currently in it.
    void parseResumes(
      added.map((r) => ({ key: r.key, file: r.file })),
      {
        concurrency: 3,
        onEach: (key, result) => {
          if (result.ok) applyParsed(key, result.data);
          else set(key, { read: result.reason === "unsupported" ? "unsupported" : "failed" });
        },
      },
    );
  };

  const filled = rows.filter((r) => r.name.trim());

  const identityOfRow = (r: Row): DupIdentity => ({
    name: r.name.trim() || null,
    phone: r.phone.trim() || null,
    email: r.email.trim() || null,
    resumeName: r.file?.name ?? null,
    sha256: r.sha256,
  });

  const dupes = (r: Row): DupMatch[] => s.duplicatesOf(identityOfRow(r), requisition.id);

  /**
   * The same person twice IN THIS BATCH — dragged in twice, or the same CV saved
   * under two names.
   *
   * The store check cannot see this: neither row exists yet. The server does catch
   * it (the first insert is visible to the second row's check inside the same
   * transaction) — but only AFTER every file in the batch has been uploaded, and
   * nothing in this module can remove a storage object. So it has to be caught
   * here, before the upload loop.
   *
   * Only ever looks BACKWARDS, so the first row of a pair stays clean and the
   * second is the one asked about. Flagging both would leave no obvious row to drop.
   */
  const batchClash = (r: Row): DupSignal[] => {
    const i = rows.indexOf(r);
    const me = identityOfRow(r);
    for (let j = 0; j < i; j++) {
      if (!rows[j].name.trim()) continue;
      const sig = signalsBetween(me, identityOfRow(rows[j]));
      if (sig.length) return sig;
    }
    return [];
  };

  /**
   * What this row still needs from the human before it can be saved.
   *
   * A CERTAIN match on this vacancy (same file, email or phone) needs a typed
   * reason — it is not a judgement call, so adding anyway is a decision worth
   * recording. A LIKELY match (same filename or name) needs only the tick.
   */
  const blockedBy = (r: Row): { matches: DupMatch[]; needsReason: boolean } | null => {
    const ms = dupes(r);
    const hard = ms.filter(isBlocking);
    const soft = ms.filter(needsAck);
    if (!hard.length && !soft.length) return null;
    return { matches: [...hard, ...soft], needsReason: hard.length > 0 };
  };

  const unresolved = (r: Row): boolean => {
    // A clash inside this batch is never waved through with a reason — there is no
    // "add anyway" case for adding the very same CV twice in one go. Drop the row.
    if (batchClash(r).length) return true;
    const b = blockedBy(r);
    if (!b) return false;
    return b.needsReason ? !r.ack?.trim() : r.ack === null;
  };

  const blockedRows = filled.filter(unresolved);
  const invalid = filled.length === 0 || blockedRows.length > 0;

  /**
   * How the details got here. The column only allows ok | failed | manual, and that
   * vocabulary is exactly the question worth auditing: did the AI read this CV?
   */
  const parseStatusOf = (r: Row): CandidateInput["parseStatus"] =>
    r.read === "read" ? "ok" : r.read === "failed" || r.read === "unsupported" ? "failed" : "manual";

  const submit = async () => {
    // 🔴 THE DUPLICATE CHECK RUNS BEFORE ANY UPLOAD, and that ordering is the whole
    // point. The file is written to storage first so a candidate is creatable
    // whatever else fails — but NOTHING in this module can remove a storage object
    // (NR-5), so a CV uploaded for a row the server then refuses is orphaned in the
    // bucket for good. Check first, upload second.
    const stillBlocked = filled.filter(unresolved);
    if (stillBlocked.length) {
      setErr(
        `${stillBlocked.length} candidate${stillBlocked.length === 1 ? " is" : "s are"} already on this vacancy. ` +
          `Reconsider the existing record, remove the row, or say why you are adding it anyway.`,
      );
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const inputs: CandidateInput[] = [];
      for (let i = 0; i < filled.length; i++) {
        const r = filled[i];
        setProgress(`Uploading ${i + 1} of ${filled.length}…`);
        let resumePath: string | null = null;
        let resumeName: string | null = null;
        if (r.file) {
          // The file lands first, so the candidate is creatable no matter what.
          const up = await uploadResume(requisition.id, r.file);
          resumePath = up.path;
          resumeName = up.name;
        }
        const years = Number(r.experienceYears.trim());
        inputs.push({
          name: r.name.trim(),
          phone: r.phone.trim() || null,
          email: r.email.trim() || null,
          currentCompany: r.currentCompany.trim() || null,
          experienceYears: r.experienceYears.trim() && Number.isFinite(years) ? years : null,
          skills: r.skills
            .split(",")
            .map((sk) => sk.trim())
            .filter(Boolean),
          notes: null,
          sourcePlatformId: platformId || null,
          resumePath,
          resumeName,
          resumeSha256: r.sha256,
          // Only ever sent when this row actually had a duplicate the human waved
          // through. A row with no match sends nothing, so the server's guard is
          // never handed a blanket permission.
          duplicateAck: blockedBy(r) ? (r.ack?.trim() || ACK_CONFIRMED) : null,
          parseStatus: parseStatusOf(r),
          parsedJson: r.parsed ?? {},
        });
      }
      setProgress("Saving…");
      await s.addCandidates(requisition.id, inputs);
      setRows([blank("r0")]);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      // A two-column form of six fields cannot breathe in the default 448px dialog —
      // it was truncating its own placeholders ("Skills (comma separat…").
      size="xl"
      title={`Add candidates — ${requisition.mrfNo}`}
      subtitle={`${requisition.jobTitle} · ${requisition.positionsRequired} ${requisition.positionsRequired === 1 ? "seat" : "seats"}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? progress || "Saving…" : `Add ${filled.length || ""} candidate${filled.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_260px]">
          {/* The drop zone. The native file input is visually hidden behind it — the
              browser's "Choose Files / No file chosen" chrome cannot be styled and was
              the ugliest thing on the screen. */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition ${
              dragOver ? "border-orange bg-orange/5" : "border-line bg-page/50 hover:border-orange/50 hover:bg-page"
            }`}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
              className="sr-only"
            />
            <svg
              viewBox="0 0 24 24"
              className="mb-1.5 h-6 w-6 text-grey-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-[13.5px] font-semibold text-navy">
              Drop CVs here, or <span className="text-orange">browse</span>
            </span>
            <span className="mt-0.5 text-[11.5px] text-grey">
              Several at once. PDFs and scans are read for you — always check what came back.
            </span>
          </label>

          <FieldLabel label="Where did they come from?" hint="optional">
            <Combobox
              value={platformId}
              onChange={setPlatformId}
              options={platforms}
              placeholder="Select platform"
              onCreate={(name) => setRaisePlatform(name)}
              createLabel={(q) => `Request new platform “${q}”`}
            />
            <span className="mt-1.5 block text-[11px] leading-snug text-grey">
              This is what later tells you which platform actually produces hires.
            </span>
            {requested && (
              <span className="mt-1 block text-[11px] text-teal">
                Requested platform “{requested}” — selectable once the master's owner approves it.
              </span>
            )}
          </FieldLabel>
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => {
            const d = dupes(r);
            const clash = batchClash(r);
            return (
              <div key={r.key} className="rounded-xl border border-line p-4">
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line pb-2.5">
                  <span className={FIELD_LABEL_CLASS}>Candidate {i + 1}</span>
                  {r.file && <span className="truncate text-[12px] text-grey">· {r.file.name}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <ReadChip state={r.read} fileName={r.file?.name ?? ""} />
                    {rows.length > 1 && (
                      <button
                        onClick={() => removeRow(r.key)}
                        className="text-[12px] font-semibold text-grey-2 hover:text-ryg-red"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* Real labels, not placeholders. A placeholder is what truncated to
                    "Skills (comma separat…", and it vanishes the moment you type — so
                    a half-filled row stopped saying what its own fields were. */}
                <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FieldLabel label="Name" required>
                    <TextInput value={r.name} onChange={(e) => edit(r.key, "name", e.target.value)} />
                  </FieldLabel>
                  <FieldLabel label="Phone">
                    <TextInput value={r.phone} onChange={(e) => edit(r.key, "phone", e.target.value)} />
                  </FieldLabel>
                  <FieldLabel label="Email">
                    <TextInput value={r.email} onChange={(e) => edit(r.key, "email", e.target.value)} />
                  </FieldLabel>
                  <FieldLabel label="Current company">
                    <TextInput
                      value={r.currentCompany}
                      onChange={(e) => edit(r.key, "currentCompany", e.target.value)}
                    />
                  </FieldLabel>
                  <FieldLabel label="Experience" hint="years">
                    <TextInput
                      value={r.experienceYears}
                      onChange={(e) => edit(r.key, "experienceYears", e.target.value)}
                    />
                  </FieldLabel>
                  <FieldLabel label="Skills" hint="comma separated">
                    <TextInput value={r.skills} onChange={(e) => edit(r.key, "skills", e.target.value)} />
                  </FieldLabel>
                </div>

                {clash.length > 0 && (
                  <div className="mt-2.5 rounded-xl border border-ryg-red/40 bg-[#FDECEC] px-3.5 py-3">
                    <p className="text-[12.5px] font-semibold text-navy">
                      This is already one of the rows above.
                    </p>
                    <p className="mt-1 text-[11.5px] text-grey">
                      Matched on {describeSignals(clash)}. Adding it
                      would create two records for one person on this vacancy.
                    </p>
                    {rows.length > 1 && (
                      <button
                        onClick={() => removeRow(r.key)}
                        className="mt-2 text-[12px] font-semibold text-orange hover:underline"
                      >
                        Remove this row
                      </button>
                    )}
                  </div>
                )}

                {clash.length === 0 && d.length > 0 && (
                  <DuplicatePanel
                    matches={d}
                    ack={r.ack}
                    onAck={(v) => set(r.key, { ack: v })}
                    onDrop={() => removeRow(r.key)}
                    canRemove={rows.length > 1}
                  />
                )}
              </div>
            );
          })}
        </div>

        <button onClick={addRow} className="text-[12.5px] font-semibold text-orange hover:underline">
          + Add another
        </button>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the CV rows intact underneath. */}
      <RequestMasterModal
        stacked
        open={raisePlatform !== null}
        onClose={() => setRaisePlatform(null)}
        masterType="job_platform"
        lockType
        prefill={{ name: raisePlatform ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
    </Modal>
  );
}

/**
 * "This person is already here — and here is where."
 *
 * The old version of this was one sentence naming an MRF number: "Already applied:
 * MRF-2627-0018. You can still add them." It did fire for Manali Desai, and it was
 * clicked straight past, because it never said the thing that would have stopped
 * anyone — that she was already on THIS vacancy, and what had happened to her.
 *
 * So this shows the stage, the date, and the reason she was dropped, and it
 * separates the two cases sharply: same vacancy is a mistake being made right now,
 * another vacancy is just useful context.
 */
function DuplicatePanel({
  matches,
  ack,
  onAck,
  onDrop,
  canRemove,
}: {
  matches: DupMatch[];
  ack: string | null;
  onAck: (v: string | null) => void;
  onDrop: () => void;
  canRemove: boolean;
}) {
  const s = useHrStore();
  const here = matches.filter((m) => m.sameRequisition);
  const elsewhere = matches.filter((m) => !m.sameRequisition);
  const hard = here.some(isBlocking);

  if (!here.length) {
    // Another vacancy only. Not a problem — applying for two jobs is normal, and
    // this is the one case the old wording actually got right.
    return (
      <p className="mt-2 rounded-lg border border-line bg-page px-3 py-2 text-[12px] text-grey-2">
        Also applied to{" "}
        {matchedRequisitionIds(elsewhere)
          .map((id) => s.requisitionById(id)?.mrfNo ?? "another vacancy")
          .join(", ")}
        . That is fine — this is only for context.
      </p>
    );
  }

  return (
    <div
      className={`mt-2.5 rounded-xl border px-3.5 py-3 ${
        hard ? "border-ryg-red/40 bg-[#FDECEC]" : "border-yellow/50 bg-[#FFF7E6]"
      }`}
    >
      <p className="text-[12.5px] font-semibold text-navy">
        {hard
          ? "This person is already on this vacancy."
          : "This may already be someone on this vacancy."}
      </p>

      <div className="mt-2.5 space-y-2">
        {here.map((m) => {
          const c = m.candidate;
          const phase = PHASE_OF[c.stage];
          const reason =
            c.disqualificationNote ??
            s.disqualificationReasons.find((x) => x.id === c.disqualificationReasonId)?.name ??
            null;
          return (
            <div key={c.id} className="rounded-lg border border-line bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-semibold text-navy">{c.name}</span>
                <span className="font-mono text-[11px] text-grey-2">{c.candidateNo}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PHASE_PILL[phase]}`}>
                  {STAGE_LABEL[c.stage]}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-grey">
                Added {formatDateDMY(c.uploadedAt)} · matched on{" "}
                {describeSignals(m.signals)}
              </p>
              {c.stage === "disqualified" && (
                <p className="mt-1 text-[11.5px] text-grey">
                  Dropped {formatDateDMY(c.disqualifiedAt)}
                  {reason ? ` — “${reason}”` : ""}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <Link
                  to={`/hr-recruitment/candidates/${c.id}`}
                  className="text-[12px] font-semibold text-orange hover:underline"
                >
                  Open this candidate
                </Link>
                {c.stage === "disqualified" && (
                  <span className="text-[11.5px] text-grey-2">
                    To consider them again, reopen this record rather than adding a second one —
                    the button is on their page.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {elsewhere.length > 0 && (
        <p className="mt-2 text-[11.5px] text-grey-2">
          They have also applied to{" "}
          {matchedRequisitionIds(elsewhere)
            .map((id) => s.requisitionById(id)?.mrfNo ?? "another vacancy")
            .join(", ")}
          .
        </p>
      )}

      {/* The way out. Never absent — a re-application after a rejection is real,
          and refusing it outright would just push people to work around us. */}
      <div className="mt-3 border-t border-line pt-2.5">
        {hard ? (
          <>
            <FieldLabel label="Add anyway — why?" hint="recorded against the vacancy">
              <TextInput
                value={ack ?? ""}
                placeholder="e.g. re-applying after the earlier rejection"
                onChange={(e) => onAck(e.target.value)}
              />
            </FieldLabel>
            <p className="mt-1 text-[11px] text-grey-2">
              Leave this empty and the row will not save.
            </p>
          </>
        ) : (
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-navy">
            <input
              type="checkbox"
              checked={ack !== null}
              onChange={(e) => onAck(e.target.checked ? ACK_CONFIRMED : null)}
              className="mt-0.5"
            />
            <span>I have checked — this is a different person</span>
          </label>
        )}
        {canRemove && (
          <button
            onClick={onDrop}
            className="mt-2 text-[12px] font-semibold text-grey-2 hover:text-ryg-red"
          >
            Remove this row instead
          </button>
        )}
      </div>
    </div>
  );
}

/** Says what the AI did with this CV — in plain words, because HR reads it, not us. */
function ReadChip({ state, fileName }: { state: ReadState; fileName: string }) {
  if (state === "none") return null;

  const isWord = /\.(docx?|rtf|odt|pages)$/i.test(fileName);
  const chip =
    state === "reading"
      ? { text: "Reading the CV…", cls: "border-line bg-page text-grey" }
      : state === "read"
        ? { text: "Filled in from the CV — please check", cls: "border-ryg-green/40 bg-[#EAF7EF] text-navy" }
        : state === "unsupported"
          ? {
              text: isWord
                ? "Word files can't be read — please type the details in"
                : "This file type can't be read — please type the details in",
              cls: "border-line bg-page text-grey",
            }
          : { text: "Couldn't read this one — please type the details in", cls: "border-line bg-page text-grey" };

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>
  );
}
