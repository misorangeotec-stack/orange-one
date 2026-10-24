import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import SettingToggle from "@/shared/components/ui/SettingToggle";
import Tabs from "@/shared/components/ui/Tabs";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import MyStepsModal from "./MyStepsModal";
import { titleCase } from "./Podium";
import { moduleName, useRankAdmin, type Board, type LadderRow, type NotRanked } from "./data";

/**
 * What only an admin sees: everyone's standing, who is left out and why, which
 * processes count, and what the last run dropped. Exclusions and module switches
 * re-score the running month on the server at once; a frozen month never moves.
 */
const STATUS: Record<NotRanked | "ranked", string> = {
  ranked: "Ranked",
  admin: "Admin, not ranked",
  excluded: "Left out",
  external: "Customer account",
  under_minimum: "Under 10 steps",
};

export default function AdminRanking({ board }: { board: Board }) {
  const [tab, setTab] = useState("ladder");
  // Admins may read anyone's steps; the server refuses it to everyone else.
  const [stepsOf, setStepsOf] = useState<LadderRow | null>(null);
  const admin = board.admin!;
  const ranked = admin.ladder.filter((r) => r.ranked).length;

  return (
    <details className="group rounded-card-lg bg-white border border-line shadow-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 sm:px-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange rounded-card-lg">
        <span>
          <span className="text-[17px] font-bold text-ink">Admin · everyone on the ladder</span>
          <span className="ml-2 text-[13px] text-grey">
            {ranked} ranked · {admin.ladder.length - ranked} not · {admin.exclusions.length} left out
          </span>
        </span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-grey transition-transform group-open:rotate-180" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line px-5 pb-6 sm:px-6">
        <Tabs
          tabs={[
            { key: "ladder", label: "Full ladder", count: admin.ladder.length },
            { key: "excluded", label: "Left out", count: admin.exclusions.length },
            { key: "modules", label: "Processes that count" },
            { key: "run", label: "Last run" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="pt-4">
          {tab === "ladder" && <Ladder rows={admin.ladder} month={board.month} onSteps={setStepsOf} />}
          {tab === "excluded" && <Exclusions board={board} />}
          {tab === "modules" && <Modules board={board} />}
          {tab === "run" && <LastRun board={board} />}
        </div>
      </div>
      <MyStepsModal
        month={board.month}
        open={!!stepsOf}
        onClose={() => setStepsOf(null)}
        user={stepsOf?.user_id ?? null}
        name={stepsOf ? titleCase(stepsOf.name) : null}
      />
    </details>
  );
}

function Ladder({ rows, month, onSteps }: { rows: LadderRow[]; month: string; onSteps: (r: LadderRow) => void }) {
  const status = (r: LadderRow) => STATUS[r.not_ranked ?? "ranked"];
  const processes = (r: LadderRow) =>
    Object.entries(r.by_module)
      .sort((a, b) => b[1].given - a[1].given)
      .map(([k]) => moduleName(k))
      .join(", ");
  const columns: QueueColumn<LadderRow>[] = [
    { key: "rank", header: "#", cell: (r) => (r.rank ? <strong className="tabular-nums">{r.rank}</strong> : <span className="text-grey-2">—</span>), sortValue: (r) => r.rank ?? 9999, filter: { kind: "number", get: (r) => r.rank ?? 0 } },
    { key: "name", header: "Name", cell: (r) => <span className="font-semibold text-ink">{titleCase(r.name)}</span>, sortValue: (r) => r.name, filter: { kind: "select", get: (r) => titleCase(r.name) } },
    { key: "score", header: "Score", align: "right", cell: (r) => <span className="font-semibold tabular-nums">{Number(r.score).toFixed(1)}</span>, sortValue: (r) => Number(r.score), filter: { kind: "number", get: (r) => Number(r.score) } },
    { key: "given", header: "Steps", align: "right", cell: (r) => r.given.toLocaleString("en-IN"), sortValue: (r) => r.given, filter: { kind: "number", get: (r) => r.given } },
    { key: "on", header: "On time", align: "right", cell: (r) => r.on_time.toLocaleString("en-IN"), sortValue: (r) => r.on_time, filter: { kind: "number", get: (r) => r.on_time } },
    { key: "late", header: "Late", align: "right", cell: (r) => r.late.toLocaleString("en-IN"), sortValue: (r) => r.late, filter: { kind: "number", get: (r) => r.late } },
    { key: "missed", header: "Missed", align: "right", cell: (r) => r.missed.toLocaleString("en-IN"), sortValue: (r) => r.missed, filter: { kind: "number", get: (r) => r.missed } },
    { key: "points", header: "Points", align: "right", cell: (r) => Number(r.points).toLocaleString("en-IN"), sortValue: (r) => Number(r.points), filter: { kind: "number", get: (r) => Number(r.points) } },
    { key: "status", header: "Status", cell: (r) => <span className={r.ranked ? "text-ink" : "text-grey"}>{status(r)}</span>, sortValue: status, filter: { kind: "select", get: status } },
    { key: "processes", header: "Processes", cell: (r) => <span className="text-grey">{processes(r)}</span>, sortValue: processes, filter: { kind: "text", get: processes } },
  ];
  return (
    <QueueTable
      rows={rows}
      rowKey={(r) => r.user_id}
      columns={columns}
      actions={(r) => (
        <button
          type="button"
          onClick={() => onSteps(r)}
          className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink hover:border-orange hover:text-orange"
        >
          Steps
        </button>
      )}
      rowsLabel="people"
      emptyTitle="Nobody scored yet"
      emptyMessage="The ladder fills in after the first nightly run of the month."
      exportName={`FMS_ranking_${month.slice(0, 7)}`}
    />
  );
}

function Exclusions({ board }: { board: Board }) {
  const admin = board.admin!;
  const { exclude, include } = useRankAdmin();
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const out = new Set(admin.exclusions.map((e) => e.user_id));
  const options = useMemo(
    () => admin.people.filter((p) => !out.has(p.user_id)).map((p) => ({ value: p.user_id, label: titleCase(p.name) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admin.people, admin.exclusions],
  );
  const busy = exclude.isPending || include.isPending;
  const err = (exclude.error ?? include.error) as Error | null;

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] text-grey max-w-[70ch]">
        Admins are never ranked. Leave out anyone else who should not be: a shared login several people work under,
        or a developer or test account. It takes effect on this month at once; a finished month is frozen and keeps
        its ladder.
      </p>

      <ul className="divide-y divide-line rounded-xl border border-line">
        {admin.exclusions.length === 0 && <li className="px-4 py-4 text-[13.5px] text-grey">Nobody is left out.</li>}
        {admin.exclusions.map((e) => (
          <li key={e.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">{titleCase(e.name)}</span>
              <span className="block text-[12.5px] text-grey">
                {e.reason} · {e.added_by ? `by ${titleCase(e.added_by)}, ` : ""}
                {formatDate(e.added_at)}
              </span>
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => include.mutate(e.user_id)}>
              Put back on the ladder
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr_auto] sm:items-end"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!who || !reason.trim()) return;
          exclude.mutate({ userId: who, reason: reason.trim() }, { onSuccess: () => { setWho(""); setReason(""); } });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Person</span>
          <Combobox value={who} onChange={setWho} options={options} placeholder="Choose someone" searchable />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-ink">Why</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. shared login used by the whole lab"
            className="w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] text-ink focus:border-orange focus:outline-none"
          />
        </label>
        <Button type="submit" size="sm" disabled={busy || !who || !reason.trim()}>
          Leave out
        </Button>
      </form>
      {err && <p className="text-[13px] text-ryg-red">{err.message}</p>}
    </div>
  );
}

function Modules({ board }: { board: Board }) {
  const { setModule } = useRankAdmin();
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] text-grey max-w-[70ch]">
        A process switched off counts for nobody. Use it for a process not in real use yet, so a few test entries
        cannot move anyone's score. Switching changes this month straight away; finished months stay as they froze.
      </p>
      <div className="divide-y divide-line rounded-xl border border-line">
        {board.admin!.modules.map((m) => (
          <div key={m.module} className="px-4 py-3">
            <SettingToggle
              checked={m.active}
              disabled={setModule.isPending}
              onChange={(v) => setModule.mutate({ module: m.module, active: v })}
              label={moduleName(m.module)}
              hint={
                [m.note, m.changed_by ? `Last changed by ${titleCase(m.changed_by)} on ${formatDate(m.changed_at)}` : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
          </div>
        ))}
      </div>
      {setModule.error && <p className="text-[13px] text-ryg-red">{(setModule.error as Error).message}</p>}
    </div>
  );
}

interface RunRow {
  module: string;
  rows: number;
  scored: number;
  missed: number;
  dropped: string;
  at: string;
}

const DROP_LABEL: Record<string, string> = {
  untimed: "no due date",
  no_actor: "nobody recorded as closing it",
  no_time: "no closing time recorded",
  test_record: "test record",
  held: "on hold",
  excluded_step: "step left out by rule",
};

function LastRun({ board }: { board: Board }) {
  const rows: RunRow[] = Object.entries(board.admin!.run ?? {}).map(([module, s]) => ({
    module: moduleName(module),
    rows: s.rows ?? 0,
    scored: s.scoredClosed ?? 0,
    missed: s.missedCharges ?? 0,
    dropped: Object.entries(s.dropped ?? {})
      .map(([k, n]) => `${n} ${DROP_LABEL[k] ?? k}`)
      .join(", "),
    at: s.at ?? "",
  }));
  const columns: QueueColumn<RunRow>[] = [
    { key: "module", header: "Process", cell: (r) => <span className="font-semibold text-ink">{r.module}</span>, sortValue: (r) => r.module, filter: { kind: "select", get: (r) => r.module } },
    { key: "rows", header: "Rows written", align: "right", cell: (r) => r.rows.toLocaleString("en-IN"), sortValue: (r) => r.rows, filter: { kind: "number", get: (r) => r.rows } },
    { key: "scored", header: "Closed & scored", align: "right", cell: (r) => r.scored.toLocaleString("en-IN"), sortValue: (r) => r.scored, filter: { kind: "number", get: (r) => r.scored } },
    { key: "missed", header: "Overdue charges", align: "right", cell: (r) => r.missed.toLocaleString("en-IN"), sortValue: (r) => r.missed, filter: { kind: "number", get: (r) => r.missed } },
    { key: "dropped", header: "Counted for nobody", cell: (r) => <span className="text-grey">{r.dropped || "—"}</span>, sortValue: (r) => r.dropped, filter: { kind: "text", get: (r) => r.dropped } },
    { key: "at", header: "Written", cell: (r) => formatDateTime(r.at), sortValue: (r) => r.at, filter: { kind: "date", get: (r) => r.at } },
  ];
  return (
    <QueueTable
      rows={rows}
      rowKey={(r) => r.module}
      columns={columns}
      rowsLabel="processes"
      emptyTitle="No run yet"
      emptyMessage="Nothing has been written for this month."
    />
  );
}
