import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useLdStore } from "../../store";
import { masterFields } from "../../lib/masterFields";
import {
  LD_MASTER_TYPES,
  MANDATORY_CYCLES,
  masterTypeLabel,
  type LdMasterType,
  type MandatoryProgram,
  type MasterRow,
  type SessionType,
  type Trainer,
  type Venue,
} from "../../types";

/**
 * The lists this module runs on.
 *
 * ⚠ THIS SCREEN IS WHAT MAKES THE MODULE USABLE WITHOUT US. Before it existed, HR
 *   walked a training need through five approvals, reached step 6 — Trainer
 *   Finalisation — and stopped: the trainer is mandatory, the master held the one
 *   agency we had seeded, and there was no way to add another. Venues and
 *   competencies were empty too; those degrade quietly, the trainer does not.
 *
 * ⚠ SEVEN LISTS, SEVEN OWNERS — `canManageMaster` IS PER TAB. The RLS policy on
 *   each master table is written per type (`fms_ld_is_master_manager('venue', …)`
 *   and so on), so somebody who owns Venues genuinely does open this screen and
 *   find the other six read-only. One page-level flag would offer them six Add
 *   buttons the database then refuses, which reads as a broken app rather than as
 *   a permission.
 *
 * Every grid gets sorting on every column, a cascading searchable filter under
 * every column, 25 a page and the Excel round trip from `MasterCrud`, with no
 * wiring here.
 */

/** The one master with its own gate — see the ⚠ on the tab itself. */
const MANDATORY_TAB = "mandatory_program";

export default function Masters() {
  const s = useLdStore();
  const [tab, setTab] = useState<string>(LD_MASTER_TYPES[0].value);
  const d = s.data;

  /**
   * ⚠ `orgPeople`, NOT `profiles`. The directory is RLS-scoped — a reader sees
   *   themselves and their own downline — so building the internal-trainer picker
   *   from it would offer an HR executive her own team and nobody else, and the
   *   one person who actually runs the Excel training would be unpickable. The
   *   org-wide list is a name-only read that exists for exactly this.
   */
  const employeeOptions: ComboOption[] = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
    [s.orgPeople],
  );

  const ctx = useMemo(() => ({ employeeOptions }), [employeeOptions]);

  /** The name behind an internal trainer's employee id, for the table cell. */
  const personName = (id: string | null) => (id ? s.personName(id) : "—");

  const sessionTypes = d?.sessionTypes ?? [];
  const typeNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of sessionTypes) if (t.code) m.set(t.code, t.name);
    return m;
  }, [sessionTypes]);

  /** A plain name-only master: one column, one field, nothing to describe. */
  const nameOnly = (mt: LdMasterType, rows: MasterRow[], note: string) => (
    <MasterCrud<MasterRow>
      singular={singularOf(mt)}
      rows={rows}
      columns={[{ header: headerOf(mt), render: (r) => r.name }]}
      fields={masterFields(mt, ctx)}
      searchText={(r) => r.name}
      defaultOrder={(r) => r.sortOrder}
      canManage={s.canManageMaster(mt)}
      statusNote={note}
      emptyValues={{ name: "" }}
      toValues={(r) => ({ name: r.name })}
      onSubmit={(id, v, active) => s.writes.saveMaster(mt, id, v, active).then(s.refresh)}
      onToggleActive={(row, active) =>
        s.writes.setMasterActive(mt, row.id, active).then(s.refresh)
      }
    />
  );

  const sessionTypeColumns: MasterColumn<SessionType>[] = [
    { header: "Session type", render: (r) => r.name },
    {
      header: "Report code",
      render: (r) => r.code ?? "—",
      // Free text and one row per value: a dropdown here would only restate the
      // table. The column still sorts.
      filter: false,
    },
  ];

  const trainerColumns: MasterColumn<Trainer>[] = [
    { header: "Trainer", render: (r) => r.name },
    {
      header: "Type",
      render: (r) => (r.trainerType === "internal" ? "Internal" : "External"),
    },
    { header: "Employee", render: (r) => personName(r.employeeId) },
    { header: "Agency", render: (r) => r.agency ?? "—" },
    { header: "Speciality", render: (r) => r.speciality ?? "—" },
    { header: "Contact", render: (r) => r.email ?? r.phone ?? "—", filter: false },
    {
      header: "Rate",
      // ⚠ The rendered text is a grouped number, which sorts as text ("1,200"
      //   before "9"). The raw figure is what it must order by.
      render: (r) => (r.rate === null ? "—" : `₹${r.rate.toLocaleString("en-IN")}`),
      sortValue: (r) => r.rate ?? -1,
      className: "text-right",
      filter: false,
    },
  ];

  const venueColumns: MasterColumn<Venue>[] = [
    { header: "Venue", render: (r) => r.name },
    { header: "Kind", render: (r) => (r.isOnline ? "Online" : "Room") },
    {
      header: "Seats",
      render: (r) => (r.capacity === null ? "—" : String(r.capacity)),
      sortValue: (r) => r.capacity ?? -1,
      className: "text-right",
    },
    { header: "Address", render: (r) => r.address ?? "—", filter: false },
  ];

  const mandatoryColumns: MasterColumn<MandatoryProgram>[] = [
    { header: "Programme", render: (r) => r.name },
    {
      header: "Counts which sessions",
      // The code is the wire; the name beside it is what a reader recognises. A
      // code matching no session type is shown as exactly that, because it means
      // the programme can never be completed by anybody.
      render: (r) => typeNameByCode.get(r.sessionTypeCode) ?? `${r.sessionTypeCode} — no such type`,
    },
    {
      header: "How often",
      render: (r) => MANDATORY_CYCLES.find((c) => c.value === r.cycle)?.label ?? r.cycle,
    },
  ];

  const tabs = [
    ...LD_MASTER_TYPES.map((m) => ({ key: m.value, label: m.plural })),
    { key: MANDATORY_TAB, label: "POSH & Safety" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
          The lists every training screen picks from. Rows are switched off, never deleted — a
          trainer who ran three sessions has to keep reading correctly after they stop being
          offered.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "session_type" && (
        <>
          <MasterCrud<SessionType>
            singular="session type"
            rows={sessionTypes}
            columns={sessionTypeColumns}
            fields={masterFields("session_type", ctx)}
            searchText={(r) => `${r.name} ${r.code ?? ""}`}
            defaultOrder={(r) => r.sortOrder}
            canManage={s.canManageMaster("session_type")}
            statusNote="A deactivated type stops being offered on new requests, plans and sessions; everything already tagged with it keeps it, and keeps counting."
            emptyValues={{ name: "", code: "" }}
            toValues={(r) => ({ name: r.name, code: r.code ?? "" })}
            onSubmit={(id, v, active) =>
              s.writes.saveMaster("session_type", id, v, active).then(s.refresh)
            }
            onToggleActive={(row, active) =>
              s.writes.setMasterActive("session_type", row.id, active).then(s.refresh)
            }
          />
          <Card className="p-4">
            <p className="text-[12.5px] text-grey-2">
              <strong className="text-navy">A session carries several of these at once.</strong> The
              weekly review report counts external-agency and technical trainings on separate lines
              and reports a session that is both under both lines and once in the total — so a
              technical course bought from an agency is tagged External Agency <em>and</em>{" "}
              Technical, not one or the other.
            </p>
            <p className="mt-2 text-[12.5px] text-grey-2">
              <strong className="text-navy">Renaming is safe; changing a report code is not.</strong>{" "}
              Reports and the POSH / Safety compliance count match on the code, so spelling out
              &ldquo;POSH&rdquo; in the name changes nothing, while editing its code{" "}
              <code className="rounded bg-page px-1">posh</code> stops the year&rsquo;s compliance
              finding any of it.
            </p>
          </Card>
        </>
      )}

      {tab === "competency" &&
        nameOnly(
          "competency",
          d?.competencies ?? [],
          "A deactivated competency stops being offered at HR validation; requests already mapped to it keep it.",
        )}

      {tab === "need_source" &&
        nameOnly(
          "need_source",
          d?.needSources ?? [],
          "A deactivated source stops being offered when a training need is raised; needs already raised on it keep it.",
        )}

      {tab === "venue" && (
        <>
          <MasterCrud<Venue>
            singular="venue"
            rows={d?.venues ?? []}
            columns={venueColumns}
            fields={masterFields("venue", ctx)}
            searchText={(r) => `${r.name} ${r.address ?? ""}`}
            defaultOrder={(r) => r.sortOrder}
            canManage={s.canManageMaster("venue")}
            statusNote="A deactivated venue stops being offered when a session is scheduled; sessions already held there keep it."
            emptyValues={{ name: "", address: "", capacity: "", is_online: "no" }}
            toValues={(r) => ({
              name: r.name,
              address: r.address ?? "",
              capacity: r.capacity === null ? "" : String(r.capacity),
              is_online: r.isOnline ? "yes" : "no",
            })}
            onSubmit={(id, v, active) => s.writes.saveMaster("venue", id, v, active).then(s.refresh)}
            onToggleActive={(row, active) =>
              s.writes.setMasterActive("venue", row.id, active).then(s.refresh)
            }
          />
          <Card className="p-4">
            <p className="text-[12.5px] text-grey-2">
              Add at least one online venue. A session scheduled against an online venue asks for a
              joining link instead of a room, and that link is what the invitation carries.
            </p>
          </Card>
        </>
      )}

      {tab === "trainer" && (
        <>
          <MasterCrud<Trainer>
            singular="trainer"
            rows={d?.trainers ?? []}
            columns={trainerColumns}
            fields={masterFields("trainer", ctx)}
            searchText={(r) =>
              `${r.name} ${r.agency ?? ""} ${r.speciality ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`
            }
            defaultOrder={(r) => r.sortOrder}
            canManage={s.canManageMaster("trainer")}
            statusNote="A deactivated trainer stops being offered at Trainer Finalisation; sessions they have already run keep them."
            emptyValues={{
              name: "",
              trainer_type: "external",
              employee_id: "",
              agency: "",
              contact_name: "",
              email: "",
              phone: "",
              speciality: "",
              rate: "",
            }}
            toValues={(r) => ({
              name: r.name,
              trainer_type: r.trainerType,
              employee_id: r.employeeId ?? "",
              agency: r.agency ?? "",
              contact_name: r.contactName ?? "",
              email: r.email ?? "",
              phone: r.phone ?? "",
              speciality: r.speciality ?? "",
              rate: r.rate === null ? "" : String(r.rate),
            })}
            onSubmit={(id, v, active) =>
              s.writes.saveMaster("trainer", id, v, active).then(s.refresh)
            }
            onToggleActive={(row, active) =>
              s.writes.setMasterActive("trainer", row.id, active).then(s.refresh)
            }
          />
          <Card className="p-4">
            <p className="text-[12.5px] text-grey-2">
              <strong className="text-navy">An external trainer never gets a login.</strong> That was
              the client&rsquo;s decision, and the database enforces it: an external row must carry
              no employee, and HR uploads their material, marks their session and reads their
              feedback on their behalf. An <strong className="text-navy">internal</strong> trainer is
              a portal user, so the material, conduct, attendance and assignment steps of their own
              sessions become theirs to do.
            </p>
          </Card>
        </>
      )}

      {tab === "delay_reason" &&
        nameOnly(
          "delay_reason",
          d?.delayReasons ?? [],
          "A deactivated reason stops being offered when a step is put on hold; steps already held on it keep it.",
        )}

      {tab === "followup_action" &&
        nameOnly(
          "followup_action",
          d?.followupActions ?? [],
          "A deactivated action stops being offered at the effectiveness review and at closure; decisions already recorded keep it.",
        )}

      {tab === MANDATORY_TAB && (
        <>
          <MasterCrud<MandatoryProgram>
            singular="mandatory programme"
            rows={d?.mandatoryPrograms ?? []}
            columns={mandatoryColumns}
            fields={[
              {
                key: "name",
                label: "Programme",
                type: "text",
                required: true,
                placeholder: "e.g. Information Security",
              },
              {
                key: "session_type_code",
                label: "Which sessions count for it",
                type: "select",
                required: true,
                // ⚠ The value is the session type's CODE, not its id — that is what
                //   `fms_ld_mandatory_programs.session_type_code` holds and what
                //   `fms_ld_mandatory_status` joins on. A type with no code cannot
                //   back a programme, so it is not offered.
                options: sessionTypes
                  .filter((t) => t.code)
                  .map((t) => ({ value: t.code as string, label: `${t.name} (${t.code})` })),
                hint: "Attending any session tagged with this type is what completes the programme for that person.",
              },
              {
                key: "cycle",
                label: "How often",
                type: "select",
                required: true,
                options: MANDATORY_CYCLES.map((c) => ({ value: c.value, label: c.label })),
              },
            ]}
            searchText={(r) => `${r.name} ${r.sessionTypeCode}`}
            defaultOrder={(r) => r.sortOrder}
            canManage={s.canManageMandatory}
            statusNote="A deactivated programme drops out of the compliance figures from now on; the attendance behind it is untouched."
            emptyValues={{ name: "", session_type_code: "", cycle: "annual" }}
            toValues={(r) => ({
              name: r.name,
              session_type_code: r.sessionTypeCode,
              cycle: r.cycle,
            })}
            onSubmit={(id, v, active) =>
              s.writes.saveMandatoryProgram(id, v, active).then(s.refresh)
            }
            onToggleActive={(row, active) =>
              s.writes.setMandatoryProgramActive(row.id, active).then(s.refresh)
            }
          />
          <Card className="p-4">
            <p className="text-[12.5px] text-grey-2">
              <strong className="text-navy">Everyone, once a year</strong> — the client&rsquo;s rule,
              and it is what makes &ldquo;100% of applicable participants&rdquo; a real denominator
              rather than a guess. Every active internal employee is applicable to every programme
              on this list, and &ldquo;done&rdquo; means <em>attended</em>, not nominated.
            </p>
            <p className="mt-2 text-[12.5px] text-grey-2">
              This list has a{" "}
              <strong className="text-navy">different owner from the seven tabs before it</strong>:
              it is the process coordinators and admins, set in Setup → Coordinators, not the master
              owners. Nobody can request an entry here either — a programme everybody in the company
              must complete is not something to be asked for from a form.
            </p>
          </Card>
        </>
      )}

      {!s.canSeeMasters && !s.canManageMandatory && (
        <Card className="p-4">
          <p className="text-[12.5px] text-grey-2">
            You can read these lists but not change them. An admin assigns an owner per list in Setup
            → Master Owners; until one is set, only admins can edit it. Need a value that is not
            here? Ask for it on <strong className="text-navy">Master Requests</strong> and whoever
            owns the list will see it.
          </p>
        </Card>
      )}
    </div>
  );
}

/** "Add a competency", not "Add a Competencies" — MasterCrud words its own buttons. */
const singularOf = (mt: LdMasterType): string => masterTypeLabel(mt).toLowerCase();

/** The column header for a name-only master: the singular, as written in the list. */
const headerOf = (mt: LdMasterType): string => masterTypeLabel(mt);
