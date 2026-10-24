import { safeHref } from "@/core/announcements/data";

export const HUB_URL = "https://orangeonehub.com";

/**
 * What the `announcement` mail will look like, drawn from the same fields the
 * send-email renderer reads (title, message, link, the hub address). It is a
 * likeness in React, not the mail's HTML: no screen in the portal renders the real
 * template in the browser, and the renderer lives in the Edge Function.
 *
 * Plain text throughout, as in the mail: the poster's words are escaped, never HTML.
 */
export default function EmailPreview({ title, body, link, postedBy }: { title: string; body: string; link: string; postedBy: string }) {
  const href = safeHref(link.trim());
  const subject = title.trim() || "Your title";

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="space-y-0.5 border-b border-line bg-page px-4 py-2.5 text-[12px] text-grey">
        <div><span className="font-semibold text-navy">From:</span> Orange One Hub</div>
        <div className="truncate"><span className="font-semibold text-navy">Subject:</span> {subject}</div>
        <div><span className="font-semibold text-navy">To:</span> each person separately, addressed to them</div>
      </div>
      <div className="bg-[#F4F7FC] p-4">
        <div className="mx-auto max-w-[520px] overflow-hidden rounded-xl bg-white shadow-soft">
          <div className="bg-navy px-5 py-4">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-orange">Announcement</div>
            <div className="mt-1 break-words text-[17px] font-bold leading-snug text-white">{subject}</div>
          </div>
          <div className="space-y-3 px-5 py-4 text-[13.5px] leading-relaxed text-ink">
            <p className="text-[12.5px] text-grey">{postedBy} posted an announcement on Orange One Hub.</p>
            {body.trim() && <p className="whitespace-pre-wrap break-words">{body.trim()}</p>}
            {href && (
              <p className="break-all">
                <span className="font-semibold">Link:</span> <span className="text-orange underline">{href}</span>
              </p>
            )}
            <p>
              Open the hub: <span className="text-orange underline">{HUB_URL}</span>
            </p>
          </div>
          <div className="border-t border-line px-5 py-3 text-[11px] text-grey-2">
            You are getting this because it was posted for you on Orange One Hub. It also shows at the top of every screen until its end date.
          </div>
        </div>
      </div>
    </div>
  );
}
