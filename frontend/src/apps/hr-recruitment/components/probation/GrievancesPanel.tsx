import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";

/**
 * NR-10 / KPI 1C.6 — the concerns HR owes an answer to, and the 24-hour clock.
 *
 * 🔴 Rendered ONLY for HR. Not because the component hides anything — the table's
 * own policy already does that, and a head of department querying it directly
 * gets nothing — but because a heading that says "Concerns" on the page a HOD
 * uses would tell them the register exists and that something might be in it.
 * The gate is the same predicate the policy uses, asked of the database.
 *
 * The clock is the point of this line: a concern is scored on being CLOSED within
 * 24 hours of being raised, so the age is shown in hours until it is, and in red
 * the moment it is not.
 */

type Row = {
  id: string;
  raised_at: string;
  category: string;
  body: string;
  status: string;
  closed_at: string | null;
  resolution: string | null;
  raised_by: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  work: "The work itself",
  manager: "Their manager",
  team: "The team",
  facilities: "Facilities",
  pay: "Pay or paperwork",
  other: "Something else",
};

const hoursSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);

function Concern({ row, onClosed }: { row: Row; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const age = hoursSince(row.raised_at);
  const late = row.status === "open" && age >= 24;

  const close = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("fms_hr_close_grievance", {
      p_id: row.id,
      p_resolution: resolution.trim(),
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOpen(false);
    onClosed();
  };

  return (
    <li className={`rounded-xl border px-4 py-3 ${late ? "border-ryg-red/40" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-navy">
            {CATEGORY_LABEL[row.category] ?? row.category}
          </p>
          <p className="mt-1 text-[12.5px] text-grey leading-relaxed">{row.body}</p>
          <p className="mt-1 text-[11.5px] text-grey-2">Raised {formatDateTimeDMY(row.raised_at)}</p>
        </div>
        {row.status === "open" ? (
          <span
            className={`shrink-0 rounded-pill px-2.5 py-1 text-[11.5px] font-medium ${
              late ? "bg-[#FDECEC] text-ryg-red" : "bg-orange/10 text-orange"
            }`}
          >
            {age < 1 ? "Just now" : `${age}h old`}
            {late && " · past 24h"}
          </span>
        ) : (
          <span className="shrink-0 rounded-pill bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-medium text-ryg-green">
            Closed
          </span>
        )}
      </div>

      {row.resolution && (
        <p className="mt-2 rounded-lg bg-page px-3 py-2 text-[12px] text-grey leading-relaxed">
          {row.resolution}
        </p>
      )}

      {row.status === "open" && !open && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(true)}>
          Close it
        </Button>
      )}

      {open && (
        <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
          <TextArea
            rows={3}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What was done about it. The person who raised it will read this."
          />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={close} disabled={busy || !resolution.trim()}>
              {busy ? "Saving…" : "Close"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function GrievancesPanel() {
  const { user } = useSession();
  const qc = useQueryClient();

  const { data: maySee } = useQuery({
    queryKey: ["maySeeGrievances", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fms_hr_may_see_grievances", { p_uid: user.id });
      if (error) throw new Error(error.message);
      return !!data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data } = useQuery({
    queryKey: ["grievances"],
    enabled: maySee === true,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("fms_hr_grievances")
        .select("id, raised_at, category, body, status, closed_at, resolution, raised_by")
        .order("raised_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (maySee !== true) return null;

  const rows = data ?? [];
  const open = rows.filter((r) => r.status === "open");
  if (rows.length === 0) return null;

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-navy">
          Concerns {open.length > 0 && <span className="text-orange">({open.length} open)</span>}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-grey-2">
          Raised by new joiners, and due to be closed within 24 hours. Only HR can see these — not the
          head of department, who may be what the concern is about.
        </p>
      </div>
      <ul className="space-y-2.5">
        {rows.slice(0, 10).map((r) => (
          <Concern
            key={r.id}
            row={r}
            onClosed={() => void qc.invalidateQueries({ queryKey: ["grievances"] })}
          />
        ))}
      </ul>
    </Card>
  );
}
