import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Search } from "lucide-react";
import {
  DEFAULT_MAIL_OPTIONS, MAIL_BLOCKS, MAIL_PERIODS, fetchMailSetup, fetchMailUsers,
  saveMailOptions, saveMailUserRecipients, type MailBlock, type MailOptions, type MailPeriod,
} from "@hub/lib/bushraSalesMailOptions";
import { useToast } from "@hub/hooks/use-toast";
import { cn } from "@/shared/lib/cn";

/**
 * What the scheduled Sales-Dashboard mail carries, and who it goes to.
 *
 * Sits under the report's own switch and its schedule (components/ReportDeliveryConfig), which
 * already answer "may it send" and "when". This answers the two a dashboard adds: WHICH BLOCKS —
 * a dashboard is nine sections and nobody wants all of them at 08:00 — and WHO, chosen as people
 * rather than addresses so a change of email needs no edit here.
 *
 * Nothing on this screen sends anything. A mail goes out only when the schedule is set, the
 * report's switch is on, and the arming switch is flipped in the database.
 */
export default function BushraSalesMailOptions({ reportKey, reportTitle }: { reportKey: string; reportTitle: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const setupQ = useQuery({ queryKey: ["bushraSalesMail", reportKey], queryFn: () => fetchMailSetup(reportKey) });
  const usersQ = useQuery({ queryKey: ["bushraSalesMailUsers", reportKey], queryFn: () => fetchMailUsers(reportKey) });

  const [options, setOptions] = useState<MailOptions>(DEFAULT_MAIL_OPTIONS);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!setupQ.data) return;
    setOptions(setupQ.data.options);
    setPicked(setupQ.data.userIds);
    setDirty(false);
  }, [setupQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      await saveMailOptions(reportKey, options);
      await saveMailUserRecipients(reportKey, picked);
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["bushraSalesMail", reportKey] });
      toast({ title: "Saved", description: `${reportTitle}: what the mail carries and who receives it.` });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const users = usersQ.data ?? [];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? users.filter((u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) : users;
  }, [users, q]);
  const chosen = users.filter((u) => picked.includes(u.id));

  const toggleBlock = (id: MailBlock) => {
    setDirty(true);
    setOptions((o) => ({
      ...o,
      // At least one block, or the mail is an empty page.
      blocks: o.blocks.includes(id)
        ? (o.blocks.length > 1 ? o.blocks.filter((b) => b !== id) : o.blocks)
        : [...o.blocks, id],
    }));
  };

  if (setupQ.isLoading) {
    return <div className="flex items-center gap-2 p-4 text-[13px] text-grey"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-4 rounded-card border border-line bg-white p-4">
      <div>
        <h4 className="text-[14px] font-semibold text-ink">What the scheduled mail carries</h4>
        <p className="mt-0.5 text-[12px] text-grey">
          {reportTitle} · the figures go in the mail body, with the one-page PDF attached.
        </p>
      </div>

      {setupQ.data && !setupQ.data.installed && (
        <div className="flex items-start gap-2 rounded-card border border-orange/40 bg-orange/5 p-3 text-[12.5px] text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
          <span>
            The database part is not applied yet — migration
            <code className="mx-1 rounded bg-white px-1">20261125120000_bushra_sales_mail_options.sql</code>
            creates the two tables this screen writes to. Choices below cannot be saved until it runs.
          </span>
        </div>
      )}

      {/* ── the blocks ─────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        {MAIL_BLOCKS.map((b) => {
          const on = options.blocks.includes(b.id);
          return (
            <button key={b.id} type="button" onClick={() => toggleBlock(b.id)}
                    className={cn("flex items-start gap-2 rounded-card border p-2.5 text-left transition",
                                  on ? "border-orange bg-orange/5" : "border-line bg-white hover:bg-grey-1/40")}>
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  on ? "border-orange bg-orange text-white" : "border-grey-2 bg-white")}>
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{b.label}</span>
                <span className="block text-[11.5px] text-grey">{b.note}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── period and attachment ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          Period
          <select
            value={options.period}
            onChange={(e) => { setDirty(true); setOptions((o) => ({ ...o, period: e.target.value as MailPeriod })); }}
            className="h-8 rounded-input border border-line bg-white px-2 text-[12.5px]"
          >
            {MAIL_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" checked={options.attachPdf}
                 onChange={(e) => { setDirty(true); setOptions((o) => ({ ...o, attachPdf: e.target.checked })); }} />
          Attach the PDF (one clickable summary slide, with the detail behind it)
        </label>
      </div>

      {/* ── who receives it ────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-[14px] font-semibold text-ink">Who receives it</h4>
        <p className="mt-0.5 text-[12px] text-grey">
          Chosen as people, not addresses — the sender reads each one's current email, so a change of
          address needs no edit here. {chosen.length} chosen.
        </p>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name or email…"
                 className="h-8 w-full rounded-input border border-line bg-white pl-7 pr-2 text-[12.5px]" />
        </div>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
          {usersQ.isLoading ? (
            <div className="flex items-center gap-2 p-2 text-[12.5px] text-grey"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading people…</div>
          ) : shown.length === 0 ? (
            <div className="p-2 text-[12.5px] text-grey">Nobody matches.</div>
          ) : shown.map((u) => {
            const on = picked.includes(u.id);
            return (
              <button key={u.id} type="button"
                      onClick={() => { setDirty(true); setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id])); }}
                      className={cn("flex w-full items-center gap-2 rounded-card border px-2.5 py-1.5 text-left transition",
                                    on ? "border-orange bg-orange/5" : "border-line bg-white hover:bg-grey-1/40")}>
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                    on ? "border-orange bg-orange text-white" : "border-grey-2 bg-white")}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{u.name}</span>
                  <span className="block truncate text-[11.5px] text-grey">{u.email}</span>
                </span>
                {/* Someone who cannot open the dashboard may still be mailed it — but say so. */}
                {!u.mayOpen && (
                  <span className="shrink-0 rounded-pill bg-grey-1 px-2 py-0.5 text-[10.5px] text-grey">
                    cannot open this dashboard
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-3">
        <button type="button" onClick={() => save.mutate()}
                disabled={!dirty || save.isPending || !(setupQ.data?.installed)}
                className={cn("rounded-button px-3 py-1.5 text-[12.5px] font-medium text-white transition",
                              !dirty || save.isPending || !(setupQ.data?.installed) ? "bg-grey-2" : "bg-orange hover:bg-orange/90")}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {dirty && <span className="text-[12px] text-grey">Unsaved changes</span>}
        {!picked.length && <span className="text-[12px] text-grey">No recipients yet — nothing will be sent.</span>}
      </div>
    </div>
  );
}
