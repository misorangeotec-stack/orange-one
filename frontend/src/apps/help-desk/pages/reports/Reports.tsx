import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import { TextInput, FieldLabel } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useHelpStore } from "../../store";
import {
  fetchConfidentialRegister,
  fetchMis,
  type Mis,
  type MisSlaRow,
} from "../../data/helpFetch";

/**
 * The monthly HR Helpdesk MIS — PDF step 11.
 *
 * ⚠ EVERY FIGURE HERE IS ABOUT HELP TICKETS AND NOTHING ELSE.
 *
 * ⚠ AND EVERY FIGURE COUNTS EVERY HELP TICKET, not just the ones the reader can
 *   open. That is why it comes from `fms_help_mis` rather than from the store:
 *   the store is RLS-filtered, so a compliance percentage computed there would
 *   silently omit whatever the reader is not allowed to see — and a percentage
 *   that looks authoritative and is quietly partial is worse than none.
 *
 * ⚠⚠ THE THREE CONFIDENTIAL CATEGORIES ARE LEFT OUT OF EVERY BLOCK BELOW, and
 *    the page SAYS HOW MANY it left out. A "23 tickets this month" that included
 *    two grievances would tell the reader how many grievances exist, which is
 *    the first thing the gate withholds. They have their own register at the
 *    foot, behind a narrower gate.
 *
 * ⚠ AN UNTIMED CATEGORY IS NOT A MISS. Five are governed by policy rather than
 *   working days, and they are shown in their own column rather than folded into
 *   the compliance percentage in either direction.
 */
export default function Reports() {
  const s = useHelpStore();
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);

  const [from, setFrom] = useState(iso(first));
  const [to, setTo] = useState(iso(today));

  const q = useQuery({
    queryKey: ["helpMis", from, to],
    queryFn: () => fetchMis(from, to),
    enabled: !!from && !!to && from <= to,
  });

  return (
    <div>
      <h1 className="text-[20px] font-bold text-navy">Help Desk reports</h1>
      <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
        Every help ticket raised in the period, whoever raised it. Grievance, POSH and disciplinary
        tickets are counted only on the confidential register, which is why the totals here are
        smaller than the ticket list.
      </p>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <FieldLabel label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FieldLabel>
        </div>
      </Card>

      {q.isLoading && <Note>Working it out…</Note>}
      {q.error && <Bad>{(q.error as Error).message}</Bad>}
      {q.data && <MisBody mis={q.data} personName={s.personName} />}

      <ConfidentialRegister from={from} to={to} />
    </div>
  );
}

function MisBody({
  mis,
  personName,
}: {
  mis: Mis;
  personName: (id: string | null) => string;
}) {
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

  // The headline the PDF asks for: SLA compliance >= 95%, over tickets that HAD
  // a deadline.
  const timed = mis.slaByCategory.reduce((a, r) => a + r.timed, 0);
  const within = mis.slaByCategory.reduce((a, r) => a + r.within, 0);
  const untimed = mis.slaByCategory.reduce((a, r) => a + r.untimed, 0);

  return (
    <>
      {/* ⚠ SAID FIRST, not in a footnote. A reader who does not know what was
          left out will treat the totals as the whole desk. */}
      {mis.excludedConfidential > 0 && (
        <Note>
          {mis.excludedConfidential} confidential ticket
          {mis.excludedConfidential === 1 ? " is" : "s are"} not counted in anything below. See the
          register at the foot.
        </Note>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Tickets raised" value={mis.raised} />
        <Tile
          label="Answered within turnaround"
          value={pct(within, timed)}
          suffix="%"
          sub={`${within} of ${timed} that had a deadline`}
          target={95}
        />
        <Tile
          label="Answered first time"
          value={pct(mis.resolution.firstContact, mis.resolution.resolved)}
          suffix="%"
          sub={`${mis.resolution.firstContact} of ${mis.resolution.resolved} resolved`}
          target={80}
        />
        <Tile
          label="First reply"
          value={mis.firstResponse.medianMinutes === null ? null : Math.round(mis.firstResponse.medianMinutes)}
          suffix=" min"
          sub={`${mis.firstResponse.withinTarget} of ${mis.firstResponse.answered} within ${mis.frtTargetMinutes} min`}
        />
      </div>

      {untimed > 0 && (
        <p className="mt-2 text-[12.5px] text-grey-2">
          {/* The one line that stops this report lying. */}
          {untimed} ticket{untimed === 1 ? "" : "s"} had no fixed turnaround (governed by policy),
          so {untimed === 1 ? "it is" : "they are"} counted separately and left out of the
          percentage above.
        </p>
      )}

      <SlaTable title="By category" rows={mis.slaByCategory} label={(r) => r.category ?? "—"} />
      <SlaTable
        title="By person"
        rows={mis.slaByOwner}
        label={(r) => personName(r.ownerId ?? null)}
        note="A ticket in a category with several owners is counted for each of them, so these do not add up to the total."
      />

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">How old is what is still open</h2>
        <p className="mt-1 text-[12.5px] text-grey-2">
          Measured today, across everything still open — not only the period above, or the oldest
          tickets would be the ones it hid.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {mis.ageing.length === 0 ? (
            <li className="py-2 text-[13px] text-grey-2">Nothing is open.</li>
          ) : (
            mis.ageing.map((a) => (
              <li key={a.band} className="flex items-center justify-between py-2 text-[13.5px]">
                <span className="text-navy">{a.band}</span>
                <span className="font-semibold text-navy">{a.tickets}</span>
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Month by month</h2>
        <Grid
          head={["Month", "Category", "Tickets"]}
          rows={mis.trend.map((t) => [t.month, t.category, String(t.tickets)])}
          empty="Nothing raised in this period."
        />
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Reopened, and how they ended</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Tile label="Reopened once or more" value={mis.resolution.reopened} />
          <Tile label="Reopened twice or more" value={mis.resolution.reopenedTwicePlus} />
          <Tile
            label="Average time to answer"
            value={mis.resolution.avgHours === null ? null : Math.round(mis.resolution.avgHours)}
            suffix=" hrs"
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Tile label="Closed by the employee" value={mis.closure.confirmed} />
          {/* ⚠ SEPARATE FROM "confirmed", ALWAYS. Counting silence as
              satisfaction is how a desk reports 100% CSAT out of nobody
              replying. */}
          <Tile
            label="Closed with no reply"
            value={mis.closure.autoClosed}
            sub="The employee never confirmed — not the same as satisfied"
          />
          <Tile
            label="Satisfaction"
            value={mis.closure.csatAvg === null ? null : Math.round(mis.closure.csatAvg * 10) / 10}
            suffix=" / 5"
            sub={`${mis.closure.rated} rated it`}
          />
        </div>
      </Card>
    </>
  );
}

function SlaTable({
  title,
  rows,
  label,
  note,
}: {
  title: string;
  rows: MisSlaRow[];
  label: (r: MisSlaRow) => string;
  note?: string;
}) {
  const pct = (r: MisSlaRow) => (r.timed > 0 ? Math.round((r.within / r.timed) * 100) : null);
  return (
    <Card className="mt-4 p-5">
      <h2 className="text-[15px] font-bold text-navy">{title}</h2>
      {note && <p className="mt-1 text-[12.5px] text-grey-2">{note}</p>}
      <Grid
        head={["", "Raised", "Answered", "Within turnaround", "No turnaround"]}
        rows={rows.map((r) => [
          label(r),
          String(r.raised),
          String(r.resolved),
          // ⚠ "—" when nothing had a deadline. A 0% there would read as total
          //   failure when the truth is "there was nothing to fail".
          pct(r) === null ? "—" : `${pct(r)}%  (${r.within}/${r.timed})`,
          r.untimed ? String(r.untimed) : "—",
        ])}
        empty="Nothing raised in this period."
      />
    </Card>
  );
}

/**
 * Riya's KRA 12 register.
 *
 * ⚠ IT RENDERS ONLY WHEN THE SERVER ALLOWS IT. A reader who is not the HR Head
 *   or the ICC gets nothing at all — not an error, because the existence of a
 *   register they cannot read is not something they need to be told about.
 */
function ConfidentialRegister({ from, to }: { from: string; to: string }) {
  const q = useQuery({
    queryKey: ["helpConfidentialRegister", from, to],
    queryFn: () => fetchConfidentialRegister(from, to),
    enabled: !!from && !!to && from <= to,
    retry: false,
  });

  if (q.error) return null;
  if (!q.data) return null;

  return (
    <Card className="mt-4 border-[#FECDCA] p-5">
      <h2 className="text-[15px] font-bold text-[#B42318]">Confidential register</h2>
      <p className="mt-1 max-w-3xl text-[12.5px] text-grey-2">
        {/* The register proves the case was logged and answered in time. It is
            deliberately NOT a second, easier copy of the complaint. */}
        Grievance, POSH and disciplinary matters. Dates and status only — the complaint itself stays
        on its own ticket. Only you and the ICC can read this.
      </p>
      <Grid
        head={["Ticket", "Kind", "Raised", "Answered within a day", "Status", "Reopened"]}
        rows={q.data.map((r) => [
          r.ticketNo,
          r.category,
          formatDateDMY(r.raisedAt),
          r.ackedNextDay === null ? "Not yet" : r.ackedNextDay ? "Yes" : "No",
          r.status,
          r.reopenCount ? String(r.reopenCount) : "—",
        ])}
        empty="Nothing logged in this period."
      />
    </Card>
  );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

function Grid({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <p className="mt-3 text-[13px] text-grey-2">{empty}</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-grey-2">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className={"py-2 pr-4 " + (j === 0 ? "font-medium text-navy" : "text-grey")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({
  label,
  value,
  suffix,
  sub,
  target,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  sub?: string;
  target?: number;
}) {
  // A missing figure prints "—", never 0. "No tickets had a deadline" and "every
  // one was late" are different facts and must not share a rendering.
  const missed = target !== undefined && value !== null && value < target;
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">{label}</p>
      <p className={"mt-1 text-[22px] font-bold " + (missed ? "text-ryg-red" : "text-navy")}>
        {value === null ? "—" : value}
        {value !== null && suffix ? <span className="text-[14px]">{suffix}</span> : null}
      </p>
      {target !== undefined && <p className="text-[11.5px] text-grey-2">target {target}%</p>}
      {sub && <p className="mt-0.5 text-[11.5px] text-grey-2">{sub}</p>}
    </Card>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-4 rounded-xl border border-line bg-[#FAFAFB] px-4 py-3 text-[13px] text-grey-2">
    {children}
  </p>
);

const Bad = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-4 rounded-xl border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3 text-[13px] text-[#B42318]">
    {children}
  </p>
);

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
