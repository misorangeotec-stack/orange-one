/**
 * Customer Onboarding — landing page.
 *
 * Answers three questions in one screen: what is waiting on ME, where is the
 * pipeline stuck, and can I start a new one. Everything else is a click away.
 */
import { Link } from "react-router-dom";
import { UserPlus, ArrowRight, Bell, FileEdit, Inbox, Settings } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { OWNED_STEPS, STEPS, stepTitle } from "@hub/lib/customerOnboarding/steps";
import {
  allHref, detailHref, editHref, mineHref, newHref, queueHref, settingsHref,
} from "@hub/lib/customerOnboarding/routes";
import { dmy, requestSubject } from "@hub/lib/customerOnboarding/format";
import StatusBadge from "@hub/components/customerOnboarding/StatusBadge";

function todayLocalIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function CustomerOnboardingHome() {
  const s = useCustomerStore();
  const today = todayLocalIso();

  if (s.loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading customer onboarding…</div>;
  }
  if (s.error) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-destructive">{s.error}</CardContent></Card>
      </div>
    );
  }

  // Work owed by this user, across every step they own.
  const mine = s.queueEntries.filter((e) => s.canActOn(e.stepKey, e.request));
  const mineOverdue = mine.filter((e) => e.dueIso && e.dueIso < today).length;

  const drafts = s.myDrafts;
  const openTotal = s.queueEntries.length;
  // RLS already scopes fms_customer_notifications to the signed-in user, so
  // there is no "is this mine?" filter to write here — and writing one anyway
  // would be a second place for the rule to be wrong.
  const unread = s.notifications
    .filter((n) => n.readAt === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="p-6 space-y-5 max-w-[1280px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-primary" /> Customer Onboarding
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            From first meeting to a live Tally ledger — {openTotal} request{openTotal === 1 ? "" : "s"} in progress.
          </p>
        </div>
        {s.canRaise && (
          <Button asChild className="gap-2">
            <Link to={newHref()}><UserPlus className="h-4 w-4" /> New customer</Link>
          </Button>
        )}
      </div>

      {/* ── What is waiting on me ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Inbox className="h-4 w-4" /> Waiting on you
            </h2>
            {mineOverdue > 0 && (
              <span className="text-xs font-medium text-destructive">{mineOverdue} overdue</span>
            )}
          </div>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          ) : (
            <ul className="divide-y">
              {mine.slice(0, 8).map((e) => (
                <li key={e.entityId}>
                  <Link
                    to={detailHref(e.entityId)}
                    className="flex items-center justify-between gap-3 py-2.5 group"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-primary">
                        {requestSubject(e.request)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.companyName(e.request.companyId)} · {e.ref} · {stepTitle(e.stepKey)}
                        {e.dueIso && (
                          <span className={e.dueIso < today ? "text-destructive font-medium" : ""}>
                            {" "}· due {dmy(e.dueIso)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {mine.length > 8 && (
            <p className="text-xs text-muted-foreground mt-2">and {mine.length - 8} more…</p>
          )}
        </CardContent>
      </Card>

      {/* ── Where the pipeline stands ─────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {OWNED_STEPS.map((key) => {
          const entries = s.queueFor(key);
          const overdue = entries.filter((e) => e.dueIso && e.dueIso < today).length;
          const step = STEPS.find((x) => x.key === key)!;
          return (
            <Link key={key} to={queueHref(key)}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">{step.title}</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{entries.length}</div>
                  <div className="text-xs mt-1">
                    {overdue > 0
                      ? <span className="text-destructive font-medium">{overdue} overdue</span>
                      : <span className="text-muted-foreground">on time</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* ── For you ───────────────────────────────────────────────────────
          The same rows the topbar bell shows, on the page you land on. The bell
          is unread-only and clears as you read it; this is the second chance for
          anyone who dismissed it, and it costs nothing — the snapshot already
          carries these rows. */}
      {unread.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4" /> For you
            </h2>
            <ul className="divide-y">
              {unread.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <Link to={detailHref(n.entityId)} className="flex items-center justify-between gap-3 py-2.5 group">
                    <div className="min-w-0">
                      <div className="text-sm truncate group-hover:text-primary">{n.text}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.personName(n.actorId)} · {dmy(n.createdAt)}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
            {unread.length > 5 && (
              <p className="text-xs text-muted-foreground mt-2">and {unread.length - 5} more…</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── My unfinished drafts ──────────────────────────────────────── */}
      {drafts.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <FileEdit className="h-4 w-4" /> Your drafts
            </h2>
            <ul className="divide-y">
              {drafts.map((r) => (
                <li key={r.id}>
                  <Link to={editHref(r.id)} className="flex items-center justify-between gap-3 py-2.5 group">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-primary">
                        {requestSubject(r)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.companyName(r.companyId)} · started {dmy(r.createdAt)} · last saved{" "}
                        {dmy(r.updatedAt)}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild><Link to={mineHref()}>My requests</Link></Button>
        <Button variant="outline" size="sm" asChild><Link to={allHref()}>All requests</Link></Button>
        {s.isAdmin && (
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to={settingsHref()}><Settings className="h-3.5 w-3.5" /> Settings</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
