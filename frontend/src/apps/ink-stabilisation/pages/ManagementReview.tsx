import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { canReview, joinTests, useFlow, useStabLots, type FlowTest, type StabMode } from "../lib/flow";
import { STOCK_COMPANIES } from "../lib/closingStock";
import { FlowUnavailable } from "../components/FlowParts";
import ReviewModal from "../components/ReviewModal";
import ReassignTestModal from "../components/ReassignTestModal";
import TestTable from "../components/TestTable";
import { Segmented } from "../components/ui";

/**
 * STEP 3 · MANAGEMENT REVIEW — the tests the lab REJECTED (approved ones close themselves at
 * the Plant). Management closes each one, or reassigns it to someone to audit; a reassigned
 * test is then that person's to close (20270113120000).
 *
 * mode="stock" is the Closing stock group's copy: only lots with stock today, at Enterprises
 * Surat or Otec Surat, with a Company filter. An Enterprises Surat lot's test is the SAME record
 * in both groups.
 */

type Tab = "submitted" | "mine" | "closed" | "returned";

export default function ManagementReview({ mode = "production" }: { mode?: StabMode }) {
  const stock = mode === "stock";
  const today = todayLocalIso();
  const { user, isAdmin, canEditModule } = useSession();
  const canEdit = canEditModule("ink-stabilisation");
  const lotsQ = useStabLots(mode);
  const flowQ = useFlow();
  const flow = flowQ.data;
  const may = (t: FlowTest) => canReview(t, user.id, isAdmin, canEdit, flow);

  const [tab, setTab] = useState<Tab>("submitted");
  const [company, setCompany] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FlowTest | null>(null);
  const [reassigning, setReassigning] = useState<FlowTest | null>(null);

  // Only tests that have a flow record; oldest submission first, so nothing waits longest.
  const all = useMemo(() => joinTests(lotsQ.lots ?? [], flow)
    .filter((t) => t.record && (company === "all" || (t.lot.companyGuid ?? STOCK_COMPANIES[0].guid) === company)),
  [lotsQ.lots, flow, company]);
  const inTab = (s: Tab) => all.filter((t) =>
    s === "mine" ? t.status === "submitted" && t.record?.assignedTo === user.id : t.status === s);
  const rows = useMemo(() => inTab(tab)
    .filter((t) => matchesSearch(search, `${t.lot.item} ${t.lot.lot} ${t.lot.family} ${t.lot.company ?? ""} ${t.record?.plantRemarks ?? ""}`))
    .sort((a, b) => (tab === "closed"
      ? (b.record!.reviewedAt ?? "").localeCompare(a.record!.reviewedAt ?? "")
      : (a.record!.submittedAt ?? "").localeCompare(b.record!.submittedAt ?? ""))),
  [all, tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = open ? all.find((t) => t.key === open.key) ?? open : null;
  const legacyReturned = inTab("returned").length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-orange">
            {stock ? "Closing stock · Step 3 · Management review" : "Step 3 · Management review"}
          </div>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight text-navy">Management review{stock ? " — closing stock" : ""}</h1>
          <p className="mt-1 text-[13px] text-grey">
            Tests the lab <b className="text-ryg-red">rejected</b>. Read the result and remarks, then close the test — or reassign it to someone to audit.
            Approved tests close by themselves and are listed under Closed.
          </p>
        </div>
        {stock && (
          <select value={company} onChange={(e) => setCompany(e.target.value)}
            className="h-9 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-navy">
            <option value="all">Both companies</option>
            {STOCK_COMPANIES.map((c) => <option key={c.guid} value={c.guid}>{c.name}</option>)}
          </select>
        )}
      </header>

      {flowQ.isError && <FlowUnavailable error={flowQ.error} />}
      {lotsQ.isError && <Card className="p-4 text-[13px] text-ryg-red">Could not read lots: {(lotsQ.error as Error).message}</Card>}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-page/50 px-5 py-3">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "submitted", label: "Awaiting review", count: inTab("submitted").length },
              { value: "mine", label: "Reassigned to me", count: inTab("mine").length },
              { value: "closed", label: "Closed", count: inTab("closed").length },
              ...(legacyReturned ? [{ value: "returned" as const, label: "Sent back (old)", count: legacyReturned }] : []),
            ]}
          />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, lot no., remarks…"
            className="ml-auto h-9 w-64 rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-orange" />
        </div>
        {lotsQ.isLoading || flowQ.isLoading ? (
          <div className="p-12 text-center text-[13px] text-grey">
            {stock ? "Reading today's closing stock from ConnectWave… (about a minute the first time)" : "Loading…"}
          </div>
        ) : (tab === "submitted" || tab === "mine") && rows.length === 0 && !search ? (
          <div className="p-14 text-center">
            <div className="text-[28px]">✓</div>
            <div className="mt-1 text-[14px] font-semibold text-navy">Nothing waiting for review</div>
            <div className="text-[12.5px] text-grey">Tests the lab rejects will appear here.</div>
          </div>
        ) : (
          <TestTable rows={rows} flow={flow} today={today} onOpen={setOpen} showSubmitted showHolder={tab !== "closed"} showCompany={stock}
            resetKey={`${tab}|${search}|${company}`}
            actionLabel={(t) => (may(t) && t.status === "submitted" ? "Review" : "View")}
            extraAction={{ label: "Reassign", show: (t) => may(t) && t.status === "submitted", onClick: setReassigning }} />
        )}
      </Card>

      {current && (
        <ReviewModal test={current} flow={flow} canAct={may(current)} onClose={() => setOpen(null)}
          onReassign={(t) => { setOpen(null); setReassigning(t); }} />
      )}
      {reassigning && <ReassignTestModal test={reassigning} onClose={() => setReassigning(null)} />}
    </div>
  );
}
