import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import SettingToggle from "@/shared/components/ui/SettingToggle";
import { TextArea, TextInput } from "@/shared/components/ui/Form";
import { deleteBunnyVideo, removeMedia } from "../data/client";
import {
  deleteMachine,
  insertMachine,
  StaleMachineError,
  syncMachineMedia,
  updateMachine,
  type MachineInput,
  type MediaInput,
} from "../data/mrWrites";
import { ControlRow, FormActions, FormField, FormSection } from "../components/FormLayout";
import MediaList from "../components/MediaList";
import { PageHeader, StatusPill } from "../components/Pills";
import VideoPanel from "../components/VideoPanel";
import VisibilityControl from "../components/VisibilityControl";
import { dmyTime } from "../lib/format";
import { BUNNY_UPLOAD_ON, youtubeId } from "../lib/video";
import { B } from "../nav";
import { useMrStore } from "../store";
import type { Machine, MachineStatus, SpecPair, VideoState } from "../types";

const MAX_PHOTOS = 15;
/** What the keyboard walks: enabled, and not taken off the Tab path on purpose. */
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]):not([type="hidden"]), textarea:not([disabled]):not([tabindex="-1"])';
const MAX_DOCS = 5;

interface FormState {
  title: string;
  categoryId: string;
  subcategoryId: string;
  printerBrandId: string;
  model: string;
  year: string;
  printWidth: string;
  headCount: string;
  headModel: string;
  inkTypeId: string;
  conditionId: string;
  hoursRun: string;
  specs: SpecPair[];
  description: string;
  city: string;
  state: string;
  quantity: string;
  status: MachineStatus;
  featured: boolean;
  sellerCode: string;
  sellerName: string;
  salespersonId: string;
  salespersonName: string;
  salespersonEmail: string;
  internalNotes: string;
  overrides: Record<string, boolean>;
  youtubeUrl: string;
  photos: MediaInput[];
  documents: MediaInput[];
}

const BLANK: FormState = {
  title: "",
  categoryId: "",
  subcategoryId: "",
  printerBrandId: "",
  model: "",
  year: "",
  printWidth: "",
  headCount: "",
  headModel: "",
  inkTypeId: "",
  conditionId: "",
  hoursRun: "",
  specs: [],
  description: "",
  city: "",
  state: "",
  quantity: "1",
  status: "inactive",
  featured: false,
  sellerCode: "",
  sellerName: "",
  salespersonId: "",
  salespersonName: "",
  salespersonEmail: "",
  internalNotes: "",
  overrides: {},
  youtubeUrl: "",
  photos: [],
  documents: [],
};

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const media = (list: Machine["photos"]): MediaInput[] => list.map((m) => ({ storagePath: m.storagePath, fileName: m.fileName }));

function fromMachine(m: Machine): FormState {
  return {
    title: m.title,
    categoryId: m.categoryId,
    subcategoryId: m.subcategoryId,
    printerBrandId: str(m.printerBrandId),
    model: str(m.model),
    year: str(m.year),
    printWidth: str(m.printWidthM),
    headCount: str(m.headCount),
    headModel: str(m.headModel),
    inkTypeId: str(m.inkTypeId),
    conditionId: str(m.conditionId),
    hoursRun: str(m.hoursRun),
    specs: m.specs.map((x) => ({ ...x })),
    description: str(m.description),
    city: str(m.city),
    state: str(m.state),
    quantity: String(m.quantity),
    status: m.status,
    featured: m.featured,
    sellerCode: str(m.sellerCode),
    sellerName: str(m.sellerName),
    salespersonId: str(m.salespersonId),
    salespersonName: str(m.salespersonName),
    salespersonEmail: str(m.salespersonEmail),
    internalNotes: str(m.internalNotes),
    overrides: { ...m.visibilityOverrides },
    youtubeUrl: str(m.youtubeUrl),
    photos: media(m.photos),
    documents: media(m.documents),
  };
}

/** A copy keeps the description of the machine, not its files, its video or its place on the website. */
function copyOf(m: Machine): FormState {
  return { ...fromMachine(m), title: `${m.title} (copy)`.slice(0, 150), status: "inactive", featured: false, photos: [], documents: [] };
}

const blank = (s: string) => (s.trim() ? s.trim() : null);

export default function MachineForm() {
  const s = useMrStore();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const copyFromId = params.get("copy");

  const record = routeId ? s.machineById(routeId) : undefined;
  const copySource = !routeId && copyFromId ? s.machineById(copyFromId) : undefined;

  // A new machine gets its id now, so its photos have a folder before the first save.
  const newIdRef = useRef<string>(crypto.randomUUID());
  // Set once a new machine's row exists, so a retried Save updates rather than inserts again.
  const [created, setCreated] = useState<{ updatedAt: string } | null>(null);
  const machineId = routeId ?? newIdRef.current;
  const exists = Boolean(record) || Boolean(created);

  // Seeded from the record on every render until the user changes something, so
  // a refresh of the store can never be overwritten by a stale copy in state.
  const seed = useMemo<FormState>(
    () => (record ? fromMachine(record) : copySource ? copyOf(copySource) : BLANK),
    [record, copySource],
  );
  const [edited, setEdited] = useState<FormState | null>(null);
  const f = edited ?? seed;
  // A copy arrives filled in and is worth saving as it stands, untouched.
  const dirty = edited !== null || (!routeId && !created && Boolean(copySource));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setEdited((cur) => ({ ...(cur ?? seed), [k]: v }));
  const patch = (p: Partial<FormState>) => setEdited((cur) => ({ ...(cur ?? seed), ...p }));

  // The row's updated_at as this form last knew it. Its own video writes move it on.
  const [baseline, setBaseline] = useState<string | null>(null);
  const loadedAt = baseline ?? created?.updatedAt ?? record?.updatedAt ?? null;
  const [videoLocal, setVideoLocal] = useState<{ id: string | null; state: VideoState | null } | null>(null);
  const video = videoLocal ?? { id: record?.bunnyVideoId ?? null, state: record?.bunnyVideoStatus ?? null };
  const onVideoRow = useCallback((at: string, vid: string | null, st: VideoState | null) => {
    setBaseline(at);
    setVideoLocal({ id: vid, state: st });
  }, []);
  // When the store catches up with the row, drop the local copies.
  useEffect(() => {
    if (record && baseline && record.updatedAt >= baseline) {
      setBaseline(null);
      setVideoLocal(null);
    }
  }, [record, baseline]);

  // Files uploaded in this sitting and not yet saved: removed if the form is abandoned.
  const unsaved = useRef<Set<string>>(new Set());
  useEffect(
    () => () => {
      const left = [...unsaved.current];
      if (left.length) void removeMedia(left).catch(() => undefined);
    },
    [],
  );

  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const canEdit = s.canEdit;

  // A new machine (or a copy) opens with the caret in its first field.
  useEffect(() => {
    if (!routeId && canEdit) {
      const t = window.setTimeout(() => titleRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [routeId, canEdit]);

  // ---- options -----------------------------------------------------------
  const categoryOptions: ComboOption[] = s.categories
    .filter((c) => c.active || c.id === f.categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (switched off)` }));
  const headOptions: ComboOption[] = s.printHeads
    .filter((h) => h.categoryId === f.categoryId && (h.active || h.id === f.subcategoryId))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((h) => ({ value: h.id, label: h.active ? h.name : `${h.name} (switched off)` }));
  const masterOptions = (kind: Parameters<typeof s.mastersOf>[0], keep: string): ComboOption[] =>
    s.mastersOf(kind, keep).map((m) => ({ value: m.id, label: m.active ? m.value : `${m.value} (switched off)` }));
  const locationOptions: ComboOption[] = s.mastersOf("location").map((m) => ({ value: m.value, label: m.value }));
  const currentPlace = [f.city.trim(), f.state.trim()].filter(Boolean).join(", ");

  // Seller: Orange's customer list, or a name typed in for someone not on it.
  const sellerOptions = useMemo<ComboOption[]>(
    () => s.sellers.map((p) => ({ value: `p:${p.id}`, label: p.name, sublabel: p.code ? `Code ${p.code}` : undefined })),
    [s.sellers],
  );
  const sellerValue = (() => {
    if (!f.sellerName) return "";
    const hit = s.sellers.find((p) => (f.sellerCode ? p.code === f.sellerCode : !p.code && p.name === f.sellerName));
    return hit ? `p:${hit.id}` : `t:${f.sellerName}`;
  })();
  const sellerOptionsWithTyped = sellerValue.startsWith("t:")
    ? [{ value: sellerValue, label: f.sellerName, sublabel: f.sellerCode ? `Code ${f.sellerCode}` : "Typed in, not on the customer list" }, ...sellerOptions]
    : sellerOptions;

  // Salesperson: hub users who can open Machine Resale.
  const personOptions: ComboOption[] = s.salespeople.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined }));
  const personWithSnapshot =
    f.salespersonId && !s.salespeople.some((p) => p.id === f.salespersonId)
      ? [{ value: f.salespersonId, label: f.salespersonName || "Unknown", sublabel: "No longer has Machine Resale access" }, ...personOptions]
      : personOptions;

  // ---- validation: one message per field, shown under it -------------------
  // Title, category and print head are always required (the database says so). The rest of
  // the requirements' "required" fields are required only to LIST a machine (Active or Sold),
  // which is the database's own rule (`mr_machines_complete_when_listed`): a machine can be
  // saved as an Inactive draft while its seller or photos are still being gathered.
  const listing = f.status !== "inactive";
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const t = f.title.trim();
    if (t.length < 3) e.title = "A title of at least 3 characters";
    else if (t.length > 150) e.title = "Keep it to 150 characters";
    if (!f.categoryId) e.categoryId = "Pick a category";
    if (!f.subcategoryId) e.subcategoryId = f.categoryId ? "Pick a print head" : "Pick the category first";
    if (f.year && (!/^\d{4}$/.test(f.year) || +f.year < 1970 || +f.year > 2100)) e.year = "A year like 2019";
    if (f.printWidth && !(Number(f.printWidth) > 0 && Number(f.printWidth) < 1000)) e.printWidth = "Metres, like 1.9";
    if (f.headCount && !(/^\d+$/.test(f.headCount) && +f.headCount > 0)) e.headCount = "A whole number";
    if (!/^\d+$/.test(f.quantity) || +f.quantity < 1) e.quantity = "1 or more";
    if (f.specs.some((x) => !x.label.trim() !== !x.value.trim())) e.specs = "Each line needs both a name and a value";
    if (f.youtubeUrl.trim() && !youtubeId(f.youtubeUrl.trim())) e.youtubeUrl = "Paste a YouTube video link, like https://youtu.be/...";
    if (listing) {
      if (!f.printerBrandId) e.printerBrandId = "Needed to list it";
      if (!f.conditionId) e.conditionId = "Needed to list it";
      if (!f.city.trim()) e.city = "Needed to list it";
      if (!f.state.trim()) e.state = "Needed to list it";
      if (!f.photos.length) e.photos = "At least one photo is needed to list it";
      if (!f.sellerName.trim()) e.seller = "Needed to list it";
      if (!f.salespersonId) e.salesperson = "Needed to list it";
    }
    return e;
  }, [f, listing]);
  const err = (k: string) => (tried ? errors[k] : undefined);
  /** The order the form shows its fields, so a failed save lands on the first one in red. */
  const ORDER = ["title", "categoryId", "subcategoryId", "printerBrandId", "year", "conditionId", "printWidth", "headCount", "specs", "city", "state", "quantity", "photos", "youtubeUrl", "seller", "salesperson"];

  const toInput = (): MachineInput => ({
    title: f.title.trim(),
    categoryId: f.categoryId,
    subcategoryId: f.subcategoryId,
    printerBrandId: f.printerBrandId || null,
    model: blank(f.model),
    year: f.year ? Number(f.year) : null,
    printWidthM: f.printWidth ? Number(f.printWidth) : null,
    headCount: f.headCount ? Number(f.headCount) : null,
    headModel: blank(f.headModel),
    inkTypeId: f.inkTypeId || null,
    conditionId: f.conditionId || null,
    hoursRun: blank(f.hoursRun),
    specs: f.specs.filter((x) => x.label.trim() && x.value.trim()).map((x) => ({ label: x.label.trim(), value: x.value.trim() })),
    description: blank(f.description),
    city: blank(f.city),
    state: blank(f.state),
    quantity: Number(f.quantity),
    status: f.status,
    featured: f.featured,
    sellerCode: blank(f.sellerCode),
    sellerName: blank(f.sellerName),
    salespersonId: f.salespersonId || null,
    salespersonName: blank(f.salespersonName),
    salespersonEmail: blank(f.salespersonEmail),
    internalNotes: blank(f.internalNotes),
    visibilityOverrides: f.overrides,
    youtubeUrl: blank(f.youtubeUrl),
  });

  const save = async () => {
    setTried(true);
    setSaved(null);
    setProblem(null);
    const bad = ORDER.filter((k) => errors[k]);
    if (bad.length) {
      setProblem(
        listing && bad.some((k) => errors[k]?.includes("to list it"))
          ? `To mark it ${f.status === "active" ? "Active" : "Sold"} it still needs the fields marked in red.`
          : "Check the fields marked in red.",
      );
      const box = formRef.current?.querySelector(`[data-field="${bad[0]}"]`);
      box?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const input = toInput();
      if (!exists) {
        const r = await insertMachine(machineId, input);
        setCreated({ updatedAt: r.updatedAt });
        await syncMachineMedia(machineId, f.photos, f.documents, []);
        unsaved.current.clear();
        await s.refresh();
        setEdited(null);
        navigate(`${B}/machines/${machineId}`, { replace: true });
        return;
      }
      const keptPaths = new Set([...f.photos, ...f.documents].map((m) => m.storagePath));
      const before = record ? [...record.photos, ...record.documents].map((m) => m.storagePath) : [];
      const removed = before.filter((p) => !keptPaths.has(p));
      const at = await updateMachine(machineId, input, loadedAt ?? "");
      setBaseline(at);
      await syncMachineMedia(machineId, f.photos, f.documents, removed);
      unsaved.current.clear();
      await s.refresh();
      setEdited(null);
      setTried(false);
      setSaved("Saved.");
    } catch (x) {
      setProblem(x instanceof StaleMachineError || x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!record) return;
    if (s.inquiries.some((i) => i.machineId === record.id)) {
      setConfirmDelete(false);
      setProblem("This machine has inquiries, so it cannot be deleted. Mark it Inactive or Sold instead.");
      return;
    }
    setBusy(true);
    try {
      await deleteMachine(record.id, [...record.photos, ...record.documents].map((m) => m.storagePath));
      // The row is gone, so its video is unused; tidy the library without holding up the page.
      if (video.id) void deleteBunnyVideo(video.id);
      unsaved.current.clear();
      await s.refresh();
      navigate(`${B}/machines`, { replace: true });
    } catch (x) {
      setProblem(x instanceof Error ? x.message : String(x));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Keys: Enter in a one-line box moves to the next field (a form that submits on Enter
   * saves half-typed machines); Ctrl+Enter saves; Alt+V flips the focused field's website
   * switch, which is kept off the Tab path so a keyboard run is one stop per field.
   */
  const onKeyDown = (ev: ReactKeyboardEvent<HTMLFormElement>) => {
    const t = ev.target as HTMLElement;
    // A picker's search box is portalled outside the form: leave its keys alone.
    if (!formRef.current?.contains(t)) return;
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (canEdit) void save();
      return;
    }
    if (ev.altKey && (ev.key === "v" || ev.key === "V")) {
      const toggle = t.closest("[data-vis-wrap]")?.querySelector<HTMLButtonElement>("[data-vis-toggle]");
      if (toggle) {
        ev.preventDefault();
        toggle.click();
      }
      return;
    }
    if (ev.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") {
      ev.preventDefault();
      const all = Array.from(formRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      all[all.indexOf(t) + 1]?.focus();
    }
  };

  if (routeId && !record) {
    return (
      <Card className="max-w-xl p-6">
        <h1 className="text-[18px] font-bold text-navy">Machine not found</h1>
        <p className="mt-2 text-[13.5px] text-grey">
          It may have been deleted. <Link to={`${B}/machines`} className="font-semibold text-orange hover:underline">Back to machines</Link>
        </p>
      </Card>
    );
  }

  const vis = (key: string) => (
    <VisibilityControl fieldKey={key} overrides={f.overrides} onChange={(o) => set("overrides", o)} disabled={!canEdit} />
  );

  const heading = record ? `${record.listingNo} · ${record.title}` : copySource ? "New machine (copy)" : "New machine";

  return (
    <div className="space-y-5">
      <PageHeader
        title={heading}
        sub={
          record
            ? `Last saved ${dmyTime(record.updatedAt)}${record.updatedByName ? ` by ${record.updatedByName}` : ""}.`
            : "Fill in what you know. It stays off the website until you mark it Active."
        }
      >
        {record && <StatusPill status={record.status} />}
        {record && canEdit && (
          <Link to={`${B}/machines/new?copy=${record.id}`}>
            <Button variant="ghost" size="sm">Copy machine</Button>
          </Link>
        )}
        {record && canEdit && (
          <Button variant="ghost" size="sm" className="text-ryg-red" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete
          </Button>
        )}
      </PageHeader>

      {canEdit && (
        <p className="text-[12px] text-grey-2">
          The pill beside each field says whether it shows on the website for this machine. Click it, or press Alt+V in the field.
          Enter moves to the next field; Ctrl+Enter saves.
        </p>
      )}

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={onKeyDown}
        className="space-y-5"
      >
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <Card className="space-y-6 p-5">
            <FormSection title="The machine">
              <FormField label="Machine title" required span={3} name="title" error={err("title")} aside={vis("title")}>
                <TextInput ref={titleRef} value={f.title} maxLength={150} onChange={(e) => set("title", e.target.value)} placeholder="Epson I3200 sublimation printer, 1.9 m" />
              </FormField>
              <FormField label="Category (printer type)" required group name="categoryId" error={err("categoryId")} aside={vis("category")}>
                <Combobox
                  disabled={!canEdit}
                  value={f.categoryId}
                  options={categoryOptions}
                  onChange={(v) => patch({ categoryId: v, subcategoryId: v === f.categoryId ? f.subcategoryId : "" })}
                  placeholder="Pick a category"
                  searchable
                  autoAdvance
                />
              </FormField>
              <FormField label="Print head" required group name="subcategoryId" error={err("subcategoryId")} aside={vis("subcategory")}>
                <Combobox
                  value={f.subcategoryId}
                  options={headOptions}
                  onChange={(v) => set("subcategoryId", v)}
                  placeholder={f.categoryId ? "Pick a print head" : "Pick the category first"}
                  disabled={!f.categoryId || !canEdit}
                  searchable
                  autoAdvance
                />
              </FormField>
              <FormField label="Printer brand" required={listing} group name="printerBrandId" error={err("printerBrandId")} aside={vis("printer_brand")}>
                <Combobox
                  disabled={!canEdit}
                  value={f.printerBrandId}
                  options={masterOptions("printer_brand", f.printerBrandId)}
                  onChange={(v) => set("printerBrandId", v)}
                  placeholder="Pick a brand"
                  searchable
                  autoAdvance
                />
              </FormField>
              <FormField label="Model" name="model" aside={vis("model")}>
                <TextInput value={f.model} maxLength={100} onChange={(e) => set("model", e.target.value)} />
              </FormField>
              <FormField label="Year of manufacture" name="year" error={err("year")} aside={vis("year")}>
                <TextInput value={f.year} inputMode="numeric" maxLength={4} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} placeholder="2019" />
              </FormField>
              <FormField label="Condition" required={listing} group name="conditionId" error={err("conditionId")} aside={vis("condition")}>
                <Combobox
                  disabled={!canEdit}
                  value={f.conditionId}
                  options={masterOptions("condition", f.conditionId)}
                  onChange={(v) => set("conditionId", v)}
                  placeholder="Pick a condition"
                  autoAdvance
                />
              </FormField>
            </FormSection>

            <FormSection title="Specifications">
              <FormField label="Print width (metres)" name="printWidth" error={err("printWidth")} aside={vis("print_width")}>
                <TextInput value={f.printWidth} inputMode="decimal" onChange={(e) => set("printWidth", e.target.value.replace(/[^\d.]/g, ""))} placeholder="1.9" />
              </FormField>
              <FormField label="Number of print heads" name="headCount" error={err("headCount")} aside={vis("head_count")}>
                <TextInput value={f.headCount} inputMode="numeric" onChange={(e) => set("headCount", e.target.value.replace(/\D/g, ""))} />
              </FormField>
              <FormField label="Head model" name="headModel" aside={vis("head_model")}>
                <TextInput value={f.headModel} maxLength={100} onChange={(e) => set("headModel", e.target.value)} placeholder="Kyocera KJ4B" />
              </FormField>
              <FormField label="Ink type" group name="inkTypeId" aside={vis("ink_type")}>
                <Combobox
                  disabled={!canEdit}
                  value={f.inkTypeId}
                  options={masterOptions("ink_type", f.inkTypeId)}
                  onChange={(v) => set("inkTypeId", v)}
                  placeholder="Pick an ink type"
                  clearable
                  autoAdvance
                />
              </FormField>
              <FormField label="Hours run or usage" name="hoursRun" aside={vis("hours_run")}>
                <TextInput value={f.hoursRun} maxLength={100} onChange={(e) => set("hoursRun", e.target.value)} placeholder="About 6,000 hours" />
              </FormField>
              <div className="hidden md:block" />
              <FormField label="Key specifications" group span={3} name="specs" error={err("specs")} note="Name and value, like Print speed: 150 sq m per hour" aside={vis("specs")}>
                <div className="space-y-2">
                  {f.specs.map((x, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[160px] flex-1">
                        <TextInput
                          aria-label={`Specification ${i + 1} name`}
                          value={x.label}
                          maxLength={60}
                          placeholder="Name"
                          onChange={(e) => set("specs", f.specs.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))}
                        />
                      </div>
                      <div className="min-w-[200px] flex-[2]">
                        <TextInput
                          aria-label={`Specification ${i + 1} value`}
                          value={x.value}
                          maxLength={200}
                          placeholder="Value"
                          onChange={(e) => set("specs", f.specs.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))}
                        />
                      </div>
                      {canEdit && (
                        <button type="button" tabIndex={-1} className="text-[12.5px] font-medium text-ryg-red hover:underline" onClick={() => set("specs", f.specs.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button
                      type="button"
                      className="rounded-lg border border-dashed border-line px-3 py-2 text-[13px] font-semibold text-orange hover:border-orange"
                      onClick={() => {
                        set("specs", [...f.specs, { label: "", value: "" }]);
                        // Straight into the new line's name box.
                        window.setTimeout(() => {
                          const box = formRef.current?.querySelectorAll<HTMLInputElement>('[aria-label$=" name"][aria-label^="Specification"]');
                          box?.[box.length - 1]?.focus();
                        }, 30);
                      }}
                    >
                      + Add a specification
                    </button>
                  )}
                </div>
              </FormField>
              <FormField label="Description" span={3} name="description" aside={vis("description")}>
                <TextArea value={f.description} maxLength={5000} rows={4} onChange={(e) => set("description", e.target.value)} />
              </FormField>
            </FormSection>

            <FormSection title="Location and stock">
              <FormField
                label="Saved location"
                group
                name="location"
                note={locationOptions.length ? "Fills the city and state" : "None saved yet (Masters, Locations)"}
                aside={vis("location")}
              >
                <Combobox
                  value={locationOptions.some((o) => o.value === currentPlace) ? currentPlace : ""}
                  options={locationOptions}
                  onChange={(v) => {
                    const at = v.lastIndexOf(",");
                    patch(at > 0 ? { city: v.slice(0, at).trim(), state: v.slice(at + 1).trim() } : { city: v.trim() });
                  }}
                  placeholder={locationOptions.length ? "Pick a saved location" : "No saved locations"}
                  disabled={!canEdit || !locationOptions.length}
                  searchable
                  autoAdvance
                />
              </FormField>
              <FormField label="City" required={listing} name="city" error={err("city")} hint="Where a buyer can inspect it">
                <TextInput value={f.city} maxLength={80} onChange={(e) => set("city", e.target.value)} />
              </FormField>
              <FormField label="State" required={listing} name="state" error={err("state")}>
                <TextInput value={f.state} maxLength={80} onChange={(e) => set("state", e.target.value)} />
              </FormField>
              <FormField label="Quantity available" name="quantity" error={err("quantity")} aside={vis("quantity")}>
                <TextInput value={f.quantity} inputMode="numeric" onChange={(e) => set("quantity", e.target.value.replace(/\D/g, ""))} />
              </FormField>
            </FormSection>

            <FormSection title="Photos, video link and documents" cols={1}>
              <FormField label="Photos" required={listing} group name="photos" error={err("photos")} aside={vis("photos")}>
                <MediaList
                  kind="photo"
                  items={f.photos}
                  onChange={(v) => set("photos", v)}
                  folder={`machines/${machineId}`}
                  max={MAX_PHOTOS}
                  disabled={!canEdit}
                  onUploaded={(paths) => paths.forEach((p) => unsaved.current.add(p))}
                />
              </FormField>
              <FormField
                label="YouTube video link"
                name="youtubeUrl"
                error={err("youtubeUrl")}
                note={BUNNY_UPLOAD_ON ? "Shown on the website when there is no uploaded video below" : "Upload the video to YouTube as Unlisted, then paste its link here"}
                aside={vis("video")}
              >
                <TextInput
                  value={f.youtubeUrl}
                  maxLength={300}
                  inputMode="url"
                  onChange={(e) => set("youtubeUrl", e.target.value.trim())}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </FormField>
              {youtubeId(f.youtubeUrl) && (
                <a
                  href={`https://www.youtube.com/watch?v=${youtubeId(f.youtubeUrl)}`}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={-1}
                  className="-mt-1 flex w-fit items-center gap-3 rounded-xl border border-line bg-white p-2 pr-4 text-[13px] font-medium text-navy hover:border-orange"
                >
                  <img src={`https://i.ytimg.com/vi/${youtubeId(f.youtubeUrl)}/mqdefault.jpg`} alt="" className="h-14 w-24 rounded-lg object-cover" />
                  Open the video on YouTube
                </a>
              )}
              <FormField label="Documents" group name="documents" hint="Brochure or inspection report" aside={vis("documents")}>
                <MediaList
                  kind="document"
                  items={f.documents}
                  onChange={(v) => set("documents", v)}
                  folder={`machines/${machineId}`}
                  max={MAX_DOCS}
                  disabled={!canEdit}
                  onUploaded={(paths) => paths.forEach((p) => unsaved.current.add(p))}
                />
              </FormField>
            </FormSection>
          </Card>
        </fieldset>

        {/* Outside the fieldset: the video writes on its own, straight away, and is not part
            of what Save sends. */}
        {(BUNNY_UPLOAD_ON || video.id) && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-grey">Video upload (Bunny Stream)</h3>
            <span className="text-[11.5px] text-grey-2">If a machine has both, the website shows this one over the YouTube link</span>
          </div>
          <VideoPanel
            machineId={exists ? machineId : null}
            title={f.title}
            videoId={video.id}
            state={video.state}
            canEdit={canEdit}
            onRowChanged={onVideoRow}
          />
        </Card>
        )}

        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <Card className="space-y-6 p-5">
            <FormSection title="Seller and salesperson (never on the website)">
              <FormField label="Seller" required={listing} group name="seller" error={err("seller")} note="From the customer list, or type a new name" aside={vis("seller")}>
                <Combobox
                  disabled={!canEdit}
                  value={sellerValue}
                  options={sellerOptionsWithTyped}
                  onChange={(v) => {
                    if (!v) return patch({ sellerCode: "", sellerName: "" });
                    if (v.startsWith("t:")) return;
                    const p = s.sellers.find((x) => `p:${x.id}` === v);
                    if (p) patch({ sellerCode: p.code ?? "", sellerName: p.name });
                  }}
                  onCreate={(label) => {
                    const name = label.trim();
                    patch({ sellerCode: "", sellerName: name });
                    return `t:${name}`;
                  }}
                  createLabel={(q) => `Use "${q}" (not on the customer list)`}
                  placeholder={s.sellersLoading ? "Loading the customer list..." : "Search the customer list"}
                  searchable
                  wrapLabel
                  autoAdvance
                />
              </FormField>
              <FormField
                label="Salesperson"
                required={listing}
                group
                name="salesperson"
                error={err("salesperson") ?? (s.salespeopleError ? "The list of people could not be loaded" : undefined)}
                note="Gets the inquiry alerts for this machine"
                aside={vis("salesperson")}
              >
                <Combobox
                  disabled={!canEdit}
                  value={f.salespersonId}
                  options={personWithSnapshot}
                  onChange={(v) => {
                    if (!v) return patch({ salespersonId: "", salespersonName: "", salespersonEmail: "" });
                    const p = s.salespeople.find((x) => x.id === v);
                    if (p) patch({ salespersonId: p.id, salespersonName: p.name, salespersonEmail: p.email ?? "" });
                  }}
                  placeholder={s.salespeopleLoading ? "Loading people..." : "Pick a salesperson"}
                  searchable
                  autoAdvance
                />
              </FormField>
              <div className="hidden md:block" />
              <FormField label="Internal notes" span={3} name="internalNotes" aside={vis("internal_notes")}>
                <TextArea value={f.internalNotes} rows={3} onChange={(e) => set("internalNotes", e.target.value)} placeholder="For the team only" />
              </FormField>
            </FormSection>

            <FormSection title="On the website">
              <FormField label="Status" required group name="status" span={2} note="Active shows it. Inactive hides it at once. Sold keeps it on the website with a Sold ribbon.">
                <ControlRow>
                  <ChoiceButtons
                    options={[
                      { value: "active", label: "Active" },
                      { value: "inactive", label: "Inactive" },
                      { value: "sold", label: "Sold" },
                    ]}
                    value={f.status}
                    onChange={(v) => set("status", v as MachineStatus)}
                    disabled={!canEdit}
                    autoAdvance
                    ariaLabel="Status"
                  />
                </ControlRow>
              </FormField>
              <FormField label="Featured" group name="featured" note="Shown on the website's home page">
                <ControlRow>
                  <SettingToggle checked={f.featured} onChange={(v) => set("featured", v)} label={f.featured ? "Yes" : "No"} disabled={!canEdit} />
                </ControlRow>
              </FormField>
            </FormSection>
          </Card>
        </fieldset>

        {/* Right padding keeps Save clear of the hub's floating "Ask HR" button, which sits
            over the bottom-right corner of every page (design pass, 14-10-2026). */}
        {canEdit && (
          <div className="sticky bottom-0 z-10 rounded-xl bg-white/95 pb-3 pl-5 pr-5 backdrop-blur sm:pr-44">
            <FormActions
              left={
                problem ? (
                  <span className="font-medium text-ryg-red">{problem}</span>
                ) : saved && !dirty ? (
                  <span className="font-medium text-[#1E7B3C]">{saved}</span>
                ) : dirty ? (
                  <span className="text-grey-2">Unsaved changes</span>
                ) : null
              }
            >
              <Button type="submit" disabled={busy || !dirty}>
                {busy ? "Saving..." : exists ? "Save changes" : "Save machine"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (dirty && !window.confirm("Leave without saving? What you changed here will be lost.")) return;
                  navigate(`${B}/machines`);
                }}
              >
                {dirty ? "Cancel" : "Back to machines"}
              </Button>
            </FormActions>
          </div>
        )}
      </form>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this machine?"
        subtitle={record ? `${record.listingNo} · ${record.title}` : undefined}
        size="sm"
        footer={
          <FormActions>
            <Button onClick={() => void doDelete()} disabled={busy}>
              {busy ? "Deleting..." : "Delete"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep it
            </Button>
          </FormActions>
        }
      >
        <p className="text-[13.5px] text-grey">
          The machine, its photos and its documents are removed for good. To take it off the website but keep the record, mark it Inactive instead.
        </p>
      </Modal>
    </div>
  );
}
