/**
 * EmailReportDialog — send the generated report by mail, files attached.
 *
 * TWO MODES, ONE DIALOG
 *   scope "all"          : one mail, to whoever you name, with the consolidated pair attached.
 *   scope "salesperson"  : one mail PER selected salesperson, each carrying only their own pair.
 *
 * WHO GETS THE SALESPERSON-WISE MAIL — AND WHY IT IS PICKED, NOT DERIVED
 *   A salesperson is a NAME on a customer record, not a portal user. The obvious bridge is
 *   `profiles.receivables_salespersons`, and the first version of this dialog mailed every user
 *   carrying the name. That was wrong, and the live data says so plainly: three accounts are
 *   tagged with all thirteen salespeople and one rep is tagged with five, because THE TAG IS A
 *   VISIBILITY SCOPE. It answers "whose figures may this person see", which is not the same
 *   question as "whose book is this". Sending on it addressed one rep's book to five people, four
 *   of them oversight accounts.
 *
 *   Nor can the right answer be inferred. "Tagged with exactly this one name" identifies some reps
 *   and not others — a team lead legitimately carries their own name plus four more.
 *
 *   So the recipients are CHOSEN. Every user holding the tag is offered, an unambiguous dedicated
 *   account (tagged with this name and nothing else) is pre-ticked as a sensible default, and
 *   Send is refused while any selected salesperson has nobody chosen. Nothing is guessed silently.
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
  /** salesperson name -> the addresses ticked to receive THEIR book. Never derived at send time. */
  const [recipients, setRecipients] = useState<Record<string, string[]>>({});
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch(""); setSelected(new Set()); setRecipients({}); setTo(""); setProgress("");
    setMessage(
      scope === "all"
        ? "Please find the current zero-collection position attached: a PDF summary and a detailed workbook."
        : "Please find your customers' collection position attached: a PDF summary and a detailed workbook. Please review the overdue accounts and share your action plan.",
    );
  }, [open, scope]);

  /**
   * salesperson name -> the portal users who hold that tag, each with how many names they hold.
   *
   * `covers` is what separates a rep from an overseer. Someone tagged with one name is that
   * salesperson; someone tagged with thirteen is credit control watching everybody, and mailing
   * them one rep's book is a mistake dressed up as a feature.
   */
  const addressBook = useMemo(() => {
    const m = new Map<string, { email: string; name: string; covers: number }[]>();
    for (const p of profiles) {
      const tags = (p.receivablesSalespersons ?? []).map((t) => t.trim()).filter(Boolean);
      for (const key of tags) {
        if (!p.email) continue;
        const entry = { email: p.email, name: p.name, covers: tags.length };
        const list = m.get(key);
        if (list) list.push(entry); else m.set(key, [entry]);
      }
    }
    // Dedicated accounts first, then by name, so the person most likely to be the rep leads.
    for (const list of m.values()) {
      list.sort((a, b) => a.covers - b.covers || a.name.localeCompare(b.name));
    }
    return m;
  }, [profiles]);

  /** The unambiguous account for a name: holds this tag and no other. May be none. */
  const dedicatedFor = (name: string) =>
    (addressBook.get(name) ?? []).filter((p) => p.covers === 1).map((p) => p.email);

  const filtered = useMemo(
    () => (search.trim() ? options.filter((o) => matchesSearch(search, o.name)) : options),
    [options, search],
  );

  const chosen = useMemo(() => [...selected], [selected]);

  /** A selected salesperson with nobody ticked to receive it. Blocks Send. */
  const unaddressed = useMemo(
    () => chosen.filter((n) => !(recipients[n]?.length)),
    [chosen, recipients],
  );

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        // Pre-tick the dedicated account, if there is exactly one obvious candidate. Where the
        // tags cannot tell (a team lead carrying several names), nothing is ticked and the admin
        // has to say — which is the honest behaviour, not a nuisance.
        setRecipients((r) => (r[name] ? r : { ...r, [name]: dedicatedFor(name) }));
      }
      return next;
    });

  const toggleRecipient = (name: string, email: string) =>
    setRecipients((r) => {
      const cur = r[name] ?? [];
      return { ...r, [name]: cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email] };
    });

  const parseAddresses = (raw: string) =>
    raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const canSend = scope === "all"
    ? parseAddresses(to).length > 0
    : chosen.length > 0 && unaddressed.length === 0;

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
          // The TICKED addresses, never everyone holding the tag. See the header.
          const to = (recipients[name] ?? []).map((email) => {
            const p = (addressBook.get(name) ?? []).find((x) => x.email === email);
            return { email, name: p?.name };
          });
          if (!to.length) continue;
          await queueReportEmail({
            reportKey,
            recipients: to,
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
                  const on = selected.has(opt.name);
                  const picked = recipients[opt.name] ?? [];
                  return (
                    <div key={opt.name}>
                      <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
                        <Checkbox checked={on} onCheckedChange={() => toggle(opt.name)} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate">{opt.name}</span>
                          <span className={`block text-[11px] truncate ${people.length ? "text-muted-foreground" : "text-destructive"}`}>
                            {!people.length
                              ? "Nobody in the portal can see this salesperson"
                              : on
                                ? picked.length
                                  ? `Sending to ${picked.join(", ")}`
                                  : "Choose who receives it"
                                : `${people.length} ${people.length === 1 ? "person" : "people"} can see this book`}
                          </span>
                        </span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{opt.customers} cust</span>
                      </label>

                      {/* The candidates, shown only once this salesperson is selected. Everyone
                          who CAN see the book is offered; only the ticked ones are mailed it.
                          "sees N books" is the tell: 1 is the rep, 13 is credit control. */}
                      {on && people.length > 0 && (
                        <div className="bg-muted/20 pl-10 pr-3 pb-2 pt-1 space-y-1">
                          {people.map((p) => (
                            <label key={p.email} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={picked.includes(p.email)}
                                onCheckedChange={() => toggleRecipient(opt.name, p.email)}
                              />
                              <span className="text-[11px] truncate flex-1 min-w-0">
                                {p.email}
                                <span className="text-muted-foreground">
                                  {" "}· sees {p.covers} {p.covers === 1 ? "book" : "books"}
                                  {p.covers === 1 ? "" : " (not just this one)"}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {unaddressed.length > 0 && (
                <div className="flex items-start gap-2 rounded-input border border-destructive/40 bg-destructive/5 p-2.5">
                  <TriangleAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-snug text-destructive">
                    Nobody is set to receive {unaddressed.join(", ")}. Tick a recipient under each
                    name, or deselect it. Their report will not be built until you do.
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
