import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { replaceSections, updateMachine } from "../../data/ocpiMachineWrites";
import { TOKEN_HELP, tokensUsedIn } from "../../lib/tokens";
import { CONDITION_HELP, conditionsUsedIn, hasUnbalancedMarkers } from "../../lib/conditions";
import type { OcpiMachineSection } from "../../types";

/**
 * One machine's order-confirmation template.
 *
 * ⚠ EDITING HERE CHANGES WHAT FUTURE DOCUMENTS SAY, NOT PAST ONES. Every
 *   finalised quotation freezes the resolved template into its own version row
 *   (`fms_ocpi_quotation_versions.document_payload`), so a clause reworded today
 *   cannot rewrite a document a customer already holds. That is the whole reason
 *   the freeze exists, and it is what makes this screen safe to use.
 *
 * ⚠ THE CONTENT IS A TRANSCRIPTION OF THE POWERPOINT DECKS AND IS AWAITING A
 *   PROOF-READ. Their typos were carried across deliberately — silently
 *   "correcting" a customer-facing contract is not a transcription decision.
 */

type Spec = { label: string; value: string };

export default function MachineTemplate() {
  const { id } = useParams<{ id: string }>();
  const s = useOcpiStore();
  const machine = s.machines.find((m) => m.id === id);

  const [specs, setSpecs] = useState<Spec[]>([]);
  const [composition, setComposition] = useState<string[]>([]);
  const [sections, setSections] = useState<OcpiMachineSection[]>([]);
  const [supply, setSupply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed once — a background refetch must not throw away an in-progress edit.
  useEffect(() => {
    if (seeded || !machine) return;
    setSpecs(machine.specRows);
    setComposition(machine.composition);
    setSupply(machine.supplyDescription ?? "");
    setSections(s.sectionsFor(machine.id));
    setSeeded(true);
  }, [machine, s, seeded]);

  /*
    Every piece of text the renderer resolves, in one list.

    ⚠ THE COMPOSITION AND THE OPENING LINE WERE MISSING FROM THIS SCAN, and both
      are resolved by `ocPdf.ts`. So an unknown placeholder in either printed a
      ruled blank on a contract with nothing on this screen to warn about it.
      The opening line is edited on the Machines master rather than here, which
      is why it was overlooked — but it is this machine's template text and this
      is the page that reports on it.
  */
  const templateText = useMemo(
    () => [
      supply,
      machine?.introText ?? "",
      ...specs.map((sp) => sp.value),
      ...composition,
      ...sections.map((sec) => sec.body),
    ],
    [supply, machine, specs, composition, sections],
  );

  const usedTokens = useMemo(() => {
    const all = new Set<string>();
    for (const t of templateText) for (const x of tokensUsedIn(t)) all.add(x);
    return [...all].sort();
  }, [templateText]);

  const unknownTokens = useMemo(
    () => usedTokens.filter((t) => !TOKEN_HELP.some((h) => h.token === t)),
    [usedTokens],
  );

  const usedConditions = useMemo(() => {
    const all = new Set<string>();
    for (const t of templateText) for (const x of conditionsUsedIn(t)) all.add(x);
    return [...all].sort();
  }, [templateText]);

  const unknownConditions = useMemo(
    () => usedConditions.filter((c) => !CONDITION_HELP.some((h) => h.name === c)),
    [usedConditions],
  );

  /*
    ⚠ REPORTED SEPARATELY FROM AN UNKNOWN NAME, because they are different
      mistakes with opposite consequences. A misspelt condition prints today's
      wording on every deal — wrong, but harmless-looking. An unclosed marker is
      an instruction nobody can read, so the words inside it print on every deal
      whether they belong there or not. One message for both would tell a reader
      neither.
  */
  const brokenMarkers = useMemo(() => templateText.some(hasUnbalancedMarkers), [templateText]);

  if (!machine) {
    return (
      <Card className="p-6">
        <h1 className="text-[18px] font-bold text-navy">That machine does not exist</h1>
        <Link to="/ocpi/machines" className="mt-1 inline-block text-[13.5px] font-semibold text-orange hover:underline">
          Back to machines
        </Link>
      </Card>
    );
  }

  const readOnly = !s.isAdmin;

  async function save() {
    if (!machine) return;
    setBusy(true);
    setError(null);
    try {
      await updateMachine(machine.id, {
        specRows: specs.filter((x) => x.label.trim() || x.value.trim()),
        composition: composition.filter((x) => x.trim()),
        supplyDescription: supply || null,
        // A template counts as built once it has a spec table and at least one
        // section — the two things the order confirmation cannot be printed
        // without.
        hasTemplate: specs.some((x) => x.label.trim()) && sections.length > 0,
      });
      await replaceSections(
        machine.id,
        sections.map((sec, i) => ({
          key: sec.key || `section_${i + 1}`,
          title: sec.title,
          body: sec.body,
          sortOrder: i * 10,
          active: sec.active !== false,
        })),
      );
      await s.refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const move = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const out = [...arr];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x);
    return out;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">{machine.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            {machine.docTitle} ·{" "}
            <Link to="/ocpi/machines" className="font-semibold text-orange hover:underline">
              all machines
            </Link>
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {saved && !busy && <span className="text-[12.5px] text-grey-2">Saved</span>}
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save template"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] text-ryg-red">{error}</p>
        </Card>
      )}

      {unknownTokens.length > 0 && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] font-medium text-navy">
            {unknownTokens.length === 1 ? "One placeholder is not recognised" : "Some placeholders are not recognised"}
          </p>
          <p className="mt-1 text-[13px] text-grey">
            {unknownTokens.map((t) => `{{${t}}}`).join(", ")} — these will print as a blank line on
            every document. Check the spelling against the list at the bottom of this page.
          </p>
        </Card>
      )}

      {unknownConditions.length > 0 && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] font-medium text-navy">
            {unknownConditions.length === 1 ? "One condition is not recognised" : "Some conditions are not recognised"}
          </p>
          <p className="mt-1 text-[13px] text-grey">
            {unknownConditions.map((c) => `[[if ${c}]]`).join(", ")} — the words inside will print on
            every deal, as they do today. Check the spelling against the list at the bottom of this
            page.
          </p>
        </Card>
      )}

      {brokenMarkers && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] font-medium text-navy">A condition is not closed properly</p>
          <p className="mt-1 text-[13px] text-grey">
            Every <code>[[if …]]</code> needs a <code>[[/if]]</code> after it, on the same line, and
            one cannot sit inside another. Until this is fixed the words inside will print on every
            deal, whether they belong there or not.
          </p>
        </Card>
      )}

      {/* ── Specification table ─────────────────────────────────────────── */}
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Specification table</h2>
          <p className="mt-0.5 text-[13px] text-grey-2">
            Page one of the order confirmation. Use a placeholder wherever the deal decides the value
            — a K32 has been sold with 16 heads, so the head count must come from the deal, not from
            here.
          </p>
        </div>
        {specs.map((sp, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2">
            <div className="w-full sm:w-[240px]">
              <TextInput
                value={sp.label}
                onChange={(e) =>
                  setSpecs(specs.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))
                }
                placeholder="Label"
                disabled={readOnly}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <TextArea
                rows={sp.value.includes("\n") ? 2 : 1}
                value={sp.value}
                onChange={(e) =>
                  setSpecs(specs.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))
                }
                placeholder="Value"
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setSpecs(move(specs, i, i - 1))}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => setSpecs(move(specs, i, i + 1))}>↓</Button>
                <Button size="sm" variant="ghost" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>✕</Button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={() => setSpecs([...specs, { label: "", value: "" }])}>
            Add a row
          </Button>
        )}
      </Card>

      {/* ── Supply description + composition ────────────────────────────── */}
      <Card className="space-y-3 p-5">
        <h2 className="text-[15px] font-bold text-navy">What is being supplied</h2>
        <FieldLabel
          label="Priced supply line"
          hint="the one line above Machine Value / GST / Total"
        >
          <TextArea
            rows={2}
            value={supply}
            onChange={(e) => setSupply(e.target.value)}
            disabled={readOnly}
          />
        </FieldLabel>

        <div>
          <p className="text-[13px] font-medium text-navy">The machine is composed as follows</p>
          <p className="mt-0.5 text-[13px] text-grey-2">
            Only what is ALWAYS true of this machine. Air blade, external centering, ink dust
            exhauster and chilling system are asked per deal, so they are added by the document when
            the deal includes them.
          </p>
        </div>
        {composition.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <TextArea
                rows={1}
                value={line}
                onChange={(e) => setComposition(composition.map((x, j) => (i === j ? e.target.value : x)))}
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setComposition(move(composition, i, i - 1))}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => setComposition(move(composition, i, i + 1))}>↓</Button>
                <Button size="sm" variant="ghost" onClick={() => setComposition(composition.filter((_, j) => j !== i))}>✕</Button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={() => setComposition([...composition, ""])}>
            Add a line
          </Button>
        )}
      </Card>

      {/* ── Sections ────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Sections, in print order</h2>
          <p className="mt-0.5 text-[13px] text-grey-2">
            The wording genuinely differs between machine families — the print-head clause has three
            versions across these templates, and the Alpha warranty differs in substance — so each
            machine owns its own copy.
          </p>
        </div>

        {sections.map((sec, i) => (
          <div key={sec.id || i} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-[220px] flex-1">
                <TextInput
                  value={sec.title}
                  onChange={(e) =>
                    setSections(sections.map((x, j) => (i === j ? { ...x, title: e.target.value } : x)))
                  }
                  placeholder="Heading"
                  disabled={readOnly}
                />
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setSections(move(sections, i, i - 1))}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSections(move(sections, i, i + 1))}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSections(sections.filter((_, j) => j !== i))}>✕</Button>
                </div>
              )}
            </div>
            <div className="mt-2">
              <TextArea
                rows={Math.min(14, Math.max(3, sec.body.split("\n").length + 1))}
                value={sec.body}
                onChange={(e) =>
                  setSections(sections.map((x, j) => (i === j ? { ...x, body: e.target.value } : x)))
                }
                disabled={readOnly}
              />
            </div>
          </div>
        ))}

        {!readOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSections([
                ...sections,
                {
                  id: "",
                  machineId: machine.id,
                  key: `section_${sections.length + 1}`,
                  title: "",
                  body: "",
                  sortOrder: sections.length * 10,
                  active: true,
                },
              ])
            }
          >
            Add a section
          </Button>
        )}
      </Card>

      {/* ── Token reference ─────────────────────────────────────────────── */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Placeholders you can use</h2>
        <p className="mt-0.5 text-[13px] text-grey-2">
          Type these anywhere above and the deal fills them in. Anything left unanswered prints as a
          ruled blank, exactly as the paper version does — never as the braces themselves.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {TOKEN_HELP.map((t) => (
            <div key={t.token} className="flex gap-2 text-[12.5px]">
              <dt className={usedTokens.includes(t.token) ? "font-semibold text-orange" : "font-medium text-navy"}>
                {`{{${t.token}}}`}
              </dt>
              <dd className="text-grey-2">{t.means}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ── Condition reference ─────────────────────────────────────────── */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Wording that depends on the deal</h2>
        <p className="mt-0.5 text-[13px] text-grey-2">
          Wrap words in <code>[[if dryer]]…[[/if]]</code> and they print only on a deal that carries
          one. Use <code>[[if !dryer]]</code> for the opposite. Keep it on ONE line, and put the
          space or comma <em>inside</em> the wrapper — write{" "}
          <code>PRINTHEADS[[if dryer]] &amp; DRYER[[/if]]</code>, not{" "}
          <code>PRINTHEADS [[if dryer]]&amp; DRYER[[/if]]</code>, or a deal without a dryer prints a
          stray space. A line left with nothing on it disappears, and so does a specification row.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {CONDITION_HELP.map((c) => (
            <div key={c.name} className="flex gap-2 text-[12.5px]">
              <dt className={usedConditions.includes(c.name) ? "font-semibold text-orange" : "font-medium text-navy"}>
                {`[[if ${c.name}]]`}
              </dt>
              <dd className="text-grey-2">{c.means}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
