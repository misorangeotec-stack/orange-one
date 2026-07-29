/**
 * What the GST portal says about a taxpayer, rendered once and reused three
 * times: on the gate (Sales, at raise time), and on the Accounts and Director
 * panels (days later, from the frozen snapshot).
 *
 * ⚠ EVERY CLAIM HERE IS DATED, DELIBERATELY. The compliance half comes from a
 *   free, CACHED provider that reports its own sync date, and that date can be
 *   months old. An approver who reads "filed to September" and grants 60-day
 *   terms on it is entitled to know whether that was checked yesterday or last
 *   year. Never render a filing fact without `syncedOn` next to it.
 *
 * ⚠ IT MUST RENDER WITH `compliance: null`. The free tier is 1000/day and 20/min;
 *   a 429, a missing key or a provider outage all yield null while the identity
 *   half still arrives. That is a normal state, not an error, and it shows as a
 *   quiet line rather than a warning.
 *
 * Hub-native components only — shared/ui hard-codes the portal's tokens, which
 * `.hub-root` does not remap.
 */
import { AlertTriangle, CalendarClock, FileCheck2, Info } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import {
  isInactiveStatus, latestReturn,
  type GstinSnapshot, type GstCompliance,
} from "@hub/lib/customerOnboarding/gstin";

/** "2026-07-14" → "14-07-2026". Anything unparseable passes through unchanged. */
function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * How stale the provider's cache is, in whole days.
 *
 * Returns null rather than 0 for an unparseable date so the caller can tell
 * "synced today" apart from "no idea when" — they warrant different copy.
 */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * The provider's traffic-light, coloured.
 *
 * Verified live 29-07-2026 that the real vocabulary includes "Yellow", not the
 * "Amber" the docs imply — so match on the colour WORDS present rather than an
 * exact enum, and fall through to a neutral badge for anything unrecognised. A
 * grading nobody can read is worse than none.
 */
function categoryTone(category: string): string {
  if (/green/i.test(category)) return "border-emerald-400 text-emerald-700 dark:text-emerald-400";
  if (/yellow|amber/i.test(category)) return "border-amber-400 text-amber-700 dark:text-amber-400";
  if (/red/i.test(category)) return "border-destructive text-destructive";
  return "";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="font-medium text-foreground min-w-0 break-words">{value}</dd>
    </div>
  );
}

export default function GstComplianceCard({
  snapshot, compact = false,
}: {
  snapshot: GstinSnapshot | null;
  /** Approver panels pass true: identity is already on screen above them. */
  compact?: boolean;
}) {
  if (!snapshot) return null;

  const c: GstCompliance | null = snapshot.compliance;
  const inactive = isInactiveStatus(snapshot.status);
  const composition = /composition/i.test(snapshot.taxpayerType ?? "");
  const gstr3b = latestReturn(c, "GSTR3B");
  const gstr1 = latestReturn(c, "GSTR1");
  const stale = daysSince(c?.syncedOn ?? null);

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-medium">GST portal record</p>
        <span className="font-mono text-xs text-muted-foreground">{snapshot.gstin}</span>
        {snapshot.status && (
          <Badge variant={inactive ? "destructive" : "secondary"}>{snapshot.status}</Badge>
        )}
        {c?.category && (
          <Badge variant="outline" className={categoryTone(c.category)}>
            {c.category} filer
          </Badge>
        )}
      </div>

      {/* A cancelled registration and a Composition dealer are the two findings
          that change a credit decision on their own, so they get a banner each
          rather than a row in a list someone skims past. */}
      {inactive && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            This registration is <strong>{snapshot.status}</strong>, not Active
            {snapshot.cancellationDate ? <> (cancelled {snapshot.cancellationDate})</> : null}.
            Confirm before offering any credit terms.
          </p>
        </div>
      )}
      {composition && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Registered under <strong>Composition</strong> — they cannot pass on input tax credit,
            which usually changes how the deal is priced.
          </p>
        </div>
      )}

      {!compact && (
        <dl className="grid gap-1 sm:grid-cols-2">
          {snapshot.legalName && <Row label="Legal name" value={snapshot.legalName} />}
          {snapshot.tradeName && <Row label="Trade name" value={snapshot.tradeName} />}
          {snapshot.constitution && <Row label="Constitution" value={snapshot.constitution} />}
          {snapshot.taxpayerType && <Row label="Taxpayer type" value={snapshot.taxpayerType} />}
          {snapshot.registrationDate && <Row label="Registered" value={snapshot.registrationDate} />}
        </dl>
      )}

      {/* Every declared premises, listed. Only the one labelled as manufacturing
          is auto-filled into the factory field, so showing the rest is how the
          rep spots a second plant or the right godown and copies it across
          themselves — rather than wondering why the portal "missed" it. */}
      {snapshot.additionalPlaces.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Other places of business ({snapshot.additionalPlaces.length})
          </p>
          <ul className="space-y-1">
            {snapshot.additionalPlaces.map((p, i) => (
              <li key={`${p.address}-${i}`} className="text-xs">
                {p.nature && (
                  <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {p.nature}
                  </span>
                )}
                <span className="text-muted-foreground">{p.address}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c ? (
        <>
          <dl className="grid gap-1 sm:grid-cols-2">
            {gstr3b && (
              <Row
                label="Last GSTR-3B"
                value={<>{gstr3b.period} {gstr3b.fy}{gstr3b.filedOn ? ` · filed ${gstr3b.filedOn}` : ""}</>}
              />
            )}
            {gstr1 && (
              <Row
                label="Last GSTR-1"
                value={<>{gstr1.period} {gstr1.fy}{gstr1.filedOn ? ` · filed ${gstr1.filedOn}` : ""}</>}
              />
            )}
            {c.aggregateTurnover && (
              <Row
                label="Turnover"
                value={<>{c.aggregateTurnover}{c.aggregateTurnoverFy ? ` (${c.aggregateTurnoverFy})` : ""}</>}
              />
            )}
            {(c.eInvoiceMandated || c.eInvoiceEnabled) && (
              <Row
                label="e-Invoice"
                value={[
                  c.eInvoiceMandated ? `mandated: ${c.eInvoiceMandated}` : null,
                  c.eInvoiceEnabled ? `enabled: ${c.eInvoiceEnabled}` : null,
                ].filter(Boolean).join(" · ")}
              />
            )}
            {c.natureOfBusiness.length > 0 && (
              <Row label="Business" value={c.natureOfBusiness.join(", ")} />
            )}
            {c.hsn.length > 0 && <Row label="HSN/SAC" value={c.hsn.slice(0, 6).join(", ")} />}
          </dl>

          {c.returns.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Filing history — last {Math.min(c.returns.length, 20)} returns
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-[11px] text-muted-foreground">
                      <th className="px-2 py-1 font-medium">Return</th>
                      <th className="px-2 py-1 font-medium">Period</th>
                      <th className="px-2 py-1 font-medium">FY</th>
                      <th className="px-2 py-1 font-medium">Filed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.returns.slice(0, 20).map((r, i) => (
                      <tr key={`${r.type}-${r.fy}-${r.period}-${i}`} className="border-t">
                        <td className="px-2 py-1 font-medium">{r.type}</td>
                        <td className="px-2 py-1">{r.period}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.fy}</td>
                        <td className="px-2 py-1 text-muted-foreground">{r.filedOn ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* ⚠ The dateline. Do not remove it to save a row — see the header. */}
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Filing data is a cached copy, last refreshed by the provider on{" "}
              <strong>{ddmmyyyy(c.syncedOn) ?? "an unknown date"}</strong>
              {stale !== null && stale > 45 && (
                <> — <strong>{stale} days ago</strong>, so treat it as indicative and check the
                   portal before approving a large limit</>
              )}
              . Looked up on {ddmmyyyy(snapshot.lookedUpAt.slice(0, 10))}.
            </span>
          </p>
        </>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Filing history was not available for this GSTIN — the identity details above still
          came from the portal. Check the GST portal directly if the credit decision turns on
          their filing record.
        </p>
      )}
    </div>
  );
}
