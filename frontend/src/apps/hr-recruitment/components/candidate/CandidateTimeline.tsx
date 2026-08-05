import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import type { Candidate, HrActivity } from "../../types";

/** Stable per-person tint, matching the board cards so the same face keeps its colour. */
const TINTS = ["blue", "orange", "teal", "green", "navy"];
const tintFor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
};

/** "Monday, 3 August" — the day heading the entries sit under. */
const dayHeading = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

const dayKey = (iso: string) => iso.slice(0, 10);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The token being typed after an `@`, if the caret is inside one.
 *
 * Names contain spaces ("Ravi Kumar"), so the query has to be allowed to contain them
 * — which means it cannot be ended by a space. It is bounded instead by the caller:
 * once nothing matches, the menu closes. That gives the natural behaviour of typing
 * "@Ra" to pick someone and then carrying on writing a sentence without the menu
 * hanging around.
 */
const MENTION_AT = /(?:^|\s)@([^@\n]{0,40})$/;

/**
 * Everything that has happened to one candidate, and everything the team has said
 * about them, in ONE list.
 *
 * WHY ONE LIST AND NOT TWO
 *   The process events and the conversation are the same story — "moved to Round 2"
 *   and "strong on MPLS, weak on documentation" only mean anything next to each
 *   other. Two panels would make the reader interleave them by timestamp in their
 *   head, which is exactly the work a computer should do.
 *
 * WHY THERE IS NO COMMENTS TABLE
 *   `fms_hr_activity` is already "who did what to which entity, with a note". A
 *   comment is one more `type`, so the trail needed no new storage and the two can
 *   never disagree about ordering. Tagged colleagues ride in the row's `meta`.
 */
export default function CandidateTimeline({ candidate: c }: { candidate: Candidate }) {
  const s = useHrStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** People named so far, kept so the text can be turned back into ids on post. */
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const rows = useMemo(
    () => [...s.activityFor("candidate", c.id)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [s, c.id],
  );

  /**
   * Who can be tagged: only people already connected to this vacancy — its hiring
   * managers and requester, anyone who owns a step, and whoever has interviewed them.
   *
   * ⚠ NOT the whole directory. Tagging someone outside this list would send a
   *   notification to a page they are refused entry to, which is a worse outcome than
   *   not being able to tag them: they get told they are needed and then hit a wall.
   *   The list mirrors fms_hr_may_touch_candidate, which is what the RPC enforces.
   */
  const mentionable = useMemo(() => {
    const r = s.requisitionById(c.requisitionId);
    const ids = new Set<string>();
    r?.hiringManagerIds.forEach((id) => ids.add(id));
    if (r?.requesterId) ids.add(r.requesterId);
    s.stepOwners.forEach((o) => o.employeeIds.forEach((id) => ids.add(id)));
    s.interviewsFor(c.id).forEach((iv) => iv.interviewerIds.forEach((id) => ids.add(id)));
    ids.delete(s.userId); // tagging yourself would just mail you your own comment
    return s.profiles
      .filter((p) => ids.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, designation: p.designation ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [s, c.id, c.requisitionId]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.trim().toLowerCase();
    const hit = mentionable.filter((p) => !q || p.name.toLowerCase().includes(q));
    return hit.slice(0, 6);
  }, [query, mentionable]);

  // Reset the highlighted row whenever the shortlist changes under it.
  useEffect(() => setActive(0), [query]);

  /** Re-read the caret and decide whether we are inside an `@…` token. */
  const syncQuery = (value: string, caret: number) => {
    const m = MENTION_AT.exec(value.slice(0, caret));
    setQuery(m ? m[1] : null);
  };

  const onType = (value: string) => {
    setText(value);
    syncQuery(value, boxRef.current?.selectionStart ?? value.length);
  };

  /** Swap the half-typed `@ra` for the full `@Ravi Kumar `, and remember the id. */
  const choose = (p: { id: string; name: string }) => {
    const el = boxRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const m = MENTION_AT.exec(before);
    if (!m) return;
    const start = before.length - m[0].length + m[0].indexOf("@");
    const next = `${text.slice(0, start)}@${p.name} ${text.slice(caret)}`;
    setText(next);
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, { id: p.id, name: p.name }]));
    setQuery(null);
    // Put the caret after the inserted name rather than at the end of the message.
    const pos = start + p.name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    // Enter alone is a newline — a remark is often more than one line.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void post();
    }
  };

  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Only the people whose name SURVIVED in the text are notified — deleting the
      // "@Ravi Kumar" you just inserted has to un-tag him, or the message would quietly
      // mail somebody it no longer mentions.
      const mentions = picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
      await s.postCandidateComment(c.id, text.trim(), [...new Set(mentions)]);
      setText("");
      setPicked([]);
      setQuery(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not post that");
    } finally {
      setBusy(false);
    }
  };

  /** The people named in a comment, as stored on the row. */
  const mentionsOf = (a: HrActivity): string[] => {
    const raw = (a.meta as { mentions?: unknown })?.mentions;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  };

  /** Pick the `@Name` runs out of a posted comment so they read as tags, not text. */
  const renderNote = (note: string, ids: string[]): ReactNode => {
    const names = ids.map((id) => s.personName(id)).filter(Boolean);
    if (names.length === 0) return note;
    // Longest first, so "@Ravi Kumar" wins over a colleague called "@Ravi".
    const alt = names.map(escapeRe).sort((a, b) => b.length - a.length).join("|");
    const parts = note.split(new RegExp(`(@(?:${alt}))`, "g"));
    return parts.map((part, i) =>
      /^@/.test(part) && names.some((n) => part === `@${n}`) ? (
        <span key={i} className="rounded px-0.5 font-semibold text-orange">
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  // Day headings, so a long history reads as a diary rather than a wall.
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: HrActivity[] }[] = [];
    for (const a of rows) {
      const k = dayKey(a.createdAt);
      const last = out[out.length - 1];
      if (last?.key === k) last.rows.push(a);
      else out.push({ key: k, label: dayHeading(a.createdAt), rows: [a] });
    }
    return out;
  }, [rows]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[220px] flex-1 space-y-5 overflow-y-auto pr-1">
        {/* The one event that predates the trail — the CV arriving is what started all this. */}
        <div className="text-center text-[12px] text-grey-2">
          CV received · {formatDateTimeDMY(c.uploadedAt)}
        </div>

        {groups.map((g) => (
          <div key={g.key} className="space-y-3">
            <div className="relative text-center">
              <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
              <span className="relative bg-white px-3 text-[11.5px] font-medium text-grey-2">{g.label}</span>
            </div>

            {g.rows.map((a) =>
              a.type === "comment" ? (
                <div key={a.id} className="flex gap-2.5">
                  <Avatar
                    name={s.personName(a.actorId)}
                    color={tintFor(a.actorId ?? "system")}
                    size={28}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-semibold text-navy">{s.personName(a.actorId)}</span>
                      <span className="text-[11.5px] text-grey-2">{formatDateTimeDMY(a.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-navy">
                      {renderNote(a.note ?? "", mentionsOf(a))}
                    </p>
                  </div>
                </div>
              ) : (
                // System events stay quiet and centred — they are the spine of the
                // thread, not the content of it.
                <div key={a.id} className="text-center text-[12px] text-grey-2">
                  {a.note ?? a.type.replace(/_/g, " ")}
                  {a.actorId && <span className="text-grey-2"> · {s.personName(a.actorId)}</span>}
                  <span className="text-grey-2"> · {formatDateTimeDMY(a.createdAt)}</span>
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      {/* ---------------------------------- composer -------------------------------- */}
      <div className="relative mt-3">
        {/* Opens UPWARD: the composer is pinned to the bottom of the panel, so a menu
            below it would fall off the card. */}
        {query !== null && matches.length > 0 && (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
            {matches.map((p, i) => (
              <button
                key={p.id}
                type="button"
                // mousedown, not click: click fires after blur, by which time the caret
                // position the insert depends on is gone.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                  i === active ? "bg-orange/[0.07]" : "hover:bg-page"
                }`}
              >
                <Avatar name={p.name} color={tintFor(p.id)} size={22} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-navy">{p.name}</span>
                  {p.designation && (
                    <span className="block truncate text-[11px] text-grey-2">{p.designation}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-line bg-page/40 p-2.5">
          <textarea
            ref={boxRef}
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            onClick={(e) => syncQuery(text, e.currentTarget.selectionStart)}
            onBlur={() => setQuery(null)}
            rows={3}
            placeholder="Share a message with your team here. You can use @-mentions to notify individual team members. Remember not to include anything sensitive."
            className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-relaxed text-navy placeholder:text-grey-2 focus:border-orange focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-grey-2">
              {mentionable.length > 0 ? "Type @ to notify someone" : "No colleagues to notify on this vacancy"}
            </span>
            <Button size="sm" onClick={post} disabled={!text.trim() || busy}>
              {busy ? "Posting…" : "Post"}
            </Button>
          </div>
          {err && <p className="mt-1.5 text-[12px] text-ryg-red">{err}</p>}
        </div>
      </div>
    </div>
  );
}
