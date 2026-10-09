import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import { rememberReturnTo } from "@/shared/lib/returnTo";
import { useRailWhileMounted } from "@/shared/components/layout/navRail";
import AccessDenied from "../system/AccessDenied";
import CandidateDetail from "../../components/candidate/CandidateDetail";
import MoveToPipelineModal from "../../components/candidate/MoveToPipelineModal";
import { useHrStore } from "../../store";
import { PHASE_FILL, PHASE_OF, PHASE_PILL, STAGE_LABEL } from "../../lib/board";
import { tintFor } from "../../lib/tint";
import type { Candidate } from "../../types";

/** The route this bucket owns — the key its "back here" href is remembered under. */
export const FUTURE_REF_ROUTE = "/hr-recruitment/future-reference";

/**
 * The Future Reference bucket — every candidate moved OUT of a pipeline "for later".
 *
 * A CV that is not right for one vacancy is often right for the next. The candidate
 * page's "Future reference" button takes them off the board (not a copy — the same
 * candidate), and they all wait here, whatever vacancy they came from and however old
 * it is. "Move to pipeline" puts them back: on their own vacancy at the stage they
 * left, or on another posted vacancy at Resumes Uploaded.
 *
 * Works like the Pipeline dashboard: clicking a name opens the full candidate view
 * IN PLACE (`?c=<id>`), with ‹ › walking the bucket, rather than leaving the page.
 *
 * Visible to admins and to the HR people named in Setup → Future Reference. RLS
 * agrees: that list is the same config key fms_hr_is_future_ref_viewer() reads, and
 * it grants READ over saved candidates only.
 */
export default function FutureReference() {
  const s = useHrStore();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [moving, setMoving] = useState<Candidate | null>(null);

  const openId = params.get("c");
  // The detail is three columns wide, as on the Pipeline dashboard.
  useRailWhileMounted(!!openId);

  const openCandidate = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("c", id);
    setParams(next);
  };
  const closeCandidate = () => {
    const next = new URLSearchParams(params);
    next.delete("c");
    setParams(next);
  };

  useEffect(() => {
    rememberReturnTo(FUTURE_REF_ROUTE, `${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  const rows = s.futureRefCandidates;

  const positionLabel = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    return r ? `${r.mrfNo} · ${r.jobTitle}` : "—";
  };
  const departmentName = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    if (!r) return "—";
    return s.departments.find((d) => d.id === r.departmentId)?.name ?? "—";
  };
  const tagText = (c: Candidate): string => [...c.skills, ...c.tags].join(", ");

  const summary = useMemo(() => {
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    return {
      total: rows.length,
      recent: rows.filter((c) => (c.futureRefAt ?? "") >= monthAgo).length,
      vacancies: new Set(rows.map((c) => c.requisitionId)).size,
    };
  }, [rows]);

  const columns: QueueColumn<Candidate>[] = useMemo(
    () => [
      {
        key: "candidate",
        header: "Candidate",
        alwaysVisible: true,
        cell: (c) => (
          <span className="inline-flex max-w-full items-center gap-2.5">
            <span className="shrink-0">
              <Avatar name={c.name} color={tintFor(c.id)} size={28} />
            </span>
            <span className="min-w-0 truncate">
              <button
                type="button"
                onClick={() => openCandidate(c.id)}
                className="text-[14px] font-semibold leading-tight text-navy hover:text-orange hover:underline"
              >
                {c.name}
              </button>
              <span className="ml-1.5 text-[11.5px] text-grey-2">{c.candidateNo ?? "—"}</span>
            </span>
          </span>
        ),
        sortValue: (c) => c.name,
        filter: {
          kind: "text",
          get: (c) => `${c.name} ${c.candidateNo ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`,
        },
        exportValue: (c) => c.name,
      },
      {
        key: "note",
        header: "Why kept",
        cell: (c) =>
          c.futureRefNote ? (
            <span className="text-[12.5px] text-navy">{c.futureRefNote}</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (c) => c.futureRefNote ?? "",
        filter: { kind: "text", get: (c) => c.futureRefNote ?? "" },
        exportValue: (c) => c.futureRefNote ?? "",
      },
      {
        key: "position",
        header: "Saved from",
        cell: (c) => {
          const r = s.requisitionById(c.requisitionId);
          if (!r) return <span className="text-grey-2">—</span>;
          return (
            <>
              <span className="text-[13px] font-medium text-navy">{r.jobTitle}</span>
              <span className="ml-1.5 text-[11.5px] text-grey-2">{r.mrfNo}</span>
            </>
          );
        },
        sortValue: positionLabel,
        filter: { kind: "multiselect", get: positionLabel },
        exportValue: positionLabel,
      },
      {
        key: "stage",
        header: "Stage when moved out",
        cell: (c) => {
          const phase = PHASE_OF[c.stage];
          return (
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PHASE_PILL[phase]}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PHASE_FILL[phase] }} aria-hidden="true" />
              {STAGE_LABEL[c.stage]}
            </span>
          );
        },
        resize: false,
        sortValue: (c) => STAGE_LABEL[c.stage],
        filter: { kind: "multiselect", get: (c) => STAGE_LABEL[c.stage] },
        exportValue: (c) => STAGE_LABEL[c.stage],
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "phone",
        header: "Phone",
        cell: (c) => <span className="text-grey">{c.phone ?? "—"}</span>,
        sortValue: (c) => c.phone ?? "",
        filter: { kind: "text", get: (c) => c.phone ?? "" },
        exportValue: (c) => c.phone ?? "",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "email",
        header: "Email",
        cell: (c) => <span className="text-grey">{c.email ?? "—"}</span>,
        sortValue: (c) => c.email ?? "",
        filter: { kind: "text", get: (c) => c.email ?? "" },
        exportValue: (c) => c.email ?? "",
      },
      {
        key: "experience",
        header: "Experience",
        cell: (c) => (
          <span className="text-grey tabular-nums">{c.experienceYears === null ? "—" : `${c.experienceYears} yr`}</span>
        ),
        sortValue: (c) => c.experienceYears ?? -1,
        filter: { kind: "number", get: (c) => c.experienceYears ?? -1 },
        exportValue: (c) => c.experienceYears ?? "",
        align: "right",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "savedBy",
        header: "Moved by",
        cell: (c) => <span className="text-grey">{c.futureRefBy ? s.personName(c.futureRefBy) : "—"}</span>,
        sortValue: (c) => (c.futureRefBy ? s.personName(c.futureRefBy) : ""),
        filter: { kind: "select", get: (c) => (c.futureRefBy ? s.personName(c.futureRefBy) : "—") },
        exportValue: (c) => (c.futureRefBy ? s.personName(c.futureRefBy) : ""),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "savedOn",
        header: "Moved on",
        cell: (c) => <span className="text-grey">{formatDateDMY(c.futureRefAt)}</span>,
        sortValue: (c) => c.futureRefAt ?? "",
        filter: { kind: "date", get: (c) => c.futureRefAt ?? "" },
        exportValue: (c) => formatDateDMY(c.futureRefAt),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "department",
        header: "Department",
        defaultHidden: true,
        cell: (c) => <span className="text-grey">{departmentName(c)}</span>,
        sortValue: departmentName,
        filter: { kind: "select", get: departmentName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "company",
        header: "Current company",
        defaultHidden: true,
        cell: (c) => <span className="text-grey">{c.currentCompany ?? "—"}</span>,
        sortValue: (c) => c.currentCompany ?? "",
        filter: { kind: "text", get: (c) => c.currentCompany ?? "" },
        exportValue: (c) => c.currentCompany ?? "",
      },
      {
        key: "tags",
        header: "Skills & tags",
        defaultHidden: true,
        cell: (c) => {
          const text = tagText(c);
          return text ? <span className="text-[12.5px] text-grey">{text}</span> : <span className="text-grey-2">—</span>;
        },
        sortValue: tagText,
        filter: { kind: "text", get: tagText },
        exportValue: tagText,
      },
      {
        key: "action",
        header: "Action",
        alwaysVisible: true,
        resize: false,
        cell: (c) =>
          s.canEdit ? (
            <Button size="sm" onClick={() => setMoving(c)}>
              Move to pipeline
            </Button>
          ) : null,
        tdClassName: "whitespace-nowrap",
      },
    ],
    // The whole store: names, vacancies and people all read live data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s],
  );

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (s.error) {
    return <p className="text-[13.5px] text-ryg-red">Couldn't load HR data: {(s.error as Error).message}</p>;
  }
  if (!s.canSeeFutureRef) return <AccessDenied />;

  /* ------------------------------- detail mode --------------------------------- */
  const openRow = openId ? rows.find((c) => c.id === openId) : undefined;
  if (openRow) {
    const idx = rows.findIndex((c) => c.id === openRow.id);
    const prev = idx > 0 ? rows[idx - 1] : null;
    const next = idx < rows.length - 1 ? rows[idx + 1] : null;
    return (
      <div className="space-y-3">
        <nav className="text-[12.5px] text-grey-2" aria-label="Breadcrumb">
          <button onClick={closeCandidate} className="font-semibold text-orange hover:underline">
            Future Reference
          </button>
          <span className="mx-1.5" aria-hidden="true">
            /
          </span>
          <span className="text-navy">{openRow.name}</span>
        </nav>
        <CandidateDetail
          candidate={openRow}
          onBack={closeCandidate}
          backLabel="Back to Future Reference"
          pager={{ index: idx + 1, total: rows.length, prev, next, go: openCandidate, label: "in Future Reference" }}
          onOpenCandidate={openCandidate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Future Reference</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Candidates taken out of a pipeline and kept for later. Click a name to see the full candidate, or press{" "}
          <strong className="font-semibold text-navy">Move to pipeline</strong> to put them on a vacancy again.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="In the bucket" value={summary.total} hint="waiting for a vacancy" />
        <Kpi label="Last 30 days" value={summary.recent} hint="moved in recently" />
        <Kpi label="Vacancies" value={summary.vacancies} hint="they came from" />
      </div>

      <Card className="p-4">
        <QueueTable<Candidate>
          rows={rows}
          rowKey={(c) => c.id}
          columns={columns}
          resizeKey="hr-recruitment.future-reference"
          rowsLabel="candidates"
          emptyTitle="Nothing saved yet"
          emptyMessage="Open a candidate and press “Future reference” to take them out of the pipeline and keep them here."
          initialSort={{ key: "savedOn", dir: "desc" }}
          columnPicker={{ storageKey: "hr-future-reference" }}
          exportName="HR_Future_Reference"
          exportTitle="Future Reference"
          exportNotes={[
            "Candidates moved out of a pipeline into Future Reference, from every vacancy, whatever its age.",
            "'Stage when moved out' is where they were; moving them back to the same vacancy returns them to it.",
            "Contains candidate names, phone numbers and email addresses — this is personal data. Handle accordingly.",
          ]}
        />
      </Card>

      {moving && <MoveToPipelineModal candidate={moving} open={!!moving} onClose={() => setMoving(null)} />}
    </div>
  );
}
