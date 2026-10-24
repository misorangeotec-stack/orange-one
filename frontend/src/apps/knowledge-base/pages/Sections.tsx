/**
 * KB-1 · Notes on sections.
 *
 * A note is for one thing only: a place where the handbook FAILS TO FLAG ITS OWN PROBLEM.
 * Chapter 32 already says in its own words that its rates await Director sign-off, so it
 * needs nothing from us. But nothing anywhere says that Chapter 15 and Chapter 32 are two
 * different travel policies, or that §2's two band tables disagree, and a reader is about to
 * book a hotel on one of them. Those are the notes.
 *
 * Whatever is written here is quoted by the Ask HR answer whenever it cites that section,
 * and shown as a callout in the handbook. So this screen is the one place in the module
 * where a few words change what every future answer says.
 *
 * It is a ROW EDIT, NOT A DEPLOY. The day the Directors sign, someone clears three notes
 * here and the answers change on the next question. The ingest carries notes forward by
 * anchor, so a re-publish of the handbook does not lose them.
 */
import { useMemo, useState } from "react";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { handbookHref, useHandbook, type HandbookSection } from "@/core/knowledge-base/data";
import { useSetSectionNote } from "../data";

export default function Sections() {
  const { canEditModule } = useSession();
  const mayEdit = canEditModule("knowledge-base");
  const { data: hb, isLoading } = useHandbook();
  const setNote = useSetSectionNote();

  const [editing, setEditing] = useState<HandbookSection | null>(null);
  const [draft, setDraft] = useState("");

  const rows = hb?.sections ?? [];

  const columns = useMemo<QueueColumn<HandbookSection>[]>(
    () => [
      {
        key: "section",
        header: "Section",
        alwaysVisible: true,
        cell: (s) => (
          <button
            type="button"
            onClick={() => {
              setEditing(s);
              setDraft(s.note ?? "");
            }}
            className="min-w-[300px] max-w-[560px] text-left text-navy hover:text-orange hover:underline"
          >
            {s.pathText}
          </button>
        ),
        sortValue: (s) => s.ordinal,
        filter: { kind: "text", get: (s) => s.pathText },
        exportValue: (s) => s.pathText,
      },
      {
        key: "chapter",
        header: "Chapter",
        cell: (s) => <span className="text-grey">{s.pathText.split(" › ")[0]}</span>,
        sortValue: (s) => s.ordinal,
        filter: { kind: "select", get: (s) => s.pathText.split(" › ")[0] },
        exportValue: (s) => s.pathText.split(" › ")[0],
      },
      {
        key: "depth",
        header: "Level",
        cell: (s) => <span className="text-grey">{s.depth}</span>,
        sortValue: (s) => s.depth,
        filter: { kind: "select", get: (s) => String(s.depth) },
        exportValue: (s) => s.depth,
      },
      {
        key: "note",
        header: "Note shown with every answer",
        // Clamped to two lines: a note runs to several sentences, and printed in full it made
        // one row 370px tall and put two rows on a screen. The whole note is in the modal,
        // which is where it is edited anyway.
        //
        // ⚠ NO `block` HERE. `line-clamp-2` works by setting `display: -webkit-box`, so a
        // `block` alongside it wins and the clamp silently does nothing. That is what the
        // first attempt did, and the rows stayed tall. Same shape of trap as `cn` not
        // merging Tailwind: two classes setting one property, and the loser is invisible.
        cell: (s) =>
          s.note ? (
            <span className="line-clamp-2 min-w-[17rem] max-w-[28rem] text-[12.5px] leading-snug text-[#8A4B16]">
              {s.note}
            </span>
          ) : (
            <span className="text-grey-2">None</span>
          ),
        sortValue: (s) => (s.note ? 0 : 1),
        filter: { kind: "select", get: (s) => (s.note ? "Has a note" : "No note") },
        exportValue: (s) => s.note ?? "",
      },
    ],
    []
  );

  const noted = rows.filter((s) => s.note).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Notes on sections</h1>
        <p className="mt-0.5 max-w-3xl text-[13px] text-grey-2">
          A note is quoted by the answer whenever that section is cited, and shown in the handbook
          itself. Use it only where the handbook does not warn about its own problem, such as the
          two travel chapters that disagree. Clearing a note takes effect on the next question, with
          no deploy. <b>{noted}</b> {noted === 1 ? "section carries" : "sections carry"} one today.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(s) => s.id}
        columns={columns}
        loading={isLoading}
        rowsLabel="sections"
        initialSort={{ key: "note", dir: "asc" }}
        exportName="handbook-sections"
        exportTitle="HR handbook · sections"
        emptyTitle="No handbook published"
        emptyMessage="Publish the handbook first with: npm run handbook -- --publish"
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Note on this section" size="lg">
        {editing && (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Section</p>
              <p className="mt-0.5 text-[14px] font-semibold text-navy">{editing.pathText}</p>
              <a
                href={handbookHref(editing.anchor)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[12px] font-semibold text-orange hover:underline"
              >
                Read it in the handbook
              </a>
            </div>

            {mayEdit ? (
              <>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                    Note
                  </p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={5}
                    placeholder="What does the handbook fail to say about itself here? Leave empty for no note."
                    className="mt-1 w-full resize-y rounded-xl border border-line px-3 py-2 text-[13px] text-navy outline-none placeholder:text-grey-2 focus:border-orange"
                  />
                  <p className="mt-1.5 text-[11.5px] text-grey-2">
                    Every answer citing this section will lead with these words. Keep it to what a
                    reader needs before they act.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={setNote.isPending}
                    onClick={() =>
                      setNote.mutate(
                        { sectionId: editing.id, note: draft },
                        { onSuccess: () => setEditing(null) }
                      )
                    }
                  >
                    {draft.trim() ? "Save the note" : "Clear the note"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  {setNote.isError && (
                    <span className="text-[12px] text-[#9B2C2C]">
                      {(setNote.error as Error).message}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Note</p>
                <p className="mt-0.5 whitespace-pre-line text-[13.5px] text-grey">
                  {editing.note || "No note on this section."}
                </p>
                <p className="mt-2 text-[11.5px] text-grey-2">
                  You have view-only access to the Knowledge Base, so you can read the notes but not
                  change them.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
