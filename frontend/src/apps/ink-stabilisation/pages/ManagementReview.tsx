import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { canAct, joinTests, useFlow, useInkLots, type FlowTest } from "../lib/flow";
import { FlowUnavailable } from "../components/FlowParts";
import ReviewModal from "../components/ReviewModal";
import TestTable from "../components/TestTable";
import { Segmented } from "../components/ui";

/**
 * STEP 3 · MANAGEMENT REVIEW — every test the Plant has submitted, whatever its month.
 * Review it and close it, or send it back with a reason.
 */

type Tab = "submitted" | "returned" | "closed";

export default function ManagementReview() {
  const today = todayLocalIso();
  const { user, isAdmin, canEditModule } = useSession();
  const lotsQ = useInkLots();
  const flowQ = useFlow();
  const flow = flowQ.data;
  const mayAct = canAct("review", user.id, isAdmin, canEditModule("ink-stabilisation"), flow);

  const [tab, setTab] = useState<Tab>("submitted");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FlowTest | null>(null);

  // Only tests that have a flow record; oldest submission first, so nothing waits longest.
  const all = useMemo(() => joinTests(lotsQ.data ?? [], flow).filter((t) => t.record), [lotsQ.data, flow]);
  const inTab = (s: Tab) => all.filter((t) => t.status === s);
  const rows = useMemo(() => inTab(tab)
    .filter((t) => matchesSearch(search, `${t.lot.item} ${t.lot.lot} ${t.lot.family} ${t.record?.plantRemarks ?? ""}`))
    .sort((a, b) => (tab === "submitted"
      ? (a.record!.submittedAt ?? "").localeCompare(b.record!.submittedAt ?? "")
      : (b.record!.reviewedAt ?? "").localeCompare(a.record!.reviewedAt ?? ""))),
  [all, tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = open ? all.find((t) => t.key === open.key) ?? open : null;


  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
      <header>
        <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-orange">Step 3 · Management review</div>
        <h1 className="mt-0.5 text-[26px] font-bold leading-tight text-navy">Management review</h1>
        <p className="mt-1 text-[13px] text-grey">Read the lab's result and remarks, then close the test or send it back to the Plant.</p>
      </header>

      {flowQ.isError && <FlowUnavailable error={flowQ.error} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-page/50 px-5 py-3">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "submitted", label: "Awaiting review", count: inTab("submitted").length },
              { value: "returned", label: "Sent back to Plant", count: inTab("returned").length },
              { value: "closed", label: "Closed", count: inTab("closed").length },
            ]}
          />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, lot no., remarks…"
            className="ml-auto h-9 w-64 rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-orange" />
        </div>
        {lotsQ.isLoading || flowQ.isLoading ? (
          <div className="p-12 text-center text-[13px] text-grey">Loading…</div>
        ) : tab === "submitted" && rows.length === 0 && !search ? (
          <div className="p-14 text-center">
            <div className="text-[28px]">✓</div>
            <div className="mt-1 text-[14px] font-semibold text-navy">Nothing waiting for review</div>
            <div className="text-[12.5px] text-grey">Tests the Plant submits will appear here.</div>
          </div>
        ) : (
          <TestTable rows={rows} flow={flow} today={today} onOpen={setOpen} showSubmitted resetKey={`${tab}|${search}`}
            actionLabel={(t) => (mayAct && t.status === "submitted" ? "Review" : "View")} />
        )}
      </Card>

      {current && <ReviewModal test={current} flow={flow} canAct={mayAct} onClose={() => setOpen(null)} />}
    </div>
  );
}
