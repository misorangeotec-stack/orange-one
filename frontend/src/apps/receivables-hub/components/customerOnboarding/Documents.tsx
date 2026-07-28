/**
 * The four KYC attachments — GST certificate, PAN card, cancelled cheque, MSME
 * certificate. All four are OPTIONAL by instruction; nothing here ever blocks a
 * submission.
 *
 * ⚠ PRIVATE BUCKET, SIGNED LINKS ONLY. These are PAN cards and cancelled
 *   cheques. `fms-customer-docs` is private and the storage policies scope each
 *   file to that request's raiser plus the back-office step owners. Opening one
 *   mints a fresh 10-minute signed URL PER CLICK — which is exactly why the
 *   opener is a <button> and not an <a href>. A URL baked at render time would
 *   be stale, or leaked, by the time anyone clicked it.
 *
 * ⚠ POPUP BLOCKERS. The window is opened SYNCHRONOUSLY on the click and its
 *   location set once the URL arrives. Calling window.open() after an await is
 *   treated as an unrequested popup and silently blocked in Safari and Firefox.
 *
 * ⚠ STORAGE DOES NOT CASCADE. Deleting a request row leaves its files behind
 *   forever with nothing pointing at them. removeCustomerDocs() must run FIRST —
 *   see MyRequests' draft delete.
 */
import { useRef, useState } from "react";
import { Eye, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { useToast } from "@hub/hooks/use-toast";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { MAX_DOC_BYTES } from "@hub/data/customerOnboarding/customerWrites";
import { DOC_SLOTS, type CustomerRequest, type DocSlot } from "@hub/lib/customerOnboarding/types";
import { cn } from "@hub/lib/utils";

/** What a browser can show inline, plus the scans people actually attach. */
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic";

export function DocLink({
  path, name, className,
}: { path: string; name?: string | null; className?: string }) {
  const s = useCustomerStore();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const open = () => {
    // Opened NOW, on the click, or the popup blocker eats it. See the header.
    const w = window.open("", "_blank", "noopener,noreferrer");
    setBusy(true);
    void s.writes
      .customerDocUrl(path)
      .then((url) => {
        if (w) w.location.href = url;
        else window.location.href = url; // popup blocked entirely — same tab
      })
      .catch((e: Error) => {
        w?.close();
        toast({ variant: "destructive", title: "Could not open the document", description: e.message });
      })
      .finally(() => setBusy(false));
  };

  return (
    <Button
      type="button" variant="ghost" size="sm" onClick={open} disabled={busy}
      className={cn("h-auto py-1 px-2 gap-1.5 text-xs font-normal", className)}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
      <span className="truncate max-w-[180px]">{name ?? "Open"}</span>
    </Button>
  );
}

function DocSlotRow({
  requestId, slot, label, path, name, disabled,
}: {
  requestId: string;
  slot: DocSlot;
  label: string;
  path: string | null;
  name: string | null;
  disabled?: boolean;
}) {
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) {
      toast({
        variant: "destructive",
        title: "That file is too large",
        description: `${file.name} is over 10 MB. A scan or a compressed photo will be well under it.`,
      });
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const up = await s.writes.uploadCustomerDoc(requestId, slot, file);
        await run(() => s.writes.setDocument(requestId, slot, up.path, up.name));
        toast({ title: `${label} attached` });
      } catch (e) {
        toast({ variant: "destructive", title: "Upload failed", description: (e as Error).message });
      } finally {
        setBusy(false);
        // Clear the input, or re-picking the SAME file fires no change event.
        if (inputRef.current) inputRef.current.value = "";
      }
    })();
  };

  const clear = () => {
    setBusy(true);
    void (async () => {
      try {
        // The row is cleared; the object stays until the request is deleted.
        // Keeping it costs pennies and means a mis-click is recoverable from the
        // bucket, which a hard delete here would not be.
        await run(() => s.writes.setDocument(requestId, slot, "", ""));
        toast({ title: `${label} removed` });
      } catch (e) {
        toast({ variant: "destructive", title: "Could not remove it", description: (e as Error).message });
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="rounded-md border p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className={cn("h-4 w-4 shrink-0", path ? "text-primary" : "text-muted-foreground")} />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{label}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {path ? (name ?? "Attached") : "Not provided"}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-center gap-1">
        {path && <DocLink path={path} name="View" />}
        {!disabled && (
          <Button
            type="button" variant="ghost" size="sm" disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="h-auto py-1 px-2 gap-1.5 text-xs font-normal"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {path ? "Replace" : "Attach"}
          </Button>
        )}
        {path && !disabled && (
          <Button
            type="button" variant="ghost" size="sm" disabled={busy} onClick={clear}
            className="h-auto py-1 px-2 gap-1.5 text-xs font-normal text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * All four slots.
 *
 * `requestId` is null only in the wizard before the first autosave has minted a
 * draft row — an upload needs a request to belong to. Rather than hiding the
 * section (which reads as "this form has no uploads"), it explains itself and
 * offers the save.
 */
export default function Documents({
  request, requestId, onNeedSave, disabled,
}: {
  /** The row, when it exists — supplies the current paths. */
  request: CustomerRequest | null;
  requestId: string | null;
  /** Called when the user asks to save so uploads can start. Wizard only. */
  onNeedSave?: () => void | Promise<unknown>;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);

  const pathFor = (slot: DocSlot): string | null =>
    !request ? null
    : slot === "gst" ? request.gstDocPath
    : slot === "pan" ? request.panDocPath
    : slot === "cheque" ? request.chequeDocPath
    : request.msmeDocPath;

  const nameFor = (slot: DocSlot): string | null =>
    !request ? null
    : slot === "gst" ? request.gstDocName
    : slot === "pan" ? request.panDocName
    : slot === "cheque" ? request.chequeDocName
    : request.msmeDocName;

  if (!requestId) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center">
        <Paperclip className="h-5 w-5 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">
          Documents attach to a saved request. Save this one and the four upload slots appear here.
        </p>
        {onNeedSave && (
          <Button
            type="button" variant="outline" size="sm" className="mt-3"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              // Awaited, not timed: this component unmounts as soon as the save
              // lands a request id (the slots replace it), and a setTimeout
              // firing into the gap is a state update on a dead component.
              void Promise.resolve(onNeedSave()).finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : "Save now"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {DOC_SLOTS.map((d) => (
        <DocSlotRow
          key={d.slot}
          requestId={requestId}
          slot={d.slot}
          label={d.label}
          path={pathFor(d.slot)}
          name={nameFor(d.slot)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
