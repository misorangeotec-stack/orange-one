import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { initials, titleCase } from "./Podium";
import { MIN_STEPS, monthLabel, type Board } from "./data";

/**
 * The whole ladder, for everyone — so each person sees where they stand against every
 * colleague (the user's decision, 18-09-2026). Rank, name, score and steps only: a
 * person's split by process and their step-by-step detail stay their own.
 *
 * Someone under the 10-step minimum is not on the ladder, but they see their own
 * provisional place in it, marked as such, so "where do I stand?" always has an answer.
 *
 * A grid of people, so it sorts on every column and filters under every column like
 * every grid in the portal.
 */
interface Row {
  key: string;
  rank: number;
  name: string;
  score: number;
  given: number;
  isMe: boolean;
  provisional: boolean;
}

export default function Ladder({ board }: { board: Board }) {
  const rows: Row[] = board.ladder.map((r) => ({
    key: `${r.rank}-${r.name}`,
    rank: r.rank,
    name: r.is_me ? "You" : titleCase(r.name),
    score: Number(r.score),
    given: r.given,
    isMe: r.is_me,
    provisional: false,
  }));
  const me = board.me;
  if (me?.provisional_rank != null) {
    rows.push({
      key: "me-provisional",
      rank: me.provisional_rank,
      name: "You",
      score: Number(me.score),
      given: me.given,
      isMe: true,
      provisional: true,
    });
  }

  const columns: QueueColumn<Row>[] = [
    {
      key: "rank",
      header: "#",
      cell: (r) => (
        <span className="font-bold tabular-nums text-ink">
          {r.rank}
          {r.provisional && <span className="ml-1 text-[11px] font-semibold text-orange">provisional</span>}
        </span>
      ),
      sortValue: (r) => r.rank + (r.provisional ? 0.5 : 0),
      filter: { kind: "number", get: (r) => r.rank },
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className={
              "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold " +
              (r.isMe ? "bg-orange text-white" : "bg-page text-ink border border-line")
            }
            aria-hidden="true"
          >
            {r.isMe ? "Me" : initials(r.name)}
          </span>
          <span className={"truncate font-semibold " + (r.isMe ? "text-orange" : "text-ink")}>{r.name}</span>
        </span>
      ),
      sortValue: (r) => r.name,
      filter: { kind: "select", get: (r) => r.name },
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden sm:inline-block h-1.5 w-20 rounded-pill bg-line overflow-hidden" aria-hidden="true">
            <span className="block h-full bg-orange" style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} />
          </span>
          <span className="font-bold tabular-nums text-ink">{r.score.toFixed(1)}</span>
        </span>
      ),
      sortValue: (r) => r.score,
      filter: { kind: "number", get: (r) => r.score },
      exportValue: (r) => r.score,
    },
    {
      key: "given",
      header: "Steps",
      align: "right",
      cell: (r) => <span className="tabular-nums text-grey">{r.given.toLocaleString("en-IN")}</span>,
      sortValue: (r) => r.given,
      filter: { kind: "number", get: (r) => r.given },
    },
  ];

  return (
    <section className="rounded-card-lg bg-white border border-line shadow-soft p-5 sm:p-6" aria-labelledby="rank-ladder-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rank-ladder-title" className="text-[17px] font-bold text-ink">
          The ladder · {monthLabel(board.month)}
        </h2>
        <span className="text-[12.5px] text-grey">
          {board.ladder_size} ranked · {MIN_STEPS} steps in the month to be on it
        </span>
      </div>
      <div className="mt-3">
        <QueueTable
          rows={rows}
          rowKey={(r) => r.key}
          columns={columns}
          rowsLabel="people"
          rowClassName={(r) => (r.isMe ? (r.provisional ? "bg-orange-soft/50 [&>td]:border-dashed" : "bg-orange-soft/70") : "")}
          initialSort={{ key: "rank", dir: "asc" }}
          emptyTitle="Nobody on the ladder yet"
          emptyMessage={`The first person to reach ${MIN_STEPS} steps this month opens it.`}
        />
      </div>
    </section>
  );
}
