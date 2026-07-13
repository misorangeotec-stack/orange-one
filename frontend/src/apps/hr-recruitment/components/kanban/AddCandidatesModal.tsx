import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import RequestMasterModal from "../RequestMasterModal";
import { useHrStore } from "../../store";
import { uploadResume, type CandidateInput } from "../../data/hrWrites";
import { parseResumes, type ParsedResume } from "../../data/parseResume";
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
});

/**
 * Add candidates — several at once, because CVs arrive in batches.
 *
 * The file uploads FIRST and independently of the details, so a candidate is always
 * creatable even if nothing can be read from the CV. The AI reads each CV and
 * PREFILLS these rows; it never writes to the database, because the human always
 * confirms before anything is saved. A parse that fails, times out or hits a .docx
 * leaves the row exactly as usable as it was before — HR just types the details in.
 *
 * A phone or email that already exists anywhere raises a duplicate warning — it
 * does not block, because the same person genuinely may apply to two vacancies.
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

  /** Pick several files at once — one row per CV, and the AI starts reading them now. */
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const added = list.map((f, i) => ({
      ...blank(`f${Date.now()}_${i}`),
      file: f,
      // A starting guess from the filename so the row is savable from the first second;
      // the AI replaces it unless HR has already typed over it.
      name: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
      read: "reading" as ReadState,
    }));
    setRows((rs) => [...rs.filter((r) => r.file || r.name.trim()), ...added]);

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
  const invalid = filled.length === 0;

  const dupes = (r: Row) => s.duplicatesOf(r.phone.trim() || null, r.email.trim() || null);

  /**
   * How the details got here. The column only allows ok | failed | manual, and that
   * vocabulary is exactly the question worth auditing: did the AI read this CV?
   */
  const parseStatusOf = (r: Row): CandidateInput["parseStatus"] =>
    r.read === "read" ? "ok" : r.read === "failed" || r.read === "unsupported" ? "failed" : "manual";

  const submit = async () => {
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

                {d.length > 0 && (
                  <p className="mt-2 rounded-lg border border-yellow/40 bg-[#FFF7E6] px-3 py-2 text-[12px] text-navy">
                    Already applied: {d.map((c) => s.requisitionById(c.requisitionId)?.mrfNo ?? "another vacancy").join(", ")}.
                    You can still add them.
                  </p>
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
