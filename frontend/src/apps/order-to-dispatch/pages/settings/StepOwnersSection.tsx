import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../../store";
import { OWNER_STEPS, type OwnerStepKey } from "../../lib/steps";

/**
 * Step Owners (admin). EVERY step can have owners — including step 1, Sales Order.
 * For step 1 specifically: with owners set, only they (or an admin / coordinator)
 * can raise an order; with none set, raising stays open to every granted user.
 * That is why the DB deliberately has no CHECK barring the origin step here.
 *
 * ⚠ OWNERSHIP IS NOW PER LOCATION, AND THIS SCREEN DECIDES WHO SEES WHAT.
 *   Each step has one "All locations" row plus, optionally, a row per site. A
 *   site's own row REPLACES the default for that site rather than adding to it —
 *   which is what makes "Vapi is handled by these two, everywhere else by the
 *   default" sayable at all.
 *
 * ⚠ AND IT NOW CONTROLS VISIBILITY, NOT JUST BUTTONS. Postgres withholds an
 *   order from anyone who owns no step at its location, so a person named
 *   nowhere on this screen sees an empty app. Seeding it is a go-live step, not
 *   an option — that was true before and it is now unmissable.
 */
export default function StepOwnersSection() {
  const s = useDispatchStore();
  /** Which owner-set is open: the step, and the site (null = All locations). */
  const [editing, setEditing] = useState<{ step: OwnerStepKey; locationId: string | null } | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<OwnerStepKey>>(new Set());

  const sites = useMemo(() => s.activeOf(s.companyLocations), [s]);

  const deptOptions: MultiOption[] = useMemo(
    () => s.orgDepartments.map((d) => ({ value: d.id, label: d.name })),
    [s.orgDepartments],
  );

  const peopleOptions: MultiOption[] = useMemo(() => {
    const chosen = new Set(deptIds);
    return [...s.profiles]
      .filter((p) => chosen.size === 0 || (p.departmentId && chosen.has(p.departmentId)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
  }, [s.profiles, deptIds]);

  const changeDepts = (next: string[]) => {
    setDeptIds(next);
    if (next.length === 0) return;
    const chosen = new Set(next);
    const allowed = new Set(s.profiles.filter((p) => p.departmentId && chosen.has(p.departmentId)).map((p) => p.id));
    setEmpIds((prev) => prev.filter((id) => allowed.has(id)));
  };

  const open = (step: OwnerStepKey, locationId: string | null) => {
    const cur = s.stepOwnerFor(step, locationId);
    setDeptIds(cur?.departmentIds ?? []);
    setEmpIds(cur?.employeeIds ?? []);
    setErr(null);
    setEditing({ step, locationId });
  };

  const toggle = (step: OwnerStepKey) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setStepOwner(editing.step, editing.locationId, {
        departmentIds: deptIds,
        designationId: null,
        employeeIds: empIds,
      });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Hand this site back to the All-locations default. */
  const clearOverride = async () => {
    if (!editing?.locationId) return;
    setBusy(true);
    setErr(null);
    try {
      await s.deleteStepOwner(editing.step, editing.locationId);
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editingStep = OWNER_STEPS.find((st) => st.key === editing?.step);
  const editingSite = editing?.locationId ? s.masterName("company_location", editing.locationId) : "All locations";
  const overridden = !!editing?.locationId && !!s.stepOwnerFor(editing.step, editing.locationId);

  const ownerCell = (step: OwnerStepKey, locationId: string | null) => {
    const own = s.stepOwnerFor(step, locationId);
    // No row of its own means this site runs on the default — say so rather
    // than showing "Unassigned", which would read as nobody owning it.
    if (locationId !== null && !own) {
      const fallback = s.ownerNamesFor(step, null);
      return (
        <span className="text-grey-2">
          Same as All locations{fallback.length ? ` · ${fallback.join(", ")}` : ""}
        </span>
      );
    }
    const names = (own?.employeeIds ?? []).map((id) => s.personName(id));
    if (names.length) return <span className="text-navy">{names.join(", ")}</span>;
    return (
      <span className="text-grey-2">
        {step === "sales_order" && locationId === null ? "Anyone with access may raise" : "Unassigned"}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        Owners can action their step and are notified about it. Everyone here also{" "}
        <span className="font-semibold text-navy">sees</span> the orders at the locations they own —
        every order there, not only the ones at their own step. Set the All-locations row first; add
        a site row only where that site is handled by different people.
      </p>

      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                <th className="font-medium px-4 py-3 w-10">#</th>
                <th className="font-medium px-4 py-3">Step</th>
                <th className="font-medium px-4 py-3">Location</th>
                <th className="font-medium px-4 py-3">Owners</th>
              </tr>
            </thead>
            <tbody>
              {OWNER_STEPS.map((st) => {
                const isOpen = expanded.has(st.key);
                return (
                  <>
                    <tr key={st.key} className="border-b border-line/70 hover:bg-page/60">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => open(st.key, null)}
                          className="text-[12.5px] font-semibold text-orange hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                      <td className="px-4 py-3 text-grey-2">{st.index}</td>
                      <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-grey">All locations</span>
                        {sites.length > 0 && (
                          <button
                            onClick={() => toggle(st.key)}
                            className="ml-2 text-[12px] font-semibold text-orange hover:underline"
                          >
                            {isOpen ? "hide sites" : `per site (${sites.length})`}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">{ownerCell(st.key, null)}</td>
                    </tr>

                    {isOpen &&
                      sites.map((site) => (
                        <tr key={`${st.key}:${site.id}`} className="border-b border-line/70 bg-page/40">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <button
                              onClick={() => open(st.key, site.id)}
                              className="text-[12.5px] font-semibold text-orange hover:underline"
                            >
                              Edit
                            </button>
                          </td>
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5 whitespace-nowrap text-grey pl-8">
                            {site.name}
                            {/* Every company that dispatches from this site, not
                                one. The site used to be stored once per company,
                                so a single name was the whole truth; now it is
                                one shed serving several, and naming only the
                                first would read as "this row is that company's". */}
                            <span className="text-grey-2 text-[12px]">
                              {" "}
                              · {site.companyIds.map((id) => s.masterName("company", id)).join(" · ")}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">{ownerCell(st.key, site.id)}</td>
                        </tr>
                      ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingStep?.title ?? ""}`}
        subtitle={`${editingSite}. Pick a department, then every employee who owns this step here. All of them can action it, are notified, and can see these orders.`}
        footer={
          <>
            {overridden && (
              <Button variant="ghost" size="sm" onClick={clearOverride} disabled={busy}>
                Use the default
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {editing?.step === "sales_order" && editing.locationId === null && (
            <p className="text-[12.5px] text-grey-2">
              Leave this empty to let every user with access raise an order. Naming owners restricts it to them.
            </p>
          )}
          {editing?.step === "dispatch_confirm" && (
            <p className="text-[12.5px] text-grey-2">
              Name someone here. Delivery confirmation has no other route into it — the old
              driver-confirms-their-own-delivery path went with the Drivers master.
            </p>
          )}
          {editing?.step === "sales_return" && (
            <p className="text-[12.5px] text-grey-2">
              Name someone here. When an order is cancelled after its sales bill has been raised,
              this is who is told to cancel the bill in Tally — or punch a sales return against it —
              and the order stays uncancelled until they record which they did. Usually the people
              who generate the sales bill; name accounts instead if they own the reversal. Leave it
              empty and only coordinators will be told.
            </p>
          )}
          {editing?.locationId !== null && editing !== null && (
            <p className="text-[12.5px] text-grey-2">
              Saving names here <span className="font-semibold text-navy">replaces</span> the
              All-locations owners for this site. “Use the default” removes the override.
            </p>
          )}
          <FieldLabel label="Departments">
            <MultiSelect values={deptIds} onChange={changeDepts} options={deptOptions} placeholder="All departments" />
          </FieldLabel>
          <FieldLabel label="Employees">
            <MultiSelect values={empIds} onChange={setEmpIds} options={peopleOptions} placeholder="Select owners" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
