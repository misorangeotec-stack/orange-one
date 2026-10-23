import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import type { CompanyGodowns, GodownRule } from "../lib/expiry";
import { GODOWN_RULE_KEY, saveGodownRule } from "../lib/godownRule";
import { fmtKg } from "./StockCharts";

/**
 * "Godowns counted" — every godown that holds stock of a lot, per company, ticked when its stock is
 * counted; the rest are left out of every figure in the app, for everyone. Default as Ink IMS:
 * Enterprises Surat counts FINISHED GOODS-SACHIN and HOJIWALA only (the user, 22-10-2026).
 * A company with nothing saved counts every godown. Admins save; others see the choice.
 * The KGS beside each godown is the lots' own godown balance before anything is left out.
 */
export default function GodownChooser({ all, rule }: { all: CompanyGodowns[]; rule: GodownRule }) {
  const { user, isAdmin } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GodownRule>(rule);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  // No list for a company = every godown counts.
  const isCounted = (r: GodownRule, guid: string, name: string) =>
    !(r[guid] ?? []).length || (r[guid] ?? []).some((g) => same(g, name));
  const toggle = (c: CompanyGodowns, name: string) => setDraft((r) => {
    const now = c.godowns.map((g) => g.name).filter((g) => isCounted(r, c.guid, g));
    const next = now.some((g) => same(g, name)) ? now.filter((g) => !same(g, name)) : [...now, name];
    // Every godown ticked again → back to "the whole company", so new godowns count too. None ticked
    // keeps a list that matches nothing — an empty list would mean "everything".
    return { ...r, [c.guid]: next.length === c.godowns.length ? [] : next.length ? next : ["(none)"] };
  });
  const leftOut = all.reduce((n, c) => n + c.godowns.filter((g) => !isCounted(rule, c.guid, g.name)).length, 0);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await saveGodownRule(draft, user.id);
      await qc.invalidateQueries({ queryKey: GODOWN_RULE_KEY });
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setDraft(rule); setErr(null); setOpen(true); }}>
        Godowns counted{leftOut ? ` · ${leftOut} left out` : ""}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Godowns counted"
        subtitle={isAdmin ? "Ticked godowns count. Untick one to leave its stock out of every figure, for everyone." : "Unticked godowns are left out of every figure. Only an admin can change this."}
        footer={isAdmin ? (
          <div className="flex items-center justify-end gap-2">
            {err && <span className="mr-auto text-[12px] text-ryg-red">{err}</span>}
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save for everyone"}</Button>
          </div>
        ) : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          {all.filter((c) => c.godowns.length).map((c) => (
            <div key={c.guid} className="rounded-lg border border-line p-3">
              <div className="mb-2 text-[13px] font-semibold text-navy">{c.company}</div>
              {c.godowns.map((g) => {
                const counted = isCounted(isAdmin ? draft : rule, c.guid, g.name);
                return (
                  <label key={g.name} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px]">
                    <input type="checkbox" checked={counted} disabled={!isAdmin} onChange={() => toggle(c, g.name)} />
                    <span className={counted ? "text-navy" : "text-grey line-through"}>{g.name}</span>
                    <span className="ml-auto tabular-nums text-grey">{fmtKg(g.qty)}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
