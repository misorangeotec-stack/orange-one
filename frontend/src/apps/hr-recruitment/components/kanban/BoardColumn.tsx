import type { ReactNode } from "react";
import type { BoardColumnDef, BoardIconKey } from "../../lib/board";

/**
 * One column of the candidate board.
 *
 * Extracted from CandidateBoard so the shell (header, count, drop-target state,
 * its own scroll) is described once. The cards themselves are passed in as
 * children — the column knows nothing about candidates, only about being a place
 * you can drop one.
 *
 * The body scrolls independently rather than the page: with ten columns, a long
 * Resumes list used to push every other column's header off screen, which is
 * exactly the header you need to aim at while dragging.
 */

const ICONS: Record<BoardIconKey, ReactNode> = {
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  check: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  "user-check": (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  gift: (
    <>
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
    </>
  ),
};

export default function BoardColumn({
  column,
  count,
  overdue,
  isHover,
  droppable,
  onDragOver,
  onDragLeave,
  onDrop,
  onAdd,
  children,
}: {
  column: BoardColumnDef;
  count: number;
  overdue: number;
  isHover: boolean;
  droppable: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex w-[300px] shrink-0 flex-col rounded-xl border bg-white transition ${
        isHover
          ? "border-orange ring-2 ring-orange/20"
          : droppable
            ? "border-dashed border-orange/40"
            : "border-line"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-grey-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[column.icon]}
        </svg>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-navy">{column.label}</span>
        {overdue > 0 && (
          <span
            className="rounded-full bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-semibold text-ryg-red"
            title={`${overdue} overdue`}
          >
            {overdue}
          </span>
        )}
        <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-grey-2">{count}</span>
        {onAdd && (
          <button
            onClick={onAdd}
            aria-label={`Add to ${column.label}`}
            className="rounded-md px-1.5 py-0.5 text-[15px] leading-none text-grey-2 hover:bg-page hover:text-orange"
          >
            +
          </button>
        )}
      </div>

      <div className="flex max-h-[calc(100vh-300px)] min-h-[80px] flex-col gap-2 overflow-y-auto p-2">
        {children}
        {count === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-grey-2">
            Empty
          </div>
        )}
      </div>
    </div>
  );
}
