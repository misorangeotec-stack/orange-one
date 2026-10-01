/**
 * KB-1 · What people asked.
 *
 * The most useful screen in the module and the one with the sharpest edge. It answers
 * "which policies are unclear?" without answering "who is thinking of resigning?", and the
 * second half of that is load-bearing: the log carries no name unless the asker pressed
 * "Send this question to HR". See apps/knowledge-base/data.ts.
 *
 * Two tabs over one list, because "everything" and "the ones we could not answer" are the
 * same rows with a filter, and splitting them into two fetches would let them disagree.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import { formatDateDMY } from "@/shared/lib/date";
import { useSession } from "@/core/platform/session";
import { handbookHref } from "@/core/knowledge-base/data";
import { useAnswerQuestion, useLoggedQuestions, type LoggedQuestion } from "../data";

const ratingLabel = (r: number | null) => (r === 1 ? "Helpful" : r === -1 ? "Not helpful" : "No rating");
const answeredLabel = (q: LoggedQuestion) => (q.covered ? "Answered" : "Not in the handbook");

export default function Questions() {
  const { canEditModule } = useSession();
  const mayEdit = canEditModule("knowledge-base");
  const { data, isLoading } = useLoggedQuestions();
  const answer = useAnswerQuestion();

  const [tab, setTab] = useState<"all" | "unanswered">("all");
  const [reading, setReading] = useState<LoggedQuestion | null>(null);
  const [draft, setDraft] = useState("");

  const all = data ?? [];
  const rows = tab === "unanswered" ? all.filter((q) => !q.covered) : all;

  const columns = useMemo<QueueColumn<LoggedQuestion>[]>(
    () => [
      {
        key: "question",
        header: "Question",
        alwaysVisible: true,
        cell: (q) => (
          <button
            type="button"
            onClick={() => {
              setReading(q);
              setDraft(q.hrAnswer ?? "");
            }}
            className="min-w-[260px] max-w-[460px] text-left font-semibold text-navy hover:text-orange hover:underline"
          >
            {q.question}
          </button>
        ),
        sortValue: (q) => q.question.toLowerCase(),
        filter: { kind: "text", get: (q) => `${q.question} ${q.answer ?? ""}` },
        exportValue: (q) => q.question,
      },
      {
        key: "asked",
        header: "Asked on",
        cell: (q) => <span className="whitespace-nowrap text-grey">{formatDateDMY(q.askedAt)}</span>,
        sortValue: (q) => q.askedAt,
        filter: { kind: "date", get: (q) => q.askedAt },
        exportValue: (q) => formatDateDMY(q.askedAt),
      },
      {
        key: "covered",
        header: "Outcome",
        cell: (q) => (
          <span
            className={
              q.covered
                ? "whitespace-nowrap rounded-full bg-[#EAF7EE] px-2 py-0.5 text-[12px] font-semibold text-[#1F7A3D]"
                : "whitespace-nowrap rounded-full bg-[#FFF1E6] px-2 py-0.5 text-[12px] font-semibold text-[#B45309]"
            }
          >
            {answeredLabel(q)}
          </span>
        ),
        // The badge is the wrong thing to order by: "Answered" would sort above
        // "Not in the handbook" alphabetically, which buries the rows HR came here for.
        sortValue: (q) => (q.covered ? 1 : 0),
        filter: { kind: "select", get: answeredLabel },
        exportValue: answeredLabel,
      },
      {
        key: "rating",
        header: "Rating",
        cell: (q) => <span className="whitespace-nowrap text-grey">{ratingLabel(q.rating)}</span>,
        sortValue: (q) => q.rating ?? 0,
        filter: { kind: "select", get: (q) => ratingLabel(q.rating) },
        exportValue: (q) => ratingLabel(q.rating),
      },
      {
        key: "sources",
        header: "Sources cited",
        align: "right",
        cell: (q) => <span className="text-grey">{q.citedSectionIds.length}</span>,
        sortValue: (q) => q.citedSectionIds.length,
        filter: { kind: "number", get: (q) => q.citedSectionIds.length },
        exportValue: (q) => q.citedSectionIds.length,
      },
      {
        key: "sent",
        header: "Sent to HR",
        cell: (q) => (
          <span className="whitespace-nowrap text-grey">
            {q.sentToHr ? (q.askedByName ?? "Yes") : "No"}
          </span>
        ),
        sortValue: (q) => (q.sentToHr ? 1 : 0),
        // The name only exists where somebody chose to be reachable, so filtering by it is
        // filtering by "who asked HR to reply", not by "who asked what".
        filter: { kind: "select", get: (q) => (q.sentToHr ? (q.askedByName ?? "Sent") : "No") },
        exportValue: (q) => (q.sentToHr ? (q.askedByName ?? "Yes") : "No"),
      },
      {
        key: "hrAnswer",
        header: "HR replied",
        cell: (q) => (
          <span className="whitespace-nowrap text-grey">
            {q.hrAnsweredAt ? formatDateDMY(q.hrAnsweredAt) : "Not replied"}
          </span>
        ),
        sortValue: (q) => q.hrAnsweredAt ?? "",
        filter: { kind: "select", get: (q) => (q.hrAnsweredAt ? "Replied" : "Not replied") },
        exportValue: (q) => (q.hrAnsweredAt ? formatDateDMY(q.hrAnsweredAt) : ""),
      },
    ],
    []
  );

  const unansweredCount = all.filter((q) => !q.covered).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">What people asked</h1>
        <p className="mt-0.5 max-w-3xl text-[13px] text-grey-2">
          Every question put to the Ask HR bubble. Questions are recorded <b>without a name</b>: one
          appears only where the person pressed “Send this question to HR” so you could reply. The
          list is here to show which policies read badly, not who asked.
        </p>
      </div>

      <Tabs
        tabs={[
          { key: "all", label: `All questions (${all.length})` },
          { key: "unanswered", label: `Not in the handbook (${unansweredCount})` },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "all" | "unanswered")}
      />

      {tab === "unanswered" && (
        <p className="max-w-3xl text-[12.5px] text-grey-2">
          These are the gaps. Each one is either something the handbook should cover and does not,
          or something that was never HR's to answer. The first kind is the list for the next
          revision.
        </p>
      )}

      <QueueTable
        rows={rows}
        rowKey={(q) => q.id}
        columns={columns}
        loading={isLoading}
        rowsLabel="questions"
        initialSort={{ key: "asked", dir: "desc" }}
        exportName="handbook-questions"
        exportTitle="Ask HR · questions"
        emptyTitle="Nothing asked yet"
        emptyMessage="Questions put to the Ask HR bubble will appear here."
      />

      <Modal
        open={!!reading}
        onClose={() => setReading(null)}
        title="Question"
        size="lg"
      >
        {reading && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Asked</p>
              <p className="mt-0.5 text-[14px] font-semibold text-navy">{reading.question}</p>
              <p className="mt-1 text-[12px] text-grey-2">
                {formatDateDMY(reading.askedAt)} ·{" "}
                {reading.sentToHr
                  ? `sent to HR by ${reading.askedByName ?? "a colleague"}`
                  : "recorded without a name"}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                What the handbook answered
              </p>
              <p className="mt-0.5 whitespace-pre-line text-[13.5px] leading-relaxed text-grey">
                {reading.answer || "No answer was produced."}
              </p>
              {reading.citedSectionIds.length > 0 && (
                <Link
                  to={handbookHref("")}
                  className="mt-1.5 inline-block text-[12px] font-semibold text-orange hover:underline"
                >
                  Open the handbook
                </Link>
              )}
            </div>

            {reading.sentToHr && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                  Your reply
                </p>
                {mayEdit ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      placeholder="Answer this person directly. They asked to be replied to."
                      className="mt-1 w-full resize-y rounded-xl border border-line px-3 py-2 text-[13px] text-navy outline-none placeholder:text-grey-2 focus:border-orange"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={!draft.trim() || answer.isPending}
                        onClick={() =>
                          answer.mutate(
                            { id: reading.id, answer: draft },
                            { onSuccess: () => setReading(null) }
                          )
                        }
                      >
                        {reading.hrAnswer ? "Update the reply" : "Save the reply"}
                      </Button>
                      {answer.isError && (
                        <span className="text-[12px] text-[#9B2C2C]">
                          {(answer.error as Error).message}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-grey-2">
                      Saving records the reply here. It does not email anyone; this portal sends no
                      mail for the Knowledge Base.
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 whitespace-pre-line text-[13.5px] text-grey">
                    {reading.hrAnswer || "Not replied to yet."}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
