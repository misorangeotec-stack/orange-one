/**
 * The rep's own view: drafts they can resume, requests in flight, and what
 * happened to the rest.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FileEdit, Trash2, UserPlus } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@hub/components/ui/alert-dialog";
import { useToast } from "@hub/hooks/use-toast";
import RequestTable from "@hub/components/customerOnboarding/RequestTable";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { detailHref, editHref, newHref } from "@hub/lib/customerOnboarding/routes";
import { dmy, requestSubject } from "@hub/lib/customerOnboarding/format";
import {
  colCustomer, colDue, colGst, colPlace, colRaisedOn, colRef, colRequestedLimit,
  colStatus, colWaitingOn,
} from "./columns";

export default function MyRequests() {
  const s = useCustomerStore();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const drafts = s.myDrafts;
  const mine = s.myRequests;
  const inFlight = mine.filter((r) => s.openStepOf(r) !== null || r.status === "on_hold");
  const done = mine.filter((r) => s.openStepOf(r) === null && r.status !== "on_hold");

  const draftToDelete = deleting ? s.requestById(deleting) : undefined;

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      // ⚠ Files first — storage does not cascade from the table, so deleting the
      //   row first would strand any uploads in a private bucket forever.
      await s.writes.removeCustomerDocs(deleting);
      await s.writes.deleteDraft(deleting);
      await s.refresh();
      toast({ title: "Draft deleted" });
      setDeleting(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not delete", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-5 max-w-[1280px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My customer requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything you have raised, and anything still unfinished.
          </p>
        </div>
        {s.canRaise && (
          <Button asChild className="gap-2">
            <Link to={newHref()}><UserPlus className="h-4 w-4" /> New customer</Link>
          </Button>
        )}
      </div>

      <Tabs defaultValue={drafts.length ? "drafts" : "open"}>
        <TabsList>
          <TabsTrigger value="drafts">Drafts{drafts.length ? ` (${drafts.length})` : ""}</TabsTrigger>
          <TabsTrigger value="open">In progress{inFlight.length ? ` (${inFlight.length})` : ""}</TabsTrigger>
          <TabsTrigger value="done">Finished{done.length ? ` (${done.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="mt-4">
          <Card><CardContent className="p-5">
            {drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No unfinished drafts. Anything you start is saved here automatically.
              </p>
            ) : (
              <ul className="divide-y">
                {drafts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{requestSubject(r)}</div>
                      <div className="text-xs text-muted-foreground">
                        Started {dmy(r.createdAt)} · last saved {dmy(r.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" asChild className="gap-1">
                        <Link to={editHref(r.id)}><FileEdit className="h-3.5 w-3.5" /> Continue</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="open" className="mt-4">
          <Card><CardContent className="p-5">
            <RequestTable
              rows={inFlight}
              columns={[colRef, colCustomer, colPlace, colRequestedLimit, colWaitingOn,
                        colDue(s.dueIsoFor), colRaisedOn, colStatus]}
              rowHref={(r) => detailHref(r.id)}
              empty="Nothing of yours is in progress."
              searchPlaceholder="Search your requests…"
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="done" className="mt-4">
          <Card><CardContent className="p-5">
            <RequestTable
              rows={done}
              columns={[colRef, colCustomer, colGst, colPlace, colRaisedOn, colStatus]}
              rowHref={(r) => detailHref(r.id)}
              empty="Nothing finished yet."
              exportName="My-customers"
              searchPlaceholder="Search your requests…"
            />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {draftToDelete ? `“${requestSubject(draftToDelete)}” ` : ""}
              and any documents attached to it will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
            >
              {busy ? "Deleting…" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
