/**
 * EmailReportDialog — send the generated report by mail, files attached.
 *
 * TWO MODES, ONE DIALOG
 *   scope "all"          : one mail, to whoever you name, with the consolidated pair attached.
 *   scope "salesperson"  : one mail PER selected salesperson, each carrying only their own pair.
 *
 * WHO GETS THE SALESPERSON-WISE MAIL
 *   A salesperson is a NAME on a customer record, not a portal user, so the two are matched by
 *   `profiles.receivables_salespersons` — the same tag that scopes what a rep can see in this app.
 *   A rep with no matching profile cannot be resolved to an address, so the dialog says so and
 *   lets you type one rather than skipping them silently.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Search, TriangleAlert } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { useDirectory } from "@/core/platform/store";
import { buildBoth, type CollectionsExportContext, type SalespersonOption } from "@hub/lib/collectionsExport";
import { queueReportEmail } from "@hub/lib/reportEmail";
import { matchesSearch } from "@/shared/lib/search";

export type EmailScope = "all" | "salesperson";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: EmailScope;
  /** Catalogue id of the report being mailed. Its own switch decides whether this can send. */
  reportKey: string;
  options: SalespersonOption[];
  getContext: () => CollectionsExportContext;
}

export function EmailReportDialog({ open, onOpenChange, scope, reportKey, options, getContext }: Props) {
  const { toast } = useToast();
  const { profiles } = useDirectory();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch(""); setSelected(new Set()); setTo(""); setProgress("");
    setMessage(
      scope === "all"
        ? "Please find the current zero-collection position attached: a PDF summary and a detailed workbook."
        : "Please find your customers' collection position attached: a PDF summary and a detailed workbook. Please review the overdue accounts and share your action plan.",
    );
  }, [open, scope]);

  /** salesperson name -> the portal users tagged with it. */
  const addressBook = useMemo(() => {
    const m = new Map<string, { email: string; name: string }[]>();
    for (const p of profiles) {
      for (const raw of p.receivablesSalespersons ?? []) {
        const key = raw.trim();
        if (!key || !p.email) continue;
        const list = m.get(key);
        const entry = { email: p.email, name: p.name };
        if (list) list.push(entry); else m.set(key, [entry]);
      }
    }
    return m;
  }, [profiles]);

  const filtered = useMemo(
    () => (search.trim() ? options.filter((o) => matchesSearch(search, o.name)) : options),
    [options, search],
  );

  const chosen = useMemo(() => [...selected], [selected]);
  const unresolved = useMemo(
    () => chosen.filter((n) => !(addressBook.get(n)?.length)),
    [chosen, addressBook],
  );

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const parseAddresses = (raw: string) =>
    raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const canSend = scope === "all"
    ? parseAddresses(to).length > 0
    : chosen.length > 0 && unresolved.length === 0;

  const handleSend = async () => {
    setBusy(true);
    try {
      const ctx = getContext();
      const subjectBase = `${ctx.meta.title} — as on ${ctx.meta.asOfDate.slice(0, 10)}`;

      if (scope === "all") {
        setProgress("Building files…");
        const files = await buildBoth(ctx, { kind: "all" });
        setProgress("Sending…");
        await queueReportEmail({
          reportKey,
          recipients: parseAddresses(to).map((email) => ({ email })),
          subject: subjectBase,
          headline: ctx.meta.title,
          body: message,
          files: files.map((f) => ({ blob: f.blob, filename: f.filename })),
        });
        toast({ title: "Report queued", description: `${parseAddresses(to).length} recipient(s).` });
      } else {
        // Sequential: each rep needs their own files built AND their own outbox row, and firing
        // them together would lock the tab with no way to say where it had got to.
        for (let i = 0; i < chosen.length; i++) {
          const name = chosen[i];
          setProgress(`${name} (${i + 1}/${chosen.length})`);
          const files = await buildBoth(ctx, { kind: "salesperson", name });
          await queueReportEmail({
            reportKey,
            recipients: (addressBook.get(name) ?? []).map((p) => ({ email: p.email, name: p.name })),
            subject: `${subjectBase} — ${name}`,
            headline: `${ctx.meta.title} — ${name}`,
            body: message,
            files: files.map((f) => ({ blob: f.blob, filename: f.filename })),
          });
        }
        toast({ title: `Queued for ${chosen.length} salesperson(s)` });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not send",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-card max-w-lg">
        <DialogHeader>
          <DialogTitle>{scope === "all" ? "Email the full report" : "Email salesperson-wise"}</DialogTitle>
          <DialogDescription>
            {scope === "all"
              ? "Sends one mail with the PDF summary and the detailed workbook attached."
              : "Sends each selected salesperson their own PDF and workbook, covering only their customers."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {scope === "all" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                placeholder="name@orangeotec.com, another@orangeotec.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 rounded-input border-border text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Separate several addresses with commas.</p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search salesperson..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 rounded-input border-border text-sm"
                />
              </div>

              <div className="max-h-52 overflow-y-auto rounded-input border border-border divide-y divide-border">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">No salespersons match.</div>
                ) : filtered.map((opt) => {
                  const people = addressBook.get(opt.name) ?? [];
                  return (
                    <label key={opt.name} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
                      <Checkbox checked={selected.has(opt.name)} onCheckedChange={() => toggle(opt.name)} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">{opt.name}</span>
                        <span className={`block text-[11px] truncate ${people.length ? "text-muted-foreground" : "text-destructive"}`}>
                          {people.length ? people.map((p) => p.email).join(", ") : "No portal user tagged with this salesperson"}
                        </span>
                      </span>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{opt.customers} cust</span>
                    </label>
                  );
                })}
              </div>

              {unresolved.length > 0 && (
                <div className="flex items-start gap-2 rounded-input border border-destructive/40 bg-destructive/5 p-2.5">
                  <TriangleAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-snug text-destructive">
                    No address on file for {unresolved.join(", ")}. Tag a portal user with that salesperson
                    in Admin &rsaquo; Users, or deselect them.
                  </p>
                </div>
              )}
            </>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="mt-1 rounded-input border-border text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button className="rounded-button" onClick={handleSend} disabled={!canSend || busy}>
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {progress || "Sending…"}</>
            ) : (
              <><Mail className="h-4 w-4 mr-2" /> Send</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
