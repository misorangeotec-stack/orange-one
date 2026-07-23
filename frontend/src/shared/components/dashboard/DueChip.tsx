import { formatDate } from "@/shared/lib/time";
import { bucketOf } from "@/shared/lib/dueBuckets";

/**
 * A due date with a Delayed / Today / Tomorrow chip, coloured by the four-way
 * bucket. Takes an already-computed `dueIso` (from an FMS's `lib/queues.ts`), so
 * it can never disagree with the count that surfaced the row. Shared by every FMS
 * home dashboard's "Needs attention" list.
 */
export default function DueChip({ dueIso, todayIso }: { dueIso: string | null; todayIso: string }) {
  if (!dueIso) return <span className="text-grey-2">No date</span>;
  const b = bucketOf(dueIso, todayIso);
  const chip =
    b === "delayed"
      ? { cls: "bg-[#FDECEC] text-ryg-red", text: "Delayed" }
      : b === "today"
        ? { cls: "bg-[#FFF7E6] text-yellow", text: "Today" }
        : b === "tomorrow"
          ? { cls: "bg-page text-grey-2", text: "Tomorrow" }
          : null;
  return (
    <span className={b === "delayed" ? "text-ryg-red font-semibold" : b === "today" ? "text-yellow font-medium" : "text-grey"}>
      {formatDate(dueIso)}
      {chip && (
        <span className={`ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 align-middle ${chip.cls}`}>
          {chip.text}
        </span>
      )}
    </span>
  );
}
