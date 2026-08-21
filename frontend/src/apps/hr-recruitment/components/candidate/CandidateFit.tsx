import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { scoreCandidate, scoreFailureMessage } from "../../data/scoreCandidate";
import { fitBand, fitFill, hasJd, isFitStale, jdFingerprint } from "../../lib/fit";
import { useHrStore } from "../../store";
import ScoreProgress from "./ScoreProgress";
import type { Candidate } from "../../types";

/**
 * AI fit — how this CV lines up with the vacancy's job description.
 *
 * ── WHAT THIS PANEL DELIBERATELY CANNOT DO ─────────────────────────────────
 * There is no shortlist button here, no way to sort or filter the board by
 * score, and no path at all from a number to a stage change. The score is an
 * opinion about a document; every action that moves a person stays exactly
 * where it was. Please keep it that way — the restraint is the feature.
 *
 * The headline is a number, not a gauge. A radial dial would be the definition
 * of overdoing it, and the number plus one 6px bar reads faster anyway.
 */
export default function CandidateFit({ candidate: c }: { candidate: Candidate }) {
  const s = useHrStore();
  const r = s.requisitionById(c.requisitionId);
  const fit = s.fitFor(c.id);

  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  // Held so a score still shows if the save fails — the model call is the
  // expensive part, and losing it to a failed write would be the worst outcome.
  const [justScored, setJustScored] = useState<Awaited<ReturnType<typeof scoreCandidate>> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The seconds counter. Only runs while a score is in flight.
  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (!r) return null;

  const stale = fit ? isFitStale(fit, r) : false;

  /**
   * Note what is NOT here: an AbortController tied to unmount. ScoreProgress
   * promises the score lands even if you walk away, and that promise is only
   * true if the request is left alone — so the in-flight call runs to
   * completion and only the setState is guarded.
   */
  // The AI CV read WRITES a score and SPENDS money on every press, and it was
  // gated by nothing whatsoever. A view-only reader may look at a score that
  // already exists; they may not commission a new one.
  const run = async () => {
    if (!s.canEdit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await scoreCandidate(c.id);
      if (!res.ok) {
        if (alive.current) setErr(scoreFailureMessage(res.reason));
        return;
      }
      if (alive.current) setJustScored(res);
      try {
        await s.saveCandidateScore(c.id, {
          overall: res.data.overall,
          verdict: res.data.verdict,
          axes: res.data.axes,
          notes: res.data.notes,
          cvQuality: res.data.cvQuality,
          // Computed here, from the requisition the browser already holds, and
          // stored verbatim — that is what makes a later JD edit visible as stale.
          jdFingerprint: jdFingerprint(r),
          model: res.data.model,
        });
      } catch (e) {
        if (alive.current) {
          setErr(
            e instanceof Error
              ? `Scored, but couldn't save it: ${e.message}`
              : "Scored, but couldn't save it.",
          );
        }
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // ── 1. The vacancy has no job description ─────────────────────────────────
  // Not a disabled button: a greyed control with a tooltip sends people hunting
  // for why. Requisitions raised before 15 August carry no JD fields, so this
  // will be common — turn the dead end into somewhere to go.
  if (!hasJd(r)) {
    return (
      <div className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-4 py-4">
        <p className="text-[13px] font-semibold text-navy">This vacancy has no job description yet</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-navy/80">
          There's nothing to score against. Add the role summary, the duties and the must-have skills
          to {r.mrfNo} and this will have something to compare with.
        </p>
        <Link
          to={`/hr-recruitment/requisitions/${r.id}`}
          className="mt-2 inline-block text-[12.5px] font-semibold text-orange hover:underline"
        >
          Open {r.mrfNo} →
        </Link>
      </div>
    );
  }

  // ── 2. Scoring ────────────────────────────────────────────────────────────
  if (busy) return <ScoreProgress secs={secs} />;

  const shown = justScored?.ok ? justScored.data : fit;

  // ── 3. Not scored yet ─────────────────────────────────────────────────────
  if (!shown) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-5 text-center">
        <p className="text-[13px] font-semibold text-navy">Not scored yet</p>
        <p className="mx-auto mt-1 max-w-[300px] text-[12.5px] leading-relaxed text-grey">
          See how this CV lines up with the job description — skills, experience, education and the
          duties on {r.mrfNo}. Takes about half a minute.
        </p>
        <Button size="sm" className="mt-3" onClick={run} disabled={!s.canEdit || !c.resumePath}>
          Score against the JD
        </Button>
        {!c.resumePath && (
          <p className="mt-2 text-[12px] text-grey-2">There's no CV on file for this candidate.</p>
        )}
        {err && <p className="mt-2 text-[12px] text-ryg-red">{err}</p>}
      </div>
    );
  }

  // ── 4. Scored ─────────────────────────────────────────────────────────────
  const axes = shown.axes.filter((a) => a.applicable);
  const scoredAt = justScored?.ok ? new Date().toISOString() : fit?.scoredAt;

  /**
   * How much of the picture the vacancy actually gave us.
   *
   * Found in testing, and worth the extra line: a vacancy with only a role
   * summary leaves four of the five axes with nothing to score against, and the
   * one that survives carries the whole weight. That produced a confident
   * "10 / 10 — Strong on paper" off a single parameter, which reads as far more
   * evidence than it is. The number is honest arithmetic; without this caveat
   * the CONFIDENCE it projects is not.
   */
  const thin = axes.length > 0 && axes.length < 3;

  return (
    <div>
      <div className="rounded-xl border border-line bg-page/50 px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold leading-none tabular-nums text-navy">
            {shown.overall}
          </span>
          <span className="text-[13px] text-grey-2">/ 10</span>
          <span className="ml-auto text-[12.5px] font-semibold text-navy">
            {fitBand(shown.overall)}
          </span>
        </div>

        {/* The onboarding meter's shape, one hue. See lib/fit.ts for why not red→green. */}
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full"
            style={{ width: `${shown.overall * 10}%`, background: fitFill(shown.overall) }}
          />
        </div>

        {shown.cvQuality === "scanned" && (
          <p className="mt-2 text-[12px] leading-relaxed text-grey">
            This CV is a scan, so parts of it may not have been readable.
          </p>
        )}
        {shown.notes && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-navy">{shown.notes}</p>
        )}
      </div>

      {thin && (
        <p className="mt-2.5 rounded-lg border border-yellow/40 bg-[#FFF7E6] px-3 py-2 text-[12px] leading-relaxed text-navy">
          Only {axes.length === 1 ? "one" : axes.length} of the five parameters could be scored —{" "}
          {r.mrfNo}'s job description doesn't say enough about the rest, so this rests on less than
          it looks like.{" "}
          <Link
            to={`/hr-recruitment/requisitions/${r.id}`}
            className="font-semibold underline underline-offset-2 hover:text-orange"
          >
            Fill in the JD
          </Link>{" "}
          and score again for a fuller read.
        </p>
      )}

      {stale && !justScored && s.canEdit && (
        <p className="mt-2.5 rounded-lg border border-yellow/40 bg-[#FFF7E6] px-3 py-2 text-[12px] leading-relaxed text-navy">
          The job description has changed since this was scored.{" "}
          <button
            type="button"
            onClick={run}
            className="font-semibold underline underline-offset-2 hover:text-orange"
          >
            Score it again
          </button>
        </p>
      )}

      <SectionHeading className="mt-4">Where it came from</SectionHeading>
      <ul className="mt-2 space-y-2.5">
        {axes.map((a) => (
          <li key={a.key}>
            <div className="flex items-center gap-2">
              <span className="w-[112px] shrink-0 text-[12.5px] leading-5 text-grey">{a.label}</span>
              <span className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-navy">
                {a.score}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${a.score * 10}%`, background: fitFill(a.score) }}
                />
              </span>
            </div>
            {/* Render NOTHING when there is no evidence, rather than a bare number.
                An unexplained score carries authority it has not earned, and a
                blank row makes a prompt regression visible instead of silent. */}
            {a.evidence && (
              <p className="ml-[120px] mt-1 text-[12px] leading-relaxed text-grey">{a.evidence}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-line pt-2.5">
        <p className="text-[12px] text-grey">A second opinion on the paperwork — it hasn't met them.</p>
        <p className="mt-1 text-[11.5px] text-grey-2">
          {scoredAt ? `Scored ${formatDateDMY(scoredAt)}` : "Scored just now"}
          {shown.model ? ` by ${shown.model}` : ""}

          {/* A quiet link, not a button. A prominent one invites re-rolling until
              the number flatters your instinct, which is the exact failure mode
              of a tool that scores people. */}
          {s.canEdit && (
            <>
          {" · "}
          <button
            type="button"
            onClick={run}
            className="font-semibold text-grey underline underline-offset-2 hover:text-navy"
          >
            Score again
          </button>
            </>
          )}
        </p>
        {err && <p className="mt-1 text-[12px] text-ryg-red">{err}</p>}
      </div>
    </div>
  );
}
