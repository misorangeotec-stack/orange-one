import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateTime } from "@/shared/lib/time";
import { useAssetStore } from "../../store";
import ScheduleModal from "../../components/ScheduleModal";
import DocLink from "../../components/DocLink";
import StatusPill from "../../components/StatusPill";
import { dmy, duePhrase, frequencyLabel, inr, numOrDash } from "../../lib/format";
import { liveTracks } from "../../lib/schedules";
import type { AssetSchedule } from "../../types";

/**
 * One asset, end to end.
 *
 * ⚠ BLOCK ORDER IS A HOUSE RULE: the progress block comes first on every FMS
 *   detail page. For an asset the equivalent of progress is WHAT IS DUE AND WHEN —
 *   the tracks. Purchase facts, however tidy, are not why anyone opens this page.
 */
export default function AssetDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const s = useAssetStore();
  const asset = s.assetById(id);

  const [trackModal, setTrackModal] = useState<{ open: boolean; row: AssetSchedule | null }>({ open: false, row: null });
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [readingOpen, setReadingOpen] = useState(false);
  const [reading, setReading] = useState("");
  const [readingDate, setReadingDate] = useState(s.todayIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobs = useMemo(() => (asset ? s.jobsForAsset(asset.id) : []), [asset, s]);
  const readings = useMemo(() => (asset ? s.readingsFor(asset.id) : []), [asset, s]);
  const activity = useMemo(() => (asset ? s.activityFor("asset", asset.id) : []), [asset, s]);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!asset) return <p className="text-[13.5px] text-grey-2">That asset no longer exists.</p>;

  const setupMode = params.get("setup") === "1";
  const estimated = Number(params.get("est") ?? 0);
  const pendingTracks = Number(params.get("pending") ?? 0);
  const tracks = [...asset.schedules].sort((a, b) =>
    (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999"));
  const live = liveTracks(asset.schedules);

  /** The open job for a track, if any — a track with one cannot raise another. */
  const openJobFor = (scheduleId: string) =>
    jobs.find((j) => j.scheduleId === scheduleId &&
      j.status !== "closed" && j.status !== "cancelled" && j.status !== "skipped");

  const raiseNow = async (scheduleId: string) => {
    setBusy(true); setError(null);
    try { await s.raiseJobNow(scheduleId); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not raise the job."); }
    finally { setBusy(false); }
  };

  const doRetire = async () => {
    setBusy(true); setError(null);
    try { await s.retireAsset(asset.id, retireReason); setRetireOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not retire the asset."); }
    finally { setBusy(false); }
  };

  const doReading = async () => {
    setBusy(true); setError(null);
    try {
      await s.recordReading(asset.id, { reading, reading_date: readingDate });
      setReadingOpen(false); setReading("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the reading."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      {/* ---- heading ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold text-navy">{asset.assetNo} · {asset.name}</h1>
            {!asset.active && (
              <span className="rounded-full bg-[#EEF1F6] px-2.5 py-0.5 text-[11.5px] font-semibold text-grey">
                Retired {dmy(asset.retiredOn)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-grey-2">
            {s.masterName("category", asset.categoryId)} · {s.masterName("location", asset.locationId)} ·
            custodian {s.personName(asset.custodianUserId)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {asset.active && asset.usageUnitId && (
            <Button variant="ghost" size="sm" onClick={() => setReadingOpen(true)}>Log reading</Button>
          )}
          {asset.active && s.canRaise && (
            <Button variant="ghost" size="sm" onClick={() => setTrackModal({ open: true, row: null })}>
              Add track
            </Button>
          )}
          {asset.active && s.canRaise && (
            <Link to={`/asset-maintenance/assets/${asset.id}/edit`}>
              <Button variant="ghost" size="sm">Edit</Button>
            </Link>
          )}
          {asset.active && s.isProcessCoordinator && (
            <Button variant="ghost" size="sm" onClick={() => setRetireOpen(true)}>Retire</Button>
          )}
        </div>
      </div>

      {setupMode && (
        <div className="rounded-xl border border-[#FFD9BE] bg-[#FFF4EC] p-4">
          <p className="text-[13.5px] font-semibold text-navy">Set the real due dates</p>
          <p className="mt-1 text-[12.5px] text-navy">
            {estimated > 0 && (
              <>
                {estimated} {estimated === 1 ? "track was" : "tracks were"} created with an{" "}
                <strong>estimated</strong> next due date worked forward from the purchase date. Open
                each one and put in the real date — off the policy, the certificate, or the last
                service record.{" "}
              </>
            )}
            {pendingTracks > 0 && (
              <>
                {pendingTracks} more {pendingTracks === 1 ? "track" : "tracks"} could not be estimated
                (a one-off, or no default frequency) and {pendingTracks === 1 ? "was" : "were"} not
                created — add {pendingTracks === 1 ? "it" : "them"} with the real date.
              </>
            )}
          </p>
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={() => { params.delete("setup"); setParams(params, { replace: true }); }}>
              Got it
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}

      {/* ---- THE progress block: what is due, and when ---- */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>What is tracked</SectionHeading>
          <span className="text-[12px] text-grey-2">
            {live.length} live {live.length === 1 ? "track" : "tracks"}
          </span>
        </div>

        {tracks.length === 0 ? (
          <div className="mt-3 rounded-lg bg-[#FEF6E0] px-3 py-3 text-[12.5px] text-[#946200]">
            Nothing is tracked on this asset, so it will never remind anybody. Add a track — a
            service interval, an insurance expiry, an AMC — and the engine takes it from there.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">What</th>
                  <th className="py-2 pr-3">Next due</th>
                  <th className="py-2 pr-3">Repeats</th>
                  <th className="py-2 pr-3">Reminds</th>
                  <th className="py-2 pr-3">Last done</th>
                  <th className="py-2 pr-3">Reference</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const open = openJobFor(t.id);
                  const overdue = !!t.nextDueDate && t.nextDueDate < s.todayIso;
                  return (
                    <tr key={t.id} className={`border-b border-line/70 ${!t.active ? "opacity-55" : ""}`}>
                      {/* Actions first — the standing column rule for every FMS table. */}
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {s.canRaise && asset.active && (
                            <button
                              className="text-[12.5px] font-semibold text-orange hover:underline"
                              onClick={() => setTrackModal({ open: true, row: t })}
                            >
                              Edit
                            </button>
                          )}
                          {open ? (
                            <Link to={`/asset-maintenance/jobs/${open.id}`}
                              className="text-[12.5px] font-semibold text-navy hover:underline">
                              Job open
                            </Link>
                          ) : (
                            asset.active && t.active && s.canRaise && (
                              <button
                                disabled={busy}
                                className="text-[12.5px] font-semibold text-grey hover:text-orange hover:underline disabled:opacity-50"
                                onClick={() => raiseNow(t.id)}
                              >
                                Service now
                              </button>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold text-navy">{s.scheduleTypeName(t.scheduleTypeId)}</span>
                        {!t.active && <span className="ml-2 text-[11.5px] text-grey-2">inactive</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {t.nextDueDate ? (
                          <>
                            <span className={overdue ? "font-semibold text-ryg-red" : "text-navy"}>
                              {dmy(t.nextDueDate)}
                            </span>
                            <span className="ml-2 text-[12px] text-grey-2">
                              {duePhrase(t.nextDueDate, s.todayIso)}
                            </span>
                          </>
                        ) : (
                          <span className="text-grey-2">Not scheduled</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-grey whitespace-nowrap">
                        {frequencyLabel(t.frequencyValue, t.frequencyUnit)}
                        {t.usageInterval ? ` · or ${t.usageInterval} ${s.masterName("usage_unit", asset.usageUnitId)}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-grey whitespace-nowrap">{t.leadDays}d ahead</td>
                      <td className="py-2 pr-3 text-grey whitespace-nowrap">{dmy(t.lastDoneDate)}</td>
                      <td className="py-2 pr-3 text-grey">
                        {t.refNo ? (
                          <span>
                            {t.refNo}
                            {t.provider ? ` · ${t.provider}` : ""}
                            {t.amount !== null ? ` · ${inr(t.amount)}` : ""}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- facts ---- */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <SectionHeading>Asset</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Make" value={s.masterName("make", asset.makeId)} />
            <Field label="Model" value={asset.model ?? "—"} />
            <Field label="Serial / reg. no." value={asset.serialNo ?? "—"} />
            <Field label="Company" value={s.masterName("company", asset.companyId)} />
            <Field label="Department" value={s.departments.find((d) => d.id === asset.departmentId)?.name ?? "—"} />
            <Field label="Condition" value={s.masterName("condition", asset.conditionId)} />
            {asset.usageUnitId && (
              <Field
                label={`Reading (${s.masterName("usage_unit", asset.usageUnitId)})`}
                value={`${numOrDash(asset.currentUsage)}${asset.usageAsOn ? ` as on ${dmy(asset.usageAsOn)}` : ""}`}
              />
            )}
            {asset.remarks && <Field label="Remarks" value={asset.remarks} className="sm:col-span-3" />}
            {!asset.active && (
              <Field label="Retired because" value={asset.retiredReason ?? "—"} className="sm:col-span-3" />
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <SectionHeading>Purchase</SectionHeading>
          <div className="grid gap-4">
            <Field label="Purchased on" value={dmy(asset.purchaseDate)} />
            <Field label="Cost" value={inr(asset.purchaseCost)} />
            <Field label="Bought from" value={s.masterName("vendor", asset.vendorId)} />
            <Field label="Invoice no." value={asset.invoiceNo ?? "—"} />
            <Field label="Warranty" value={asset.warrantyMonths ? `${asset.warrantyMonths} months` : "—"} />
            {asset.invoicePath && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Invoice</div>
                <div className="mt-1"><DocLink path={asset.invoicePath} name={asset.invoiceName} /></div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ---- service history ---- */}
      <Card className="p-5">
        <SectionHeading>Service history</SectionHeading>
        {jobs.length === 0 ? (
          <p className="mt-3 text-[13px] text-grey-2">No service jobs have been raised for this asset yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">What</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3">Done</th>
                  <th className="py-2 pr-3">Cost</th>
                  <th className="py-2 pr-3">Vendor</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-line/70">
                    <td className="py-2 pr-3">
                      <Link to={`/asset-maintenance/jobs/${j.id}`} className="font-semibold text-navy hover:text-orange">
                        {j.jobNo}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-grey">{s.scheduleTypeName(j.scheduleTypeId)}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{dmy(j.dueDate)}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{dmy(j.sdActualDate)}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{inr(j.sdCost)}</td>
                    <td className="py-2 pr-3 text-grey">{s.vendorName(j.sdVendorId ?? j.scVendorId)}</td>
                    <td className="py-2 pr-3"><StatusPill status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- readings ---- */}
      {readings.length > 0 && (
        <Card className="p-5">
          <SectionHeading>Meter readings</SectionHeading>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {readings.slice(0, 12).map((r) => (
              <li key={r.id} className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 text-grey-2">{dmy(r.readingDate)}</span>
                <span className="font-semibold text-navy">
                  {r.reading} {s.masterName("usage_unit", asset.usageUnitId)}
                </span>
                <span className="text-grey-2">· {s.personName(r.recordedBy)}</span>
                {r.note && <span className="text-grey-2">— {r.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- activity ---- */}
      {activity.length > 0 && (
        <Card className="p-5">
          <SectionHeading>Activity</SectionHeading>
          <ul className="mt-3 space-y-2 text-[13px]">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="w-36 shrink-0 text-grey-2">{formatDateTime(a.createdAt)}</span>
                <span className="text-navy">{a.note ?? a.type}</span>
                <span className="text-grey-2">· {s.personName(a.actorId)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ScheduleModal
        open={trackModal.open}
        onClose={() => setTrackModal({ open: false, row: null })}
        asset={asset}
        schedule={trackModal.row}
      />

      <Modal
        open={retireOpen}
        onClose={() => setRetireOpen(false)}
        title="Retire this asset"
        subtitle={`${asset.assetNo} ${asset.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetireOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={doRetire} disabled={busy || !retireReason.trim()}>
              {busy ? "Retiring…" : "Retire asset"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey">
            Every track on this asset is switched off and any open service job is marked skipped, so
            it stops reminding. The asset and its history stay in the register.
          </p>
          <FieldLabel label="Why" required>
            <TextArea rows={2} value={retireReason} onChange={(e) => setRetireReason(e.target.value)}
              placeholder="Sold to a dealer / scrapped / written off" />
          </FieldLabel>
        </div>
      </Modal>

      <Modal
        open={readingOpen}
        onClose={() => setReadingOpen(false)}
        title="Log a meter reading"
        subtitle={`${asset.assetNo} ${asset.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReadingOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={doReading} disabled={busy || !reading.trim()}>
              {busy ? "Saving…" : "Save reading"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey">
            If this crosses a usage interval on any track, the service job is raised straight away —
            this is the only way a usage-based service can be triggered.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label={`Reading (${s.masterName("usage_unit", asset.usageUnitId)})`} required>
              <TextInput inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="As on">
              <TextInput type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} />
            </FieldLabel>
          </div>
        </div>
      </Modal>
    </div>
  );
}
