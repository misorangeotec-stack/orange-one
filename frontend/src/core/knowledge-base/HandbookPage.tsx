/**
 * KB-1 · `/handbook/read` — the HR handbook, open to every member of staff.
 *
 * Reached from the "HR Handbook" row under Home in the sidebar (core/workspace/homeNav.tsx),
 * from "Open the handbook" in the Ask HR bubble, and from any citation chip in an answer.
 * A section also has its own URL, so HR can paste "here is the bit that answers you" into
 * an email.
 *
 * ⚠ This page WAS deliberately in no menu (KB-1 §0), on the reasoning that the way in is
 * the floating bubble. Reversed on 30-09-2026: not being able to simply browse the manual
 * was the first thing raised once the module went in front of anyone. ASKING is still not
 * a menu item, and should not become one.
 *
 * Staff furniture, like `/account`, `/announcements` and `/my-probation` (App.tsx): wrapped
 * in RequireAuth + StaffOnly, wearing the home shell, with NO module grant. The handbook is
 * issued to every employee at joining; gating it would defeat the point. Customers never
 * reach it, and the database says so too.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import HandbookPane from "./HandbookPane";
import { useHandbook } from "./data";

/** The bit after the "#", with the "#" gone. */
const anchorOf = (hash: string) => (hash.startsWith("#") ? hash.slice(1) : hash) || null;

export default function HandbookPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { data: hb } = useHandbook();
  const [anchor, setAnchor] = useState<string | null>(anchorOf(hash));

  // Follow the URL, including the back button and a link pasted into the address bar.
  useEffect(() => {
    setAnchor(anchorOf(hash));
  }, [hash]);

  const onAnchorChange = useCallback(
    (a: string) => {
      setAnchor(a);
      // `replace`, not push: jumping around inside a document should not fill the back
      // button with thirty steps the reader has to press their way out of.
      navigate({ hash: `#${a}` }, { replace: true });
    },
    [navigate]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">{hb?.title ?? "HR Handbook"}</h1>
        <p className="mt-0.5 text-[13px] text-grey-2">
          The whole manual. Use the Ask HR button at the bottom of any screen to ask a question in
          your own words instead of looking for it.
        </p>
      </div>

      <Card className="h-[calc(100vh-13rem)] min-h-[440px] overflow-hidden p-0">
        <HandbookPane anchor={anchor} onAnchorChange={onAnchorChange} />
      </Card>
    </div>
  );
}
