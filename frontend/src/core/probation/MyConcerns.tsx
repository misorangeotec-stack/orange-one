import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { supabase } from "@/core/platform/supabase";

/**
 * NR-10 / KPI 1C.6 — raising a concern, and seeing what happened to it.
 *
 * 🔴 What is written here is NOT visible to the head of department. A concern may
 * be ABOUT them, so it goes to HR and to nobody else — it is not announced, it
 * writes no activity row, and the read gate on the table names the raiser, HR and
 * admins only. That promise is made on the screen because a person deciding
 * whether to type something needs to know who will read it.
 *
 * The client has their own grievance FORM and will send it; its questions land in
 * `answers` (jsonb) without a migration. Until then this asks the two things any
 * version of it needs: what kind of thing, and what happened.
 */

const CATEGORIES = [
  { value: "work", label: "The work itself" },
  { value: "manager", label: "My manager" },
  { value: "team", label: "The team" },
  { value: "facilities", label: "Facilities" },
  { value: "pay", label: "Pay or paperwork" },
  { value: "other", label: "Something else" },
] as const;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);

type Concern = {
  id: string;
  raised_at: string;
  category: string;
  body: string;
  status: string;
  closed_at: string | null;
  resolution: string | null;
};

export default function MyConcerns() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("work");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["myConcerns"],
    queryFn: async (): Promise<Concern[]> => {
      const { data, error } = await supabase.rpc("fms_hr_grievances_for_me");
      if (error) throw new Error(error.message);
      return (data ?? []) as Concern[];
    },
  });

  const rows = data ?? [];

  const send = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("fms_hr_raise_grievance", {
      p_category: category,
      p_body: body.trim(),
      p_answers: {},
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setBody("");
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["myConcerns"] });
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Raise a concern</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            Anything that is not working — the work, the team, your manager, or the paperwork.
          </p>
        </div>
        {!open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Raise one
          </Button>
        )}
      </div>

      <p className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-[12px] text-grey leading-relaxed">
        This goes to <strong>HR only</strong>. Your head of department cannot see it, and it does not
        appear anywhere on your probation record that they read.
      </p>

      {open && (
        <div className="space-y-3 border-t border-line pt-3">
          <FieldLabel label="What is it about" required>
            <div className="mt-1 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-medium transition ${
                    category === c.value ? "border-orange bg-orange/5 text-navy" : "border-line text-grey"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </FieldLabel>
          <FieldLabel label="What happened" required>
            <TextArea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="As much or as little as you want to say."
            />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={busy || !body.trim()}>
              {busy ? "Sending…" : "Send to HR"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2 border-t border-line pt-3">
          {rows.map((g) => (
            <li key={g.id} className="rounded-xl border border-line px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-navy">
                  {CATEGORY_LABEL[g.category] ?? g.category}
                </span>
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                    g.status === "closed"
                      ? "bg-[#E9F7EF] text-ryg-green"
                      : "bg-orange/10 text-orange"
                  }`}
                >
                  {g.status === "closed" ? "Closed" : "With HR"}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-grey leading-relaxed">{g.body}</p>
              <p className="mt-1 text-[11px] text-grey-2">Raised {formatDateTimeDMY(g.raised_at)}</p>
              {g.resolution && (
                <p className="mt-1.5 rounded-lg bg-page px-3 py-2 text-[12px] text-grey leading-relaxed">
                  <strong className="text-navy">HR:</strong> {g.resolution}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
