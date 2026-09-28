import { Link } from "react-router-dom";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { formatDateDMY } from "@/shared/lib/date";
import { ANNOUNCEMENTS_PATH, dmy, safeHref, STATUS_LABEL, type AnnouncementStatus } from "./data";

/** The fields any caller has; the history and manage rows carry more, and pass them. */
export interface ReadableAnnouncement {
  title: string;
  body: string | null;
  link_url: string | null;
  ends_on: string;
  created_at: string;
  status?: AnnouncementStatus;
  posted_by?: string | null;
}

/**
 * The full text of one announcement.
 *
 * ⚠ PLAIN TEXT ONLY. The poster's words reach every member of staff, so they are
 *   rendered as React text children — escaped — with the line breaks kept by CSS
 *   (`whitespace-pre-wrap`), never as HTML. The link is rendered only if it is
 *   http(s), opens in a new tab, and carries `noopener noreferrer`.
 */
export default function AnnouncementReader({
  announcement: a,
  open,
  onClose,
  onDismiss,
  showHistoryLink = true,
}: {
  announcement: ReadableAnnouncement | null;
  open: boolean;
  onClose: () => void;
  /** Offered from the strip only: close it for me, as the ✕ does. */
  onDismiss?: () => void;
  showHistoryLink?: boolean;
}) {
  if (!a) return null;
  const href = safeHref(a.link_url);
  const when =
    a.status && a.status !== "running"
      ? `${STATUS_LABEL[a.status]} · posted ${formatDateDMY(a.created_at)}`
      : `Posted ${formatDateDMY(a.created_at)} · showing until ${dmy(a.ends_on)}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={a.title}
      subtitle={a.posted_by ? `${when} · by ${a.posted_by}` : when}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          {showHistoryLink && (
            <Link to={ANNOUNCEMENTS_PATH} onClick={onClose} className="text-[13px] font-semibold text-grey hover:text-orange mr-auto">
              All announcements
            </Link>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Don't show again
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {a.body ? (
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{a.body}</p>
      ) : (
        !href && <p className="text-[14px] text-grey">There is nothing more to this announcement than its title.</p>
      )}
      {href && (
        <p className={a.body ? "mt-4" : ""}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 break-all text-[14px] font-semibold text-orange hover:underline"
          >
            {href}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </p>
      )}
    </Modal>
  );
}
