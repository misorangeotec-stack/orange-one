import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useExitStore } from "../../store";
import { exitDocUrl, uploadAssetDoc } from "../../data/exitWrites";
import type { AssetStatus, ExitAsset, ExitCase } from "../../types";

/** Open the private file in a new tab. Nothing in this bucket is ever public. */
async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * The four statuses, and what each one MEANS.
 *
 * `pending` is the only one that is not a settlement — it is the only status that
 * blocks HR's signature, and every other one closes the row for good.
 */
const STATUS: { key: AssetStatus; label: string; hint: string }[] = [
  { key: "returned", label: "Returned", hint: "It came back" },
  { key: "not_applicable", label: "Not applicable", hint: "Never issued to them" },
  { key: "lost", label: "Lost", hint: "Gone — say what is being recovered" },
  { key: "pending", label: "Still pending", hint: "Blocks HR's signature" },
];

const STATUS_CLASS: Record<AssetStatus, string> = {
  returned: "bg-[#E9F7EF] text-ryg-green",
  not_applicable: "bg-line text-grey",
  lost: "bg-[#FDECEC] text-ryg-red",
  pending: "bg-[#FFF7E6] text-yellow",
};

const STATUS_LABEL: Record<AssetStatus, string> = {
  returned: "Returned",
  not_applicable: "Not applicable",
  lost: "Lost",
  pending: "Pending",
};

/**
 * ONE asset issued to the leaver.
 *
 * The row is a SNAPSHOT — `name` was copied off the master when the last working day
 * was confirmed, so renaming "Laptop" next quarter cannot rewrite what THIS person was
 * asked to hand back.
 *
 * ⚠ A `lost` asset needs a RECOVERY AMOUNT **or** an explicit remark. The RPC refuses
 * otherwise, and so does this button: a lost laptop with no number against it is how a
 * recovery quietly never happens — the row settles, the step signs off, the F&F is
 * generated, and nobody ever deducts anything.
 *
 * Everything freezes once HR has signed: a signature that can be invalidated underneath
 * the person who gave it is not a signature. The RPC re-checks; this is courtesy.
 */
function AssetRow({ case: c, asset: a, readOnly }: { case: ExitCase; asset: ExitAsset; readOnly: boolean }) {
  const s = useExitStore();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AssetStatus>(a.status);
  // A business date, yyyy-mm-dd, straight out of a date input. NEVER toISOString().
  const [returnedOn, setReturnedOn] = useState(a.returnedOn ?? "");
  const [condition, setCondition] = useState(a.condition ?? "");
  const [remarks, setRemarks] = useState(a.remarks ?? "");
  const [recovery, setRecovery] = useState(a.recoveryAmount === null ? "" : String(a.recoveryAmount));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Mirrors the RPC's one rule with teeth. See the header.
  const lostWithNothing = status === "lost" && !recovery.trim() && !remarks.trim();

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Upload FIRST, so a save can never succeed against a photo that is not there.
      const up = file ? await uploadAssetDoc(c.id, file) : null;
      await s.updateAsset(a.id, {
        status,
        returnedOn: returnedOn || null,
        condition: condition.trim() || null,
        remarks: remarks.trim() || null,
        recoveryAmount: recovery.trim() ? Number(recovery) : null,
        filePath: up?.path ?? null,
        fileName: up?.name ?? null,
      });
      setFile(null);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-xl border transition ${
        a.status === "returned"
          ? "border-ryg-green/30 bg-[#E9F7EF]/40"
          : a.status === "lost"
            ? "border-ryg-red/30 bg-[#FDECEC]/40"
            : a.status === "not_applicable"
              ? "border-line bg-page"
              : open
                ? "border-orange/40 bg-white"
                : "border-line bg-white hover:border-orange/30"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-semibold text-navy">{a.name}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASS[a.status]}`}
            >
              {STATUS_LABEL[a.status]}
            </span>
          </div>

          {a.status === "returned" && (
            <p className="mt-1 text-[12px] text-grey">
              Returned on {formatDateDMY(a.returnedOn)}
              {a.condition && ` · ${a.condition}`}
            </p>
          )}
          {a.status === "lost" && (
            <p className="mt-1 text-[12px] text-navy">
              <span className="text-grey">Recovering — </span>
              {a.recoveryAmount === null
                ? "nothing"
                : a.recoveryAmount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            </p>
          )}
          {a.remarks && (
            <p className="mt-1 text-[12px] text-navy">
              <span className="text-grey">Remarks — </span>
              {a.remarks}
            </p>
          )}

          {a.filePath && (
            <button
              type="button"
              onClick={() => void openDoc(a.filePath!)}
              className="mt-1 text-[12px] font-semibold text-orange hover:underline"
            >
              {a.fileName ?? "Open photo"} →
            </button>
          )}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-[12px] font-semibold text-grey-2 hover:text-orange"
          >
            {open ? "Close" : a.status === "pending" ? "Record it" : "Edit"}
          </button>
        )}
      </div>

      {/* ---- The form, only for the row being worked on. ---- */}
      {!readOnly && open && (
        <div className="space-y-3 border-t border-line px-4 py-3.5">
          <div className="grid gap-2 sm:grid-cols-4">
            {STATUS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setStatus(o.key)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  status === o.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                }`}
              >
                <div className="text-[13px] font-semibold text-navy">{o.label}</div>
                <div className="text-[11.5px] leading-snug text-grey-2">{o.hint}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Only a RETURNED asset came back on a day. The RPC defaults it to today
                rather than leaving a returned-with-no-date row, which reads as returned
                and reports as never. */}
            {status === "returned" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-navy">Returned on</span>
                  <TextInput
                    type="date"
                    value={returnedOn}
                    onChange={(e) => setReturnedOn(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-navy">Condition</span>
                  <TextInput
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="e.g. working, screen scratched"
                  />
                </label>
              </>
            )}

            {/* ⚠ Only a LOST asset carries a recovery. Any other status clears it
                server-side, so a stale number from an earlier "lost" cannot ride along
                into the F&F. */}
            {status === "lost" && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-navy">
                  Amount being recovered (₹)
                </span>
                <TextInput
                  type="number"
                  min={0}
                  step="0.01"
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  placeholder="e.g. 45000"
                />
              </label>
            )}

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[13px] font-medium text-navy">
                Remarks
                {status === "lost" && !recovery.trim() ? " (required — say why nothing is being recovered)" : ""}
              </span>
              <TextInput
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  status === "lost"
                    ? "e.g. written off — insured, no deduction"
                    : "e.g. handed to the Admin desk"
                }
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[13px] font-medium text-navy">
                Photo of the returned kit
              </span>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy || lostWithNothing}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {lostWithNothing && (
              <span className="text-[12px] text-grey">
                It is marked lost — record the amount being recovered, or say why nothing is.
              </span>
            )}
          </div>

          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * ⭐ THE ASSET RETURN — the grid, and then **the two signatures**.
 *
 * The asset list is SNAPSHOTTED from the active asset-type master when the last working
 * day is confirmed, in the very same transaction as the clearance checklist. The rows
 * are settled one by one (returned / never issued / lost-and-being-recovered), and then:
 *
 *   1. **the HOD signs** — the reporting manager, who is the person who actually saw
 *      the kit come back;
 *   2. **HR signs** — refused until the HOD has signed AND no row is still pending, and
 *      it is HR's signature that COMPLETES the step.
 *
 * The order is the point. "HR signs first and the HOD rubber-stamps it later" is how a
 * laptop gets written off by someone who never saw it.
 *
 * ⭐ And HR's signature is what makes the **auto-tick** fire: every clearance row whose
 * `satisfiedByStep` is `asset_return` (Admin's and IT's) flips to done, with NO file
 * demanded of either of them — the evidence is this sign-off, with its own photo, its
 * own condition notes and its own recovery amount. Asking Admin for a second upload is
 * exactly the double work `satisfied_by_step` exists to abolish.
 */
export default function AssetPanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const assets = s.assetsFor(c.id);
  const skip = s.skipsFor(c.id).find((k) => k.stepKey === "asset_return");

  const [hodRemarks, setHodRemarks] = useState("");
  const [hrRemarks, setHrRemarks] = useState("");
  const [busy, setBusy] = useState<"hod" | "hr" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  const hrSigned = !!c.assetsHrSignedAt;
  const hodSigned = !!c.assetsHodSignedAt;

  // Mirrors fms_exit_can_act('asset_return', …): the case's own reporting managers, the
  // configured step owners, the coordinators and admins. The RPC is the real gate.
  // `lwd` is in the list because every asset RPC refuses without one — the asset return
  // is dated from the last working day, so there is nothing to act on before it exists.
  const mayAct = !closed && !skip && !!c.lwd && s.canActOn("asset_return", c);

  const pending = assets.filter(s.isAssetPending).length;
  // Editing is over the moment HR signs — the RPC refuses it, and so must this.
  const rowsReadOnly = !mayAct || hrSigned;

  // The clearance rows THIS step settles. Rendered on both sides of the auto-tick so
  // nobody signs twice for the same thing and then wonders which one counted.
  const autoTicked = s.checksFor(c.id).filter((k) => k.satisfiedByStep === "asset_return");

  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");

  const sign = async (role: "hod" | "hr") => {
    setBusy(role);
    setErr(null);
    try {
      await s.signAssets(c, role, role === "hod" ? hodRemarks.trim() : hrRemarks.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Asset return</h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
            {c.lwd
              ? "Settle every row, then the HOD signs and HR signs. HR's signature completes the step — and ticks the Admin and IT clearance rows automatically."
              : "The asset list opens when the last working day is confirmed — it is generated from the asset types in Masters."}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {assets.length > 0 && (
            <span className="text-[12.5px] text-grey-2">
              {assets.length - pending} of {assets.length} settled
            </span>
          )}
          {hrSigned ? (
            <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
              Signed off
            </span>
          ) : (
            c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "asset_return")} />
              </span>
            )
          )}
        </div>
      </div>

      {/* A waived step is complete-with-a-reason. It owes nobody anything. */}
      {skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
          <span className="font-semibold">This step was waived</span> — {skip.reason}
        </p>
      )}

      {assets.length === 0 ? (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
          {c.lwd
            ? "This case has no asset rows — every asset type was inactive when the last working day was confirmed. Add them in Masters and ask an admin to re-seed the case."
            : "Nothing yet. Confirming the last working day generates this list from the asset types in Masters."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {assets.map((a) => (
            <AssetRow key={a.id} case={c} asset={a} readOnly={rowsReadOnly} />
          ))}
        </ul>
      )}

      {/* ---- ⭐ THE TWO SIGNATURES. In order, and the second one completes the step. ---- */}
      {assets.length > 0 && (
        <>
          <SectionHeading>Sign-off</SectionHeading>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* 1. The HOD — the person who actually saw the kit come back. */}
            <div className="rounded-xl border border-line bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
                Reporting manager / HOD
              </div>
              {hodSigned ? (
                <>
                  <p className="mt-1.5 text-[13.5px] font-semibold text-ryg-green">
                    Signed · {person(c.assetsHodSignedBy)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-grey">{formatDateTimeDMY(c.assetsHodSignedAt)}</p>
                  {c.assetsHodRemarks && (
                    <p className="mt-1 text-[12.5px] text-navy">{c.assetsHodRemarks}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-grey-2">
                    Signs first. HR cannot sign until this is done.
                  </p>
                  {mayAct && (
                    <div className="mt-2.5 space-y-2">
                      <TextInput
                        value={hodRemarks}
                        onChange={(e) => setHodRemarks(e.target.value)}
                        placeholder="Remarks (optional)"
                      />
                      <Button size="sm" onClick={() => void sign("hod")} disabled={busy !== null}>
                        {busy === "hod" ? "Signing…" : "Sign as the HOD"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 2. HR — refused until the HOD has signed AND nothing is still pending.
                   This signature is what stamps assetsReturnedAt and fires the auto-tick. */}
            <div className="rounded-xl border border-line bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">HR</div>
              {hrSigned ? (
                <>
                  <p className="mt-1.5 text-[13.5px] font-semibold text-ryg-green">
                    Signed · {person(c.assetsHrSignedBy)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-grey">{formatDateTimeDMY(c.assetsHrSignedAt)}</p>
                  {c.assetsHrRemarks && <p className="mt-1 text-[12.5px] text-navy">{c.assetsHrRemarks}</p>}
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-grey-2">
                    Completes the step. Blocked until the HOD has signed and every asset is settled.
                  </p>
                  {mayAct && (
                    <div className="mt-2.5 space-y-2">
                      <TextInput
                        value={hrRemarks}
                        onChange={(e) => setHrRemarks(e.target.value)}
                        placeholder="Remarks (optional)"
                      />
                      <Button
                        size="sm"
                        onClick={() => void sign("hr")}
                        disabled={busy !== null || !hodSigned || pending > 0}
                      >
                        {busy === "hr" ? "Signing…" : "Sign as HR"}
                      </Button>
                      {!hodSigned && (
                        <p className="text-[12px] text-grey">The HOD has to sign first.</p>
                      )}
                      {hodSigned && pending > 0 && (
                        <p className="text-[12px] text-grey">
                          {pending} asset{pending === 1 ? " is" : "s are"} still pending — every one must be
                          returned, written off as lost, or marked not applicable.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ---- ⭐ THE AUTO-TICK, said out loud — on BOTH sides of the signature. ---- */}
          {autoTicked.length > 0 && (
            <p
              className={`rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed ${
                hrSigned
                  ? "border-ryg-green/30 bg-[#E9F7EF]/40 text-navy"
                  : "border-line bg-page text-grey"
              }`}
            >
              {hrSigned ? (
                <>
                  <span className="font-semibold text-navy">Ticked automatically by this sign-off:</span>{" "}
                  {autoTicked.map((k) => `${k.name} (${k.departmentLabel})`).join(", ")}. Nobody was asked for a
                  second upload — the evidence is the signature above.
                </>
              ) : (
                <>
                  <span className="font-semibold text-navy">HR's signature also ticks</span>{" "}
                  {autoTicked.map((k) => `${k.name} (${k.departmentLabel})`).join(", ")} on the clearance
                  checklist, with no file asked of anyone. Admin and IT do not sign the same thing twice.
                </>
              )}
            </p>
          )}

          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </>
      )}
    </Card>
  );
}
