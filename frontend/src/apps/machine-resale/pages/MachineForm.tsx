import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import SettingToggle from "@/shared/components/ui/SettingToggle";
import { FieldHeading, FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { removeMedia } from "../data/client";
import {
  deleteMachine,
  insertMachine,
  StaleMachineError,
  syncMachineMedia,
  updateMachine,
  type MachineInput,
  type MediaInput,
} from "../data/mrWrites";
import MediaList from "../components/MediaList";
import { PageHeader, StatusPill } from "../components/Pills";
import VideoPanel from "../components/VideoPanel";
import VisibilityControl from "../components/VisibilityControl";
import { dmyTime } from "../lib/format";
import { B } from "../nav";
import { useMrStore } from "../store";
import type { Machine, MachineStatus, SpecPair, VideoState } from "../types";

const MAX_PHOTOS = 15;
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
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canEdit = s.canEdit;

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
  const sellerOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = s.sellers.map((p) => ({
      value: `p:${p.id}`,
      label: p.name,
      sublabel: p.code ? `Code ${p.code}` : undefined,
    }));
    return opts;
  }, [s.sellers]);
  const sellerValue = (() => {
    if (!f.sellerName) return "";
    const hit = s.sellers.find((p) => (f.sellerCode ? p.code === f.sellerCode : !p.code && p.name === f.sellerName));
    return hit ? `p:${hit.id}` : `t:${f.sellerName}`;
  })();
  const sellerOptionsWithTyped =
    sellerValue.startsWith("t:")
      ? [{ value: sellerValue, label: f.sellerName, sublabel: f.sellerCode ? `Code ${f.sellerCode}` : "Typed in, not on the customer list" }, ...sellerOptions]
      : sellerOptions;

  // Salesperson: hub users who can open Machine Resale.
  const personOptions: ComboOption[] = s.salespeople.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined }));
  const personWithSnapshot =
    f.salespersonId && !s.salespeople.some((p) => p.id === f.salespersonId)
      ? [{ value: f.salespersonId, label: f.salespersonName || "Unknown", sublabel: "No longer has Machine Resale access" }, ...personOptions]
      : personOptions;

  // ---- validation --------------------------------------------------------
  const validate = (): string[] => {
    const e: string[] = [];
    const t = f.title.trim();
    if (t.length < 3) e.push("Give the machine a title of at least 3 characters.");
    if (t.length > 150) e.push("Keep the title to 150 characters.");
    if (!f.categoryId) e.push("Pick a category.");
    if (!f.subcategoryId) e.push("Pick a print head.");
    if (f.year && (!/^\d{4}$/.test(f.year) || +f.year < 1970 || +f.year > 2100)) e.push("Year of manufacture must be a year like 2019.");
    if (f.printWidth && !(Number(f.printWidth) > 0 && Number(f.printWidth) < 1000)) e.push("Print width must be a number of metres, like 1.9.");
    if (f.headCount && !(/^\d+$/.test(f.headCount) && +f.headCount > 0)) e.push("Number of print heads must be a whole number.");
    if (!/^\d+$/.test(f.quantity) || +f.quantity < 1) e.push("Quantity must be 1 or more.");
    if (f.specs.some((x) => !x.label.trim() !== !x.value.trim())) e.push("Each key specification needs both a name and a value.");
    if (f.status !== "inactive") {
      const missing: string[] = [];
      if (!f.printerBrandId) missing.push("printer brand");
      if (!f.conditionId) missing.push("condition");
      if (!f.city.trim()) missing.push("city");
      if (!f.state.trim()) missing.push("state");
      if (!f.sellerName.trim()) missing.push("seller");
      if (!f.salespersonId) missing.push("salesperson");
      if (!f.photos.length) missing.push("at least one photo");
      if (missing.length) {
        e.push(`To mark it ${f.status === "active" ? "Active" : "Sold"} it still needs: ${missing.join(", ")}.`);
      }
    }
    return e;
  };

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
  });

  const save = async () => {
    const e = validate();
    setErrors(e);
    setSaved(null);
    if (e.length) return;
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
      setSaved("Saved.");
    } catch (err) {
      setErrors([err instanceof StaleMachineError || err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!record) return;
    if (s.inquiries.some((i) => i.machineId === record.id)) {
      setConfirmDelete(false);
      setErrors(["This machine has inquiries, so it cannot be deleted. Mark it Inactive or Sold instead."]);
      return;
    }
    setBusy(true);
    try {
      await deleteMachine(record.id, [...record.photos, ...record.documents].map((m) => m.storagePath));
      unsaved.current.clear();
      await s.refresh();
      navigate(`${B}/machines`, { replace: true });
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
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
    <div className="space-y-5 pb-24">
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
      </PageHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <Section title="The machine">
            <Row label="Machine title" required vis={vis("title")}>
              <TextInput value={f.title} maxLength={150} onChange={(e) => set("title", e.target.value)} placeholder="Epson I3200 sublimation printer, 1.9 m" />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Category (printer type)" required vis={vis("category")} combo>
                <Combobox
                  disabled={!canEdit}
                  value={f.categoryId}
                  options={categoryOptions}
                  onChange={(v) => patch({ categoryId: v, subcategoryId: v === f.categoryId ? f.subcategoryId : "" })}
                  placeholder="Pick a category"
                  searchable
                  autoAdvance
                />
              </Row>
              <Row label="Print head" required vis={vis("subcategory")} combo>
                <Combobox
                  value={f.subcategoryId}
                  options={headOptions}
                  onChange={(v) => set("subcategoryId", v)}
                  placeholder={f.categoryId ? "Pick a print head" : "Pick the category first"}
                  disabled={!f.categoryId || !canEdit}
                  searchable
                  autoAdvance
                />
              </Row>
              <Row label="Printer brand" required={f.status !== "inactive"} vis={vis("printer_brand")} combo>
                <Combobox
                  disabled={!canEdit}
                  value={f.printerBrandId}
                  options={masterOptions("printer_brand", f.printerBrandId)}
                  onChange={(v) => set("printerBrandId", v)}
                  placeholder="Pick a brand"
                  searchable
                  clearable
                  autoAdvance
                />
              </Row>
              <Row label="Model" vis={vis("model")}>
                <TextInput value={f.model} maxLength={100} onChange={(e) => set("model", e.target.value)} />
              </Row>
              <Row label="Year of manufacture" vis={vis("year")}>
                <TextInput value={f.year} inputMode="numeric" maxLength={4} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} placeholder="2019" />
              </Row>
              <Row label="Condition" required={f.status !== "inactive"} vis={vis("condition")} combo>
                <Combobox
                  disabled={!canEdit}
                  value={f.conditionId}
                  options={masterOptions("condition", f.conditionId)}
                  onChange={(v) => set("conditionId", v)}
                  placeholder="Pick a condition"
                  clearable
                  autoAdvance
                />
              </Row>
            </div>
          </Section>

          <Section title="Specifications">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Print width (metres)" vis={vis("print_width")}>
                <TextInput value={f.printWidth} inputMode="decimal" onChange={(e) => set("printWidth", e.target.value.replace(/[^\d.]/g, ""))} placeholder="1.9" />
              </Row>
              <Row label="Number of print heads" vis={vis("head_count")}>
                <TextInput value={f.headCount} inputMode="numeric" onChange={(e) => set("headCount", e.target.value.replace(/\D/g, ""))} />
              </Row>
              <Row label="Head model" vis={vis("head_model")}>
                <TextInput value={f.headModel} maxLength={100} onChange={(e) => set("headModel", e.target.value)} placeholder="Kyocera KJ4B" />
              </Row>
              <Row label="Ink type" vis={vis("ink_type")} combo>
                <Combobox
                  disabled={!canEdit}
                  value={f.inkTypeId}
                  options={masterOptions("ink_type", f.inkTypeId)}
                  onChange={(v) => set("inkTypeId", v)}
                  placeholder="Pick an ink type"
                  clearable
                  autoAdvance
                />
              </Row>
              <Row label="Hours run or usage" vis={vis("hours_run")}>
                <TextInput value={f.hoursRun} maxLength={100} onChange={(e) => set("hoursRun", e.target.value)} placeholder="About 6,000 hours" />
              </Row>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <FieldHeading label="Key specifications" hint="Name and value pairs, like Print speed: 150 sq m per hour" />
                {vis("specs")}
              </div>
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
                      <button type="button" className="text-[12.5px] font-medium text-ryg-red hover:underline" onClick={() => set("specs", f.specs.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button type="button" className="text-[13px] font-semibold text-orange hover:underline" onClick={() => set("specs", [...f.specs, { label: "", value: "" }])}>
                    + Add a specification
                  </button>
                )}
              </div>
            </div>
            <Row label="Description" vis={vis("description")}>
              <TextArea value={f.description} maxLength={5000} rows={5} onChange={(e) => set("description", e.target.value)} />
            </Row>
          </Section>

          <Section title="Location and stock">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <FieldHeading label="Location" required={f.status !== "inactive"} hint="Where a buyer can inspect it. The website shows the city and state only." />
              {vis("location")}
            </div>
            {locationOptions.length > 0 && (
              <div className="max-w-md">
                <Combobox
                  disabled={!canEdit}
                  value={locationOptions.some((o) => o.value === currentPlace) ? currentPlace : ""}
                  options={locationOptions}
                  onChange={(v) => {
                    const at = v.lastIndexOf(",");
                    patch(at > 0 ? { city: v.slice(0, at).trim(), state: v.slice(at + 1).trim() } : { city: v.trim() });
                  }}
                  placeholder="Pick a saved location, or type the city and state below"
                  searchable
                  autoAdvance
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldLabel label="City">
                <TextInput value={f.city} maxLength={80} onChange={(e) => set("city", e.target.value)} />
              </FieldLabel>
              <FieldLabel label="State">
                <TextInput value={f.state} maxLength={80} onChange={(e) => set("state", e.target.value)} />
              </FieldLabel>
              <Row label="Quantity available" vis={vis("quantity")}>
                <TextInput value={f.quantity} inputMode="numeric" onChange={(e) => set("quantity", e.target.value.replace(/\D/g, ""))} />
              </Row>
            </div>
          </Section>

          <Section title="Photos and documents">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldHeading label="Photos" required={f.status !== "inactive"} hint="At least one before it goes Active" />
              {vis("photos")}
            </div>
            <MediaList
              kind="photo"
              items={f.photos}
              onChange={(v) => set("photos", v)}
              folder={`machines/${machineId}`}
              max={MAX_PHOTOS}
              disabled={!canEdit}
              onUploaded={(paths) => paths.forEach((p) => unsaved.current.add(p))}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <FieldHeading label="Documents" hint="Brochure or inspection report, PDF" />
              {vis("documents")}
            </div>
            <MediaList
              kind="document"
              items={f.documents}
              onChange={(v) => set("documents", v)}
              folder={`machines/${machineId}`}
              max={MAX_DOCS}
              disabled={!canEdit}
              onUploaded={(paths) => paths.forEach((p) => unsaved.current.add(p))}
            />
          </Section>
        </fieldset>

        {/* Outside the fieldset: the video writes on its own, straight away, and is
            not part of what Save sends. */}
        <Section title="Video" right={vis("video")}>
          <VideoPanel
            machineId={exists ? machineId : null}
            title={f.title}
            videoId={video.id}
            state={video.state}
            canEdit={canEdit}
            onRowChanged={onVideoRow}
          />
        </Section>

        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <Section title="Seller and salesperson" note="Never shown on the website.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Seller" required={f.status !== "inactive"} vis={vis("seller")} combo hint="From the customer list, or type a new name">
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
                  clearable
                  wrapLabel
                  autoAdvance
                />
              </Row>
              <Row label="Salesperson" required={f.status !== "inactive"} vis={vis("salesperson")} combo hint="Gets the inquiry alerts for this machine">
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
                  clearable
                  autoAdvance
                />
              </Row>
            </div>
            {s.salespeopleError ? (
              <p className="text-[12.5px] text-ryg-red">
                The salesperson list could not be loaded: {s.salespeopleError instanceof Error ? s.salespeopleError.message : String(s.salespeopleError)}
              </p>
            ) : null}
            <Row label="Internal notes" vis={vis("internal_notes")}>
              <TextArea value={f.internalNotes} rows={3} onChange={(e) => set("internalNotes", e.target.value)} placeholder="For the team only" />
            </Row>
          </Section>

          <Section title="On the website">
            <div>
              <FieldHeading label="Status" required hint="Active shows it. Inactive hides it at once. Sold keeps it on the website with a Sold ribbon and no inquiry buttons." />
              <ChoiceButtons
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                  { value: "sold", label: "Sold" },
                ]}
                value={f.status}
                onChange={(v) => set("status", v as MachineStatus)}
                autoAdvance
                ariaLabel="Status"
              />
            </div>
            <SettingToggle
              checked={f.featured}
              onChange={(v) => set("featured", v)}
              label="Featured"
              hint="Shown on the website's home page."
              disabled={!canEdit}
            />
          </Section>
        </fieldset>

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-1 py-3 backdrop-blur">
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
            {record && (
              <button type="button" disabled={busy} className="ml-auto text-[13px] font-medium text-ryg-red hover:underline" onClick={() => setConfirmDelete(true)}>
                Delete machine
              </button>
            )}
            {saved && !dirty && <span className="text-[13px] font-medium text-[#1E7B3C]">{saved}</span>}
          </div>
        )}
        {errors.length > 0 && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FFF4F4] px-4 py-3 text-[13px] text-ryg-red">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep it
            </Button>
            <Button onClick={() => void doDelete()} disabled={busy}>
              {busy ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-grey">
          The machine, its photos and its documents are removed for good. To take it off the website but keep the record, mark it Inactive instead.
        </p>
      </Modal>
    </div>
  );
}

function Section({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold text-navy">
          {title}
          {note && <span className="ml-2 text-[12.5px] font-normal text-grey-2">{note}</span>}
        </h2>
        {right}
      </div>
      {children}
    </Card>
  );
}

/**
 * One field: its label, and the website switch BESIDE the label rather than inside
 * it. For a Combobox (`combo`) the heading is a plain div: a <label> around the
 * picker's buttons would press the first one when the label text is clicked.
 */
function Row({
  label,
  required,
  hint,
  vis,
  combo,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  vis: ReactNode;
  combo?: boolean;
  children: ReactNode;
}) {
  if (combo) {
    return (
      <div>
        <div className="flex items-baseline gap-2">
          <div className="min-w-0 grow">
            <FieldHeading label={label} required={required} hint={hint} />
          </div>
          {vis}
        </div>
        {children}
      </div>
    );
  }
  // The switch is laid over the label's row, but is a sibling of the <label>, so a
  // click on the field's name still only focuses its input.
  return (
    <div className="relative">
      <div className="absolute right-0 top-0 z-[1]">{vis}</div>
      <FieldLabel label={label} required={required} hint={hint}>
        {children}
      </FieldLabel>
    </div>
  );
}
