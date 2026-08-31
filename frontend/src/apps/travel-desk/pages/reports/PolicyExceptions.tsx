import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import type { ClaimLine, Trip } from "../../types";

/**
 * Every time the policy was applied and every time it was set aside.
 *
 * ⚠ THIS IS §16's QUARTERLY SPOT CHECK, AND IT IS NOT IN THE SOURCE PRD. The
 *   policy asks for periodic review of violations and exceptions; without a
 *   report the review is somebody reading claims one at a time, which is why it
 *   has never happened.
 *
 * ⚠ THE REPORT EXISTS BECAUSE `allowed_amount` IS NEVER OVERWRITTEN. Finance's
 *   figure lands in `finance_amount` BESIDE the engine's, so the gap between
 *   them is recoverable after the fact. Had Finance edited the engine's answer
 *   in place — the obvious design — there would be nothing here to report, and
 *   the only trace of an exception would be a total that no longer added up.
 *
 * ⚠ THREE KINDS OF ROW, DELIBERATELY IN ONE LIST:
 *     · CAPPED    — the engine cut the line and nobody argued. Ordinary.
 *     · RELAXED   — Finance settled ABOVE the engine's allowance. §7.3's
 *                   exception path, and the row an auditor is looking for.
 *     · TIGHTENED — Finance settled BELOW it. A judgement no rule could make.
 *   Splitting them into three screens would mean the quarterly review is three
 *   reviews, and the interesting comparison — how often is the cap overridden,
 *   and by whom — spans all three.
 */

type Kind = "Capped" | "Relaxed" | "Tightened";

interface Row {
  id: string;
  trip: Trip;
  line: ClaimLine;
  kind: Kind;
  categoryName: string;
  /** Signed: positive means MORE was settled than the engine allowed. */
  delta: number;
  reason: string;
}

export default function PolicyExceptions() {
  const s = useTravelStore();
  const personById = useOrgPersonById();

  const rows = useMemo<Row[]>(() => {
    const catName = new Map(s.expenseCategories.map((c) => [c.id, c.name]));
    const tripById = new Map(s.trips.map((t) => [t.id, t]));
    const out: Row[] = [];

    for (const l of s.claimLines) {
      const trip = tripById.get(l.tripId);
      if (!trip) continue;

      const engine = l.allowedAmount ?? 0;
      const settled = l.financeAmount ?? engine;

      // Nothing to report: the engine allowed it in full and Finance agreed.
      if (l.financeAmount === null && (l.disallowReason ?? "") === "") continue;

      const kind: Kind =
        l.financeAmount === null
          ? "Capped"
          : settled > engine
            ? "Relaxed"
            : settled < engine
              ? "Tightened"
              : "Capped";

      out.push({
        id: l.id,
        trip,
        line: l,
        kind,
        categoryName: l.categoryId ? (catName.get(l.categoryId) ?? "—") : "—",
        delta: settled - engine,
        reason:
          kind === "Capped"
            ? (l.disallowReason ?? "")
            : (l.financeReason ?? ""),
      });
    }
    return out;
  }, [s.claimLines, s.trips, s.expenseCategories]);

  const relaxed = rows.filter((r) => r.kind === "Relaxed");
  const tightened = rows.filter((r) => r.kind === "Tightened");
  const capped = rows.filter((r) => r.kind === "Capped");
  const cappedValue = capped.reduce((sum, r) => sum + (r.line.amount - (r.line.allowedAmount ?? 0)), 0);
  const relaxedValue = relaxed.reduce((sum, r) => sum + r.delta, 0);

  const tiles: KpiTile[] = [
    {
      key: "capped",
      label: "Capped by the engine",
      value: String(capped.length),
      hint: `${money(cappedValue)} not reimbursed`,
    },
    {
      key: "relaxed",
      label: "Relaxed by Finance",
      value: String(relaxed.length),
      hint: `${money(relaxedValue)} allowed above the cap`,
      // The one tile that should catch an auditor's eye, so it is the one that
      // colours. A cap being applied is ordinary; a cap being set aside is not.
      tone: relaxed.length > 0 ? "red" : undefined,
    },
    {
      key: "tightened",
      label: "Tightened by Finance",
      value: String(tightened.length),
      hint: "Cut below what the policy allowed",
    },
    {
      key: "people",
      label: "Travellers involved",
      value: String(new Set(rows.map((r) => r.trip.travellerId)).size),
      hint: "Across every claim on file",
    },
  ];

  const columns = useMemo<QueueColumn<Row>[]>(
    () => [
      {
        key: "kind",
        header: "What happened",
        alwaysVisible: true,
        cell: (r) =>
          r.kind === "Relaxed" ? (
            <span className="font-semibold text-ryg-amber">Relaxed</span>
          ) : r.kind === "Tightened" ? (
            <span className="font-semibold text-navy">Tightened</span>
          ) : (
            <span className="text-grey-2">Capped</span>
          ),
        sortValue: (r) => r.kind,
        filter: { kind: "select", get: (r) => r.kind },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "ref",
        header: "Trip",
        cell: (r) => (
          <Link
            to={`/travel-desk/trips/${r.trip.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
            {r.trip.tripNo ?? "—"}
          </Link>
        ),
        sortValue: (r) => r.trip.tripNo ?? "",
        filter: { kind: "text", get: (r) => r.trip.tripNo ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "traveller",
        header: "Traveller",
        cell: (r) => r.trip.travellerName,
        sortValue: (r) => r.trip.travellerName,
        filter: { kind: "select", get: (r) => r.trip.travellerName },
      },
      {
        key: "category",
        header: "Category",
        cell: (r) => r.categoryName,
        sortValue: (r) => r.categoryName,
        filter: { kind: "select", get: (r) => r.categoryName },
      },
      {
        key: "date",
        header: "Spent on",
        cell: (r) => (r.line.spentOn ? formatDateDMY(r.line.spentOn) : "—"),
        sortValue: (r) => r.line.spentOn ?? "",
        filter: { kind: "date", get: (r) => r.line.spentOn ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "claimed",
        header: "Claimed",
        cell: (r) => money(r.line.amount),
        sortValue: (r) => r.line.amount,
        exportValue: (r) => r.line.amount,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "engine",
        header: "Policy allowed",
        cell: (r) => money(r.line.allowedAmount),
        sortValue: (r) => r.line.allowedAmount ?? 0,
        exportValue: (r) => r.line.allowedAmount ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "settled",
        header: "Settled at",
        cell: (r) => {
          const v = r.line.financeAmount ?? r.line.allowedAmount;
          return r.line.financeAmount !== null ? (
            <span className="font-semibold text-navy">{money(v)}</span>
          ) : (
            <span className="text-grey-2">{money(v)}</span>
          );
        },
        sortValue: (r) => r.line.financeAmount ?? r.line.allowedAmount ?? 0,
        exportValue: (r) => r.line.financeAmount ?? r.line.allowedAmount ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "by",
        header: "Decided by",
        cell: (r) =>
          r.line.financeBy ? (personById(r.line.financeBy)?.name ?? "—") : (
            <span className="text-grey-2">The engine</span>
          ),
        sortValue: (r) => (r.line.financeBy ? (personById(r.line.financeBy)?.name ?? "") : ""),
        filter: {
          kind: "select",
          get: (r) => (r.line.financeBy ? (personById(r.line.financeBy)?.name ?? "—") : "The engine"),
        },
      },
      {
        key: "evidence",
        header: "§7.3 evidence",
        cell: (r) =>
          r.line.overCapEvidence && r.line.hodApproved ? (
            "Evidence + HOD"
          ) : r.line.overCapEvidence ? (
            <span className="text-ryg-amber">Evidence only</span>
          ) : r.line.hodApproved ? (
            <span className="text-ryg-amber">HOD only</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (r) => Number(r.line.overCapEvidence) + Number(r.line.hodApproved),
        filter: {
          kind: "select",
          get: (r) =>
            r.line.overCapEvidence && r.line.hodApproved
              ? "Evidence + HOD"
              : r.line.overCapEvidence
                ? "Evidence only"
                : r.line.hodApproved
                  ? "HOD only"
                  : "Neither",
        },
      },
      {
        key: "reason",
        header: "Reason",
        cell: (r) => <span className="text-[12px] text-grey-2">{r.reason || "—"}</span>,
        sortValue: (r) => r.reason,
        // ⚠ NO FILTER, DELIBERATELY. Every reason is a free-text sentence
        //   written once for one line, so a dropdown here would list the rows
        //   back at the reader one at a time — which is the case CLAUDE.md
        //   names as the exception to "every column filters".
      },
    ],
    [personById],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Policy exceptions</h1>
        <p className="text-[13px] text-grey">
          Every claim line the policy cut, and every one a human then decided differently. §16 asks
          for a periodic review of exceptions; this is the list it reviews.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {relaxed.length > 0 && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">
            {relaxed.length} line{relaxed.length === 1 ? " was" : "s were"} settled above what the
            policy allows
          </div>
          <p className="mt-1 text-[12.5px] text-grey-2">
            §7.3 permits this on evidence that nothing within cap was available plus HOD approval,
            and never above 1.5× the cap. The §7.3 evidence column shows which of the two is on
            file — a row reading &ldquo;HOD only&rdquo; or &ldquo;Evidence only&rdquo; is an
            exception that was granted without the whole of its basis.
          </p>
        </Card>
      )}

      <QueueTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="lines"
        emptyTitle="No exceptions yet"
        emptyMessage="A line appears here when the policy caps it, or when Finance settles it at a different figure. An empty list means every claim so far has been within policy and nobody has overridden anything."
        loading={s.isLoading}
        initialSort={{ key: "kind", dir: "asc" }}
        exportName="Travel_Policy_Exceptions"
        columnPicker={{ storageKey: "travel-report-exceptions" }}
      />
    </div>
  );
}
