import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { TextInput } from "@/shared/components/ui/Form";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { useExitStore } from "../../store";
import { exitDocUrl, uploadClearanceDoc } from "../../data/exitWrites";
import type { ClearanceCheck, ExitCase } from "../../types";

/** Open the private file in a new tab. Nothing in this bucket is ever public. */
async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * ONE clearance row.
 *
 * Ticking it stamps the date SERVER-SIDE — nobody types a completion date. Evidence is
 * a file or, where the item allows one, a link; an item flagged `requires_file` cannot
 * be ticked without one (the RPC refuses, and so does this button). If it is still
 * pending, its owner writes the reason instead — the sheet's "Reason (If Pending)". And
 * if it genuinely does not apply — the sheet's "Training material *(if applicable)*" —
 * it is marked N/A **with a reason**, which settles it exactly as a tick does.
 *
 * The controls are dead unless `canTickCheck(check)`: a row belongs to ONE department,
 * and the IT person has no business ticking Payroll's box. The RPC re-checks; this is
 * courtesy, not security.
 */
function CheckRow({ case: c, check, readOnly }: { case: ExitCase; check: ClearanceCheck; readOnly: boolean }) {
  const s = useExitStore();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState(check.linkUrl ?? "");
  const [reason, setReason] = useState(check.pendingReason ?? "");
  const [naReason, setNaReason] = useState(check.naReason ?? "");
  const [mode, setMode] = useState<"closed" | "work" | "na">("closed");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mayAct = !readOnly && s.canTickCheck(check);
  const settled = check.done || check.notApplicable;

  // "A file OR a link" has to actually mean it — the same bug 20260712190000 fixed in
  // HR. An item that requires evidence but does NOT allow a link still demands a real
  // upload: that is the whole point of the flag. Some documents must be held, not
  // pointed at.
  const hasLink = check.allowsLink && (!!link.trim() || !!check.linkUrl);
  const needsFile = check.requiresFile && !check.filePath && !file && !hasLink;

  const owners = s.checkOwnerIds(c, check).map((id) => s.profileById(id)?.name ?? "Unknown");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Upload first, so a tick can never succeed against a file that is not there. */
  const evidence = async () => {
    if (!file) return { filePath: check.filePath, fileName: check.fileName };
    const up = await uploadClearanceDoc(c.id, check.itemKey, file);
    return { filePath: up.path, fileName: up.name };
  };

  const markDone = () =>
    run(async () => {
      const ev = await evidence();
      await s.toggleClearanceCheck(check.id, true, { ...ev, linkUrl: link.trim() || null });
      setFile(null);
      setMode("closed");
    });

  const savePending = () =>
    run(async () => {
      const ev = await evidence();
      await s.toggleClearanceCheck(check.id, false, {
        ...ev,
        linkUrl: link.trim() || null,
        pendingReason: reason.trim() || null,
      });
      setFile(null);
      setMode("closed");
    });

  const markNa = () =>
    run(async () => {
      await s.setClearanceNa(check.id, naReason.trim());
      setMode("closed");
    });

  /** Undo — and, since it returns the row to outstanding, the way back from N/A too. */
  const undo = () => run(() => s.toggleClearanceCheck(check.id, false, {}));

  const onBoxClick = () => {
    if (!mayAct) return;
    if (settled) return void undo();
    if (check.requiresFile || check.allowsLink) return setMode("work");
    void markDone();
  };

  const attached = check.filePath || check.linkUrl;

  return (
    <li
      className={`rounded-xl border transition ${
        check.done
          ? "border-ryg-green/30 bg-[#E9F7EF]/40"
          : check.notApplicable
            ? "border-line bg-page"
            : mode !== "closed"
              ? "border-orange/40 bg-white"
              : "border-line bg-white hover:border-orange/30"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBoxClick}
          disabled={!mayAct || busy}
          aria-label={check.done ? `Undo ${check.name}` : `Mark ${check.name} done`}
          className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border text-[11px] font-bold transition ${
            check.done
              ? "border-ryg-green bg-ryg-green text-white"
              : check.notApplicable
                ? "border-grey-2/60 bg-line text-grey"
                : "border-grey-2/60 text-transparent hover:border-orange hover:bg-orange/5"
          } ${mayAct ? "cursor-pointer" : "cursor-default"}`}
        >
          {check.notApplicable ? "–" : "✓"}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-[13.5px] font-semibold ${settled ? "text-grey line-through" : "text-navy"}`}
            >
              {check.name}
            </span>
            {!settled && check.requiresFile && (
              <span className="rounded-full bg-page px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey">
                {check.allowsLink ? "file or link" : "file required"}
              </span>
            )}
            {/* The auto-tick is LIVE (M4): HR's signature on the asset return, and HR's
                confirmation of the handover, tick these rows themselves — with no file
                demanded, because the evidence is the sign-off. The badge says so BEFORE
                it happens so nobody signs twice for the same thing and then wonders
                which one counted. Once it fires, the row shows its ordinary "Done …"
                line: it was ticked by HR, and `done_by` says exactly that. */}
            {!settled && check.satisfiedByStep && (
              <span className="rounded-full bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow">
                auto-ticked by {check.satisfiedByStep.replace(/_/g, " ")}
              </span>
            )}
            {!settled && check.pendingReason && (
              <span className="rounded-full bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow">
                pending
              </span>
            )}
            {check.notApplicable && (
              <span className="rounded-full bg-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey">
                not applicable
              </span>
            )}
          </div>

          {check.description && <p className="mt-0.5 text-[12px] leading-snug text-grey">{check.description}</p>}

          <p className="mt-1 text-[12px] text-grey-2">
            <span className="text-grey">Owner — </span>
            {owners.length ? owners.join(", ") : "nobody assigned (Setup → Masters)"}
          </p>

          {check.done && (
            <p className="mt-1 text-[12px] text-grey">
              Done {formatDateTimeDMY(check.doneAt)}
              {check.doneBy && ` · ${s.profileById(check.doneBy)?.name ?? "Unknown"}`}
            </p>
          )}
          {check.notApplicable && check.naReason && (
            <p className="mt-1 text-[12px] text-navy">
              <span className="text-grey">Not applicable — </span>
              {check.naReason}
            </p>
          )}
          {!settled && check.pendingReason && (
            <p className="mt-1 text-[12px] text-navy">
              <span className="text-grey">Pending — </span>
              {check.pendingReason}
            </p>
          )}

          {attached && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {check.filePath && (
                <button
                  type="button"
                  onClick={() => void openDoc(check.filePath!)}
                  className="text-[12px] font-semibold text-orange hover:underline"
                >
                  {check.fileName ?? "Open file"} →
                </button>
              )}
              {check.linkUrl && (
                <a
                  href={check.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-[12px] font-semibold text-orange hover:underline"
                >
                  Link →
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {!settled && (
            <span className="text-[12px] text-grey">
              Due <DueCell dueIso={s.checkDueIso(c, check)} />
            </span>
          )}
          {mayAct && !settled && (
            <button
              type="button"
              onClick={() => setMode((m) => (m === "work" ? "closed" : "work"))}
              className="text-[12px] font-semibold text-grey-2 hover:text-orange"
            >
              {mode === "work" ? "Close" : attached ? "Edit" : "Attach"}
            </button>
          )}
          {mayAct && settled && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy}
              className="text-[12px] font-semibold text-grey-2 hover:text-ryg-red"
            >
              Undo
            </button>
          )}
        </div>
      </div>

      {/* ---- The form, only for the row being worked on. ---- */}
      {mayAct && !settled && mode === "work" && (
        <div className="grid gap-3 border-t border-line px-4 py-3.5 pl-[46px] sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              {/* Only say "required" when a file really is the ONLY way through. */}
              Attach a file{check.requiresFile && !check.allowsLink ? " (required)" : ""}
            </span>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
            />
          </label>
          {check.allowsLink && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-navy">Or paste a link</span>
              <TextInput
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://drive.google.com/…"
              />
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              Still pending? Say why (kept until it's done)
            </span>
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. the laptop is with the courier"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button size="sm" onClick={markDone} disabled={busy || needsFile}>
              {busy ? "Saving…" : "Mark done"}
            </Button>
            <Button size="sm" variant="ghost" onClick={savePending} disabled={busy}>
              Save as pending
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("na")} disabled={busy}>
              Not applicable
            </Button>
            {needsFile && (
              <span className="text-[12px] text-grey">
                {check.allowsLink
                  ? "Attach a file or paste a link before ticking this."
                  : "This item needs a file before it can be ticked."}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---- N/A: the one control whose whole job is to make work disappear, so it
              must say why. A silent N/A is indistinguishable from a row nobody did. ---- */}
      {mayAct && !settled && mode === "na" && (
        <div className="border-t border-line px-4 py-3.5 pl-[46px]">
          <span className="mb-1.5 block text-[13px] font-medium text-navy">
            Why does this not apply? (required)
          </span>
          <TextInput
            value={naReason}
            onChange={(e) => setNaReason(e.target.value)}
            placeholder="e.g. no training material was ever issued"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={markNa} disabled={busy || !naReason.trim()}>
              {busy ? "Saving…" : "Mark not applicable"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("work")} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}

      {err && <p className="px-4 pb-3 pl-[46px] text-[12.5px] text-ryg-red">{err}</p>}
    </li>
  );
}

/**
 * The departmental clearance checklist for one case — **grouped by department**,
 * because that is how the work is actually divided: eight departments, eight owners,
 * eight deadlines, and nobody reads the other seven.
 *
 * The list is MATERIALISED when the last working day is confirmed, and SNAPSHOTTED:
 * renaming or deactivating a master item next quarter cannot rewrite what this leaver
 * was asked for. Each row carries its OWN due date — `lwd` + its signed offset, which
 * is normally NEGATIVE, i.e. due BEFORE the person walks out (you cannot chase a laptop
 * afterwards).
 *
 * Completion of the step is the DATABASE's decision: once every row is done or
 * not-applicable, `fms_exit_try_complete_clearance` stamps `clearance_completed_at`.
 * This screen never decides it.
 */
export default function ClearancePanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const checks = s.checksFor(c.id);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  const outstanding = checks.filter(s.isCheckOutstanding).length;

  // The eight departments, in master order (sort_order), each with its own rows.
  const groups: { label: string; rows: typeof checks }[] = [];
  for (const k of checks) {
    const g = groups.find((x) => x.label === k.departmentLabel);
    if (g) g.rows.push(k);
    else groups.push({ label: k.departmentLabel, rows: [k] });
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Departmental clearance</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            {c.lwd
              ? "Each department signs off its own row, by its own deadline. The exit clears itself when the last one is settled."
              : "The checklist opens when the last working day is confirmed — every deadline is measured from it."}
          </p>
        </div>
        {checks.length > 0 && (
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] text-grey-2">
              {checks.length - outstanding} of {checks.length} settled
            </span>
            {c.clearanceCompletedAt && (
              <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
                Cleared
              </span>
            )}
          </div>
        )}
      </div>

      {checks.length === 0 ? (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
          {c.lwd
            ? "This case has no clearance rows — every checklist item was inactive when the last working day was confirmed. It cannot clear itself; add the items in Masters and ask an admin to re-seed it."
            : "Nothing yet. Confirming the last working day generates this checklist from the items in Masters."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <SectionHeading>{g.label}</SectionHeading>
              <ul className="mt-2 space-y-2.5">
                {g.rows.map((k) => (
                  <CheckRow key={k.id} case={c} check={k} readOnly={closed} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
