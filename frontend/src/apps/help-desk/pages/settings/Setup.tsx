import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useHelpStore } from "../../store";
import { saveConfig, saveStepOwners } from "../../data/helpWrites";
import { QUEUE_STEPS, stepByKey, STEPS } from "../../lib/steps";
import { DEFAULT_STEP_SLA, isCategoryTimed, isTriggerStep, TRIGGER_STEPS } from "../../lib/sla";

/**
 * Setup.
 *
 * ⚠ THE ESCALATION FALLBACK IS THE ONE SETTING THAT MATTERS TODAY, and it is put
 *   first for that reason. Every category's level 2 is a LABEL with no portal
 *   account behind it — Management, Finance Head, Admin Vendor, ICC Committee —
 *   so until somebody is named here, a second reopen is recorded and tells
 *   nobody. PF-14 is the standing lesson: four modules shipped with no owners
 *   configured and every approval in them went nowhere, quietly.
 *
 * ⚠ THE `resolve` DUE DATE IS NOT EDITABLE HERE, and the row says why. It comes
 *   from each ticket's CATEGORY, which is the whole point of the category master
 *   — an attendance correction is 1 working day and a PMS query 3, and one
 *   module-wide number would make thirty different promises into one. Offering a
 *   box that is silently ignored would be worse than offering none.
 *
 * ⚠ STEP OWNERS HERE ARE ADDITIVE, NOT REPLACEMENTS. Naming somebody on
 *   `resolve` does not take a ticket away from its category's owner — it adds
 *   them, which is how HR covers for each other. The exception is `raise`: with
 *   nobody named, anyone may raise a ticket (which is what the module is for);
 *   name somebody and only they can.
 */
export default function Setup() {
  const s = useHelpStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const policy = (s.data?.config?.policy ?? {}) as Record<string, unknown>;
  const [fallback, setFallback] = useState<string>(
    (policy.escalation_fallback_user_id as string) ?? "",
  );
  const [frt, setFrt] = useState<string>(String(policy.frt_target_minutes ?? 30));
  const [autoClose, setAutoClose] = useState<string>(
    policy.auto_close_enabled === false ? "no" : "yes",
  );
  const [coordinators, setCoordinators] = useState<string[]>(s.data?.coordinatorIds ?? []);
  const [masterOwners, setMasterOwners] = useState<string[]>(s.data?.masterOwnerIds ?? []);
  const [reassign, setReassign] = useState<string[]>(s.data?.reassignPoolIds ?? []);
  const [owners, setOwners] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const st of STEPS) {
      out[st.key] = s.data?.stepOwners.find((o) => o.stepKey === st.key)?.employeeIds ?? [];
    }
    return out;
  });

  const peopleOptions = useMemo(
    () => s.orgPeople.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople],
  );

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr(null);
    setOk(null);
    try {
      await fn();
      await s.refresh();
      setOk(what);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const noFallback = !fallback;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-bold text-navy">Help Desk settings</h1>

      {err && (
        <p className="mt-3 rounded-xl border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3 text-[13px] text-[#B42318]">
          {err}
        </p>
      )}
      {ok && (
        <p className="mt-3 rounded-xl border border-[#A6F4C5] bg-[#F6FEF9] px-4 py-3 text-[13px] text-[#027A48]">
          Saved. {ok}.
        </p>
      )}

      {/* ── the one that matters ─────────────────────────────────────────── */}
      <Card className={"mt-4 p-5 " + (noFallback ? "border-[#FEDF89] bg-[#FFFAEB]" : "")}>
        <h2 className="text-[15px] font-bold text-navy">Where an escalation goes when nobody is named</h2>
        <p className="mt-1 text-[13px] text-grey-2">
          A ticket reopened once goes to its category's escalation level 1; reopened again, level 2.
          Every level 2 on every category is currently a label (Management, Finance Head, ICC
          Committee) and none of them is an Orange One account, so those escalations land here
          instead.
        </p>
        {noFallback && (
          <p className="mt-2 text-[13px] font-semibold text-[#B54708]">
            Nobody is set. A second reopen is recorded on the ticket and tells no one.
          </p>
        )}
        <div className="mt-3 max-w-md">
          <FieldLabel label="Tell this person instead" hint="Usually the HR Head.">
            <Combobox
              options={peopleOptions}
              value={fallback}
              onChange={setFallback}
              clearable
              searchable
              placeholder="Nobody"
            />
          </FieldLabel>
        </div>
        <div className="mt-3">
          <Button
            disabled={busy !== null}
            onClick={() =>
              void run("the escalation fallback", () =>
                saveConfig("policy", { ...policy, escalation_fallback_user_id: fallback || null }),
              )
            }
          >
            Save
          </Button>
        </div>
      </Card>

      {/* ── who runs the desk ────────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Who runs the desk</h2>

        <div className="mt-3">
          <FieldLabel
            label="Coordinators"
            hint="Can act on any ticket and read the reports. They do NOT get every ticket on their home screen, which would bury their own work."
          >
            <MultiSelect options={peopleOptions} values={coordinators} onChange={setCoordinators} searchable />
          </FieldLabel>
        </div>

        <div className="mt-3">
          <FieldLabel
            label="Can edit the ticket categories"
            hint="Admins and coordinators always can; this adds anybody else."
          >
            <MultiSelect options={peopleOptions} values={masterOwners} onChange={setMasterOwners} searchable />
          </FieldLabel>
        </div>

        <div className="mt-3">
          <FieldLabel
            label="Can be handed a ticket"
            hint="Anybody who already owns a category can be handed one without being listed here. This widens it."
          >
            <MultiSelect options={peopleOptions} values={reassign} onChange={setReassign} searchable />
          </FieldLabel>
        </div>

        <div className="mt-4">
          <Button
            disabled={busy !== null}
            onClick={() =>
              void run("who runs the desk", async () => {
                await saveConfig("process_coordinators", { user_ids: coordinators });
                await saveConfig("master_owners", { department_ids: [], user_ids: masterOwners });
                await saveConfig("reassign_pool", { department_ids: [], user_ids: reassign });
              })
            }
          >
            Save
          </Button>
        </div>
      </Card>

      {/* ── step owners ──────────────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Step owners</h2>
        <p className="mt-1 text-[13px] text-grey-2">
          These ADD to whoever already owns a ticket. They do not replace them. Use it so HR can
          cover for each other.
        </p>
        {STEPS.map((st) => (
          <div key={st.key} className="mt-3">
            <FieldLabel
              label={st.title}
              hint={
                st.key === "raise"
                  ? "⚠ Leave this EMPTY and anyone in the company may raise a ticket, which is what the desk is for. Name somebody and only they can."
                  : undefined
              }
            >
              <MultiSelect
                options={peopleOptions}
                values={owners[st.key] ?? []}
                onChange={(v) => setOwners((o) => ({ ...o, [st.key]: v }))}
                searchable
              />
            </FieldLabel>
          </div>
        ))}
        <div className="mt-4">
          <Button
            disabled={busy !== null}
            onClick={() => void run("step owners", () => saveStepOwners(owners))}
          >
            Save
          </Button>
        </div>
      </Card>

      {/* ── due dates ────────────────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Due dates</h2>
        <ul className="mt-3 divide-y divide-line">
          {QUEUE_STEPS.map((k) => {
            const sla = s.data?.stepSla?.[k] ?? DEFAULT_STEP_SLA[k];
            return (
              <li key={k} className="py-2">
                <p className="text-[13.5px] font-semibold text-navy">{stepByKey(k)?.title}</p>
                {isCategoryTimed(k) ? (
                  // ⚠ No input at all. The number comes from the category, and a
                  //   box that is silently ignored is worse than no box.
                  <p className="mt-0.5 text-[12.5px] text-grey-2">
                    Set per category, on the Ticket Categories screen. An attendance correction is
                    1 working day and a PMS query 3. Five categories are governed by policy and have
                    no due date at all.
                  </p>
                ) : (
                  <p className="mt-0.5 text-[12.5px] text-grey-2">
                    {sla.days} working day{sla.days === 1 ? "" : "s"} after{" "}
                    {isTriggerStep(k)
                      ? TRIGGER_STEPS[k]!.dueAfter.toLowerCase()
                      : (stepByKey(sla.anchor)?.title ?? sla.anchor)}
                    .
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {/* Honest about what this screen does not yet do. */}
        <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-grey-2">
          These are read-only here. Changing one needs an admin to edit the module's settings
          directly, while the category turnarounds, which are the ones HR actually tune, are fully
          editable on the Ticket Categories screen.
        </p>
      </Card>

      {/* ── the rest ─────────────────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Other</h2>

        <div className="mt-3 max-w-xs">
          <FieldLabel
            label="First-reply target (minutes)"
            hint="Reported on, never enforced. The queue's deadlines are whole days. It is the line the First Reply report measures against."
          >
            <TextInput value={frt} onChange={(e) => setFrt(e.target.value)} inputMode="numeric" />
          </FieldLabel>
        </div>

        <div className="mt-3 max-w-md">
          <FieldLabel
            label="Close a ticket the employee never confirms"
            hint="⚠ Closed this way it is recorded as 'no reply', never as satisfied, and carries no rating. The nightly job is separate and is not switched on yet."
          >
            <Combobox
              options={[
                { value: "yes", label: "Yes, after the confirmation window" },
                { value: "no", label: "No, leave it open" },
              ]}
              value={autoClose}
              onChange={setAutoClose}
            />
          </FieldLabel>
        </div>

        <div className="mt-4">
          <Button
            disabled={busy !== null}
            onClick={() =>
              void run("the other settings", () =>
                saveConfig("policy", {
                  ...policy,
                  escalation_fallback_user_id: fallback || null,
                  frt_target_minutes: Number(frt) || 30,
                  auto_close_enabled: autoClose === "yes",
                }),
              )
            }
          >
            Save
          </Button>
        </div>
      </Card>
    </div>
  );
}
