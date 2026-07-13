import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { useHrStore } from "../../store";
import { hrDocUrl, uploadOnboardingDoc } from "../../data/hrWrites";
import { inr } from "../../lib/format";
import type { Onboarding, OnboardingCheck, OfferStatus } from "../../types";

const OFFER_LABEL: Record<OfferStatus, string> = {
  pending: "Awaiting the candidate's answer",
  accepted: "Offer accepted",
  declined: "Offer declined",
  no_show: "Did not join",
};

const OFFER_CLASS: Record<OfferStatus, string> = {
  pending: "bg-[#FFF7E6] text-yellow",
  accepted: "bg-[#E9F7EF] text-ryg-green",
  declined: "bg-[#FDECEC] text-ryg-red",
  no_show: "bg-[#FDECEC] text-ryg-red",
};

/** Open the private file in a new tab. Nothing in this bucket is ever public. */
async function openDoc(path: string) {
  const url = await hrDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * One checklist row.
 *
 * Ticking it stamps the date server-side — HR never types one. Every item takes a
 * file, a Drive link, or both; an item flagged `requires_file` cannot be ticked
 * without one (the RPC refuses, and so does this button). If it is still pending,
 * HR writes the reason instead — the sheet's "Reason (If Pending)" column.
 */
function CheckRow({
  onboarding,
  check,
  readOnly,
}: {
  onboarding: Onboarding;
  check: OnboardingCheck;
  readOnly: boolean;
}) {
  const s = useHrStore();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState(check.linkUrl ?? "");
  const [reason, setReason] = useState(check.pendingReason ?? "");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * "Attach a file … OR paste a Drive link" — so a link has to actually count. It didn't:
   * this used to test the file alone, which made the offer of a link a lie and left HR
   * unable to tick an item whose document already lives in Drive.
   *
   * An item that requires evidence but does NOT allow a link still demands a real
   * upload — that is the whole point of that flag: some documents must be held, not
   * pointed at. The database enforces the same rule; this only decides when to grey
   * the button.
   */
  const hasLink = check.allowsLink && (!!link.trim() || !!check.linkUrl);
  const needsFile = check.requiresFile && !check.filePath && !file && !hasLink;

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

  const markDone = () =>
    run(async () => {
      // Upload first, so the tick can never succeed against a file that isn't there.
      let filePath = check.filePath;
      let fileName = check.fileName;
      if (file) {
        const up = await uploadOnboardingDoc(onboarding.id, check.itemKey, file);
        filePath = up.path;
        fileName = up.name;
      }
      await s.toggleOnboardingCheck(check.id, true, {
        filePath,
        fileName,
        linkUrl: link.trim() || null,
      });
      setFile(null);
      setExpanded(false);
    });

  const savePending = () =>
    run(async () => {
      let filePath = check.filePath;
      let fileName = check.fileName;
      if (file) {
        const up = await uploadOnboardingDoc(onboarding.id, check.itemKey, file);
        filePath = up.path;
        fileName = up.name;
      }
      await s.toggleOnboardingCheck(check.id, false, {
        filePath,
        fileName,
        linkUrl: link.trim() || null,
        pendingReason: reason.trim() || null,
      });
      setFile(null);
      setExpanded(false);
    });

  const undo = () => run(() => s.toggleOnboardingCheck(check.id, false, {}));

  /**
   * Clicking the box does the obvious thing:
   *   • nothing to attach          → tick it, one click, done
   *   • evidence needed or wanted  → open the panel so you can attach it
   * Six always-open forms is what made this a wall of controls; the work belongs to one
   * item at a time, so only one item shows its form.
   */
  const onBoxClick = () => {
    if (check.done) return void undo();
    if (needsFile || check.allowsLink || check.requiresFile) return setExpanded(true);
    void markDone();
  };

  const evidence = check.filePath || check.linkUrl;

  return (
    <li
      className={`rounded-xl border transition ${
        check.done
          ? "border-ryg-green/30 bg-[#E9F7EF]/40"
          : expanded
            ? "border-orange/40 bg-white"
            : "border-line bg-white hover:border-orange/30"
      }`}
    >
      {/* ---- The row itself: one line of meaning, always. ---- */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBoxClick}
          disabled={readOnly || busy}
          aria-label={check.done ? `Undo ${check.name}` : `Mark ${check.name} done`}
          className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border text-[11px] font-bold transition ${
            check.done
              ? "border-ryg-green bg-ryg-green text-white"
              : "border-grey-2/60 text-transparent hover:border-orange hover:bg-orange/5"
          } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
        >
          ✓
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-[13.5px] font-semibold ${check.done ? "text-grey line-through" : "text-navy"}`}
            >
              {check.name}
            </span>
            {!check.done && check.requiresFile && (
              <span className="rounded-full bg-page px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey">
                {check.allowsLink ? "file or link" : "file required"}
              </span>
            )}
            {!check.done && check.pendingReason && (
              <span className="rounded-full bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow">
                pending
              </span>
            )}
          </div>

          {/* What this step is actually FOR. */}
          {check.description && <p className="mt-0.5 text-[12px] leading-snug text-grey">{check.description}</p>}

          {check.done && (
            <p className="mt-1 text-[12px] text-grey">
              Done {formatDateTimeDMY(check.doneAt)}
              {check.doneBy && ` · ${s.profileById(check.doneBy)?.name ?? "Unknown"}`}
            </p>
          )}
          {!check.done && check.pendingReason && (
            <p className="mt-1 text-[12px] text-navy">
              <span className="text-grey">Pending — </span>
              {check.pendingReason}
            </p>
          )}

          {evidence && (
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
                  Drive link →
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[12px] text-grey">
            {check.done ? null : (
              <>
                Due <DueCell dueIso={s.checkDueIso(onboarding, check)} />
              </>
            )}
          </span>
          {!readOnly && !check.done && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] font-semibold text-grey-2 hover:text-orange"
            >
              {expanded ? "Close" : evidence ? "Edit" : "Attach"}
            </button>
          )}
          {!readOnly && check.done && (
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

      {/* ---- The form, only for the item being worked on. ---- */}
      {!readOnly && !check.done && expanded && (
        <div className="grid gap-3 border-t border-line px-4 py-3.5 pl-[46px] sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              {/* Only say "required" when a file really is the ONLY way through. If a Drive
                  link would also do, saying "required" here sends HR hunting for a file
                  they don't need. */}
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
              <span className="mb-1.5 block text-[13px] font-medium text-navy">Or paste a Drive link</span>
              <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" />
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              Still pending? Say why (kept until it's done)
            </span>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. waiting on the police report" />
          </label>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button size="sm" onClick={markDone} disabled={busy || needsFile}>
              {busy ? "Saving…" : "Mark done"}
            </Button>
            <Button size="sm" variant="ghost" onClick={savePending} disabled={busy}>
              Save as pending
            </Button>
            {needsFile && (
              <span className="text-[12px] text-grey">
                {check.allowsLink
                  ? "Attach a file or paste a Drive link before ticking this."
                  : "This item needs a file before it can be ticked."}
              </span>
            )}
          </div>
        </div>
      )}

      {!readOnly && check.done && (
        <div className="mt-2 pl-6">
          <Button size="sm" variant="ghost" onClick={undo} disabled={busy}>
            Untick
          </Button>
        </div>
      )}

      {err && <p className="mt-2 pl-6 text-[12.5px] text-ryg-red">{err}</p>}
    </li>
  );
}

/**
 * The onboarding of one finalized candidate.
 *
 * Three things happen here, in this order:
 *   1. HR enters the JOINING DATE — that is what unlocks the checklist, because
 *      every item's due date is measured from it.
 *   2. HR records the OFFER OUTCOME. Declined / Did not join hands the seat back to
 *      the requisition, which reopens — that is decided server-side, under a lock.
 *   3. HR works the checklist. When the last item is ticked and the offer was
 *      accepted, the person has JOINED: the onboarding completes, and if that was
 *      the last seat the requisition closes itself.
 */
export default function OnboardingPanel({
  onboarding,
  open,
  onClose,
}: {
  onboarding: Onboarding;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const o = s.onboardingById(onboarding.id) ?? onboarding;
  const c = s.candidateById(o.candidateId);
  const r = s.requisitionById(o.requisitionId);
  const checks = s.checksFor(o.id);
  const mayAct = s.canActOnOnboarding(o);

  const [joiningDate, setJoiningDate] = useState(o.joiningDate ?? todayIso());
  const [empCode, setEmpCode] = useState(o.employeeCode ?? "");
  const [offer, setOffer] = useState<"accepted" | "declined" | "no_show">("accepted");
  const [offerReason, setOfferReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dropped = o.offerStatus === "declined" || o.offerStatus === "no_show";
  const done = !!o.completedAt;
  const readOnly = !mayAct || dropped || done;
  const ticked = checks.filter((k) => k.done).length;

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

  const offerChoices: Array<{ key: "accepted" | "declined" | "no_show"; label: string; hint: string }> = [
    { key: "accepted", label: "Offer accepted", hint: "Carry on with the checklist" },
    { key: "declined", label: "Offer declined", hint: "The seat reopens on the requisition" },
    { key: "no_show", label: "Did not join", hint: "The seat reopens on the requisition" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Onboarding — ${c?.name ?? "New hire"}`}
      subtitle={
        r
          ? `${r.mrfNo} · ${r.jobTitle}${c?.offeredCtc !== null && c?.offeredCtc !== undefined ? ` · offered ${inr(c.offeredCtc)}` : ""}`
          : undefined
      }
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* ---- Where this onboarding stands ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${OFFER_CLASS[o.offerStatus]}`}>
            {OFFER_LABEL[o.offerStatus]}
          </span>
          {done && (
            <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
              Joined {formatDateDMY(o.joiningDate)}
            </span>
          )}
          {checks.length > 0 && (
            <span className="text-[12.5px] text-grey-2">
              {ticked} of {checks.length} done
            </span>
          )}
        </div>

        {dropped && o.offerStatusReason && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">
              {OFFER_LABEL[o.offerStatus]}
            </div>
            <p className="mt-1 text-[13px] text-navy">{o.offerStatusReason}</p>
            <p className="mt-1 text-[12px] text-grey-2">
              The seat has gone back to {r?.mrfNo ?? "the requisition"} — it is looking for someone again.
            </p>
          </div>
        )}

        {/* ---- 1. The joining date. Nothing else is possible until this exists. ---- */}
        <div className="rounded-xl border border-line p-4">
          <SectionHeading>Joining date</SectionHeading>
          <p className="mt-0.5 text-[12px] text-grey-2">
            This unlocks the checklist — every item is due a set number of working days after it.
          </p>
          <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
            <div className="w-44">
              <TextInput
                type="date"
                value={joiningDate}
                onChange={(e) => setJoiningDate(e.target.value)}
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <Button
                size="sm"
                disabled={busy || !joiningDate}
                onClick={() => void run(() => s.setOnboardingDate(o.id, joiningDate))}
              >
                {o.joiningDate ? "Update date" : "Set date & open the checklist"}
              </Button>
            )}
          </div>
        </div>

        {/* ---- 2. The offer outcome. This is what seat accounting turns on. ---- */}
        {!done && !dropped && mayAct && (
          <div className="rounded-xl border border-line p-4">
            <SectionHeading>Offer outcome</SectionHeading>
            <p className="mt-0.5 text-[12px] text-grey-2">
              Nobody counts as hired until they accept and turn up. If they drop out, the seat reopens
              automatically.
            </p>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
              {offerChoices.map((ch) => (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => setOffer(ch.key)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    offer === ch.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                  }`}
                >
                  <div className="text-[13px] font-semibold text-navy">{ch.label}</div>
                  <div className="text-[11.5px] text-grey-2">{ch.hint}</div>
                </button>
              ))}
            </div>
            {offer !== "accepted" && (
              <div className="mt-2.5">
                <FieldLabel label="Reason" required>
                  <TextArea
                    rows={2}
                    value={offerReason}
                    onChange={(e) => setOfferReason(e.target.value)}
                    placeholder="Why did they not take the job?"
                  />
                </FieldLabel>
              </div>
            )}
            <div className="mt-2.5">
              <Button
                size="sm"
                disabled={busy || (offer !== "accepted" && !offerReason.trim())}
                onClick={() => void run(() => s.setOfferStatus(o, offer, offerReason.trim()))}
              >
                {busy ? "Saving…" : "Record the outcome"}
              </Button>
            </div>
          </div>
        )}

        {/* ---- 3. The checklist. Config-driven — Setup → Masters, not a code change. ---- */}
        <div>
          <SectionHeading>Checklist</SectionHeading>
          {checks.length === 0 ? (
            <p className="mt-1.5 rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
              Set the joining date to open the checklist. The items come from Setup → Masters, so HR can add
              or reorder them without a developer.
            </p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {checks.map((k) => (
                <CheckRow key={k.id} onboarding={o} check={k} readOnly={readOnly} />
              ))}
            </ul>
          )}
        </div>

        {/* ---- The Employee ID: a value, not a task. ---- */}
        <div className="rounded-xl border border-line p-4">
          <SectionHeading>Employee ID</SectionHeading>
          <p className="mt-0.5 text-[12px] text-grey-2">The ID from the HR system, once it exists.</p>
          <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
            <div className="w-52">
              <TextInput
                value={empCode}
                onChange={(e) => setEmpCode(e.target.value)}
                placeholder="e.g. OOT-1043"
                disabled={!mayAct || dropped}
              />
            </div>
            {mayAct && !dropped && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !empCode.trim()}
                onClick={() => void run(() => s.setEmployeeCode(o.id, empCode.trim()))}
              >
                Save
              </Button>
            )}
          </div>
        </div>

        {done && (
          <p className="rounded-xl border border-ryg-green/30 bg-[#E9F7EF]/50 px-4 py-3 text-[13px] text-navy">
            Onboarding complete — {c?.name ?? "this person"} has joined. The seat on{" "}
            {r?.mrfNo ?? "the requisition"} is filled.
          </p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        {!mayAct && (
          <p className="text-[12.5px] text-grey-2">You can see this onboarding, but not change it.</p>
        )}
      </div>
    </Modal>
  );
}
