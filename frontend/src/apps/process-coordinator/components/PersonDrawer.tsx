import { useEffect, useMemo, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import DueCell from "@/shared/components/ui/DueCell";
import { cn } from "@/shared/lib/cn";
import { appName } from "@/apps/appInfo";
import { useOpenWorkItem } from "@/core/workspace/WorkPanel";
import type { BucketCounts, CallBucket, PersonItem, PersonWork } from "../data/peopleWork";
import { reminderText, waNumber } from "../lib/callText";

const BUCKET_LABEL: Record<CallBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  next2: "Next 2 days",
  noDate: "No date",
  hold: "On hold",
};

/**
 * One person, everything they owe, and the three ways to reach them.
 *
 * A right-hand drawer rather than a page, so the coordinator works down the Call
 * List without losing her place: open, ring, close, next.
 *
 * Each item's "Open" goes through `useOpenWorkItem` — the same side panel My
 * Control Center uses — so the coordinator lands on the FMS's own page for that
 * row (with its own permission checks), and Back returns here.
 */
export default function PersonDrawer({
  row,
  todayIso,
  onClose,
}: {
  row: PersonWork | null;
  todayIso: string;
  onClose: () => void;
}) {
  const openItem = useOpenWorkItem();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!row) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  const groups = useMemo(() => {
    if (!row) return [];
    const by = new Map<string, PersonItem[]>();
    for (const it of row.items) by.set(it.appId, [...(by.get(it.appId) ?? []), it]);
    // Modules with the most overdue first — that is where the call starts.
    return [...by.entries()].sort(
      (a, b) =>
        (row.byModule.get(b[0])?.overdue ?? 0) - (row.byModule.get(a[0])?.overdue ?? 0) ||
        b[1].length - a[1].length,
    );
  }, [row]);

  if (!row) return null;

  const { person, contact } = row;
  const wa = waNumber(contact.phone);
  const message = reminderText(row, todayIso);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={`${person.name}'s pending FMS work`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[620px] flex-col bg-white shadow-2xl"
      >
        {/* ── who, and how to reach them ─────────────────────────────── */}
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <Avatar name={person.name} color={person.avatarColor} size={44} />
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-bold text-navy">{person.name}</div>
              <div className="text-[12.5px] text-grey">
                {[person.designation, person.department, person.subDepartment].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-grey-2 transition hover:bg-page hover:text-navy"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {contact.phone ? (
              <a href={`tel:${contact.phone}`} className={pill("primary")}>
                <PhoneIcon /> Call {contact.phone}
              </a>
            ) : (
              <span className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12.5px] italic text-grey-2">
                No phone number on file
              </span>
            )}
            {wa ? (
              <a
                href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className={pill()}
              >
                <ChatIcon /> WhatsApp reminder
              </a>
            ) : null}
            {contact.email ? (
              <a
                href={`mailto:${contact.email}?subject=${encodeURIComponent("Pending FMS steps")}&body=${encodeURIComponent(message)}`}
                className={pill()}
              >
                <MailIcon /> Email
              </a>
            ) : null}
            <button type="button" onClick={copy} className={pill()}>
              <CopyIcon /> {copied ? "Copied" : "Copy reminder"}
            </button>
          </div>

          <CountStrip counts={row.counts} />
        </div>

        {/* ── what they owe, module by module ────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {groups.map(([appId, items]) => (
              <section key={appId}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="text-[14px] font-bold text-navy">{appName(appId)}</h3>
                  <ModuleCounts counts={row.byModule.get(appId)} />
                </div>
                <ul className="divide-y divide-line/70 rounded-xl border border-line">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className={cn(
                        "flex items-start justify-between gap-3 px-3 py-2.5",
                        it.bucket === "overdue" && "bg-[#FDECEC]/40",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-navy">{it.ref}</div>
                        <div className="text-[12px] text-grey">
                          {[it.stage, it.detail].filter(Boolean).join(" · ")}
                          {it.assignment === "team" ? (
                            <span className="ml-1.5 rounded-full bg-page px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
                              shared step
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[12px]">
                          {it.bucket === "hold" ? (
                            <span className="font-medium text-grey">
                              {it.holdLabel ?? "On hold"}
                              {it.holdReason ? ` — ${it.holdReason}` : ""}
                            </span>
                          ) : (
                            <DueCell dueIso={it.dueIso} />
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          openItem(it);
                        }}
                        className="shrink-0 rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-navy transition hover:border-orange hover:text-orange"
                      >
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function CountStrip({ counts }: { counts: BucketCounts }) {
  const order: CallBucket[] = ["overdue", "today", "next2", "noDate", "hold"];
  return (
    <div className="mt-3 grid grid-cols-5 gap-2">
      {order.map((b) => (
        <div key={b} className="rounded-lg border border-line bg-page/60 px-2 py-1.5 text-center">
          <div className={cn("text-[17px] font-bold tabular-nums", b === "overdue" && counts[b] > 0 ? "text-ryg-red" : "text-navy")}>
            {counts[b]}
          </div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">{BUCKET_LABEL[b]}</div>
        </div>
      ))}
    </div>
  );
}

function ModuleCounts({ counts }: { counts: BucketCounts | undefined }) {
  if (!counts) return null;
  const bits: string[] = [];
  if (counts.overdue) bits.push(`${counts.overdue} overdue`);
  if (counts.today) bits.push(`${counts.today} today`);
  if (counts.next2) bits.push(`${counts.next2} next 2 days`);
  if (counts.noDate) bits.push(`${counts.noDate} no date`);
  if (counts.hold) bits.push(`${counts.hold} on hold`);
  return <span className={cn("text-[12px]", counts.overdue ? "font-semibold text-ryg-red" : "text-grey")}>{bits.join(" · ")}</span>;
}

const pill = (tone?: "primary") =>
  cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition",
    tone === "primary"
      ? "bg-orange text-white hover:bg-orange/90"
      : "border border-line bg-white text-navy hover:border-orange hover:text-orange",
  );

const ico = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const PhoneIcon = () => (
  <svg {...ico}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);
const ChatIcon = () => (
  <svg {...ico}>
    <path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z" />
  </svg>
);
const MailIcon = () => (
  <svg {...ico}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
const CopyIcon = () => (
  <svg {...ico}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);
