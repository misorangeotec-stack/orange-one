import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { Select, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { updateSalesPage } from "../../data/ocpiSalesPageWrites";
import type { SalesPageBlock } from "../../types";

/**
 * One sales page's body — page 2 of a machine's Performa Invoice.
 *
 * ⚠ IT IS AN ORDERED LIST OF BLOCKS, NOT A FIXED RECORD, and the real papers are
 *   why. Folder 127's Alpha II page runs tagline → paragraph → "Advantages" →
 *   bullets. Folder 120's K64 page interleaves two prose paragraphs BETWEEN bullet
 *   groups. A {tagline, intro, bullets[]} form would have forced the K64 copy to
 *   be rewritten to fit the shape — and these pages are transcriptions of
 *   invoices customers have already received, so rewriting is the one thing this
 *   must not do.
 *
 * ⚠ EDITING HERE CHANGES FUTURE INVOICES ONLY. Every issued PI is frozen on its
 *   version row, exactly as the quotation and the order confirmation are, so a
 *   page reworded today cannot rewrite a document somebody already holds. Same
 *   reasoning as MachineTemplate, and it is what makes this screen safe to use.
 *
 * ⚠ THIS PAGE IS SHARED. Several machines in a family point at one row, so an
 *   edit here changes every one of them — which is the point, and is said on
 *   screen rather than left to be discovered.
 */

const KINDS: { value: SalesPageBlock["kind"]; label: string; hint: string }[] = [
  { value: "tagline", label: "Tagline", hint: "The line under the heading — “Detailed, Different, Diverse”." },
  { value: "para", label: "Paragraph", hint: "A block of prose." },
  { value: "subhead", label: "Sub-heading", hint: "“Advantages”, “Efficient Media Handling”." },
  { value: "bullet", label: "Bullet", hint: "One bulleted line." },
];

export default function SalesPageEditor() {
  const { id } = useParams<{ id: string }>();
  const s = useOcpiStore();
  const page = s.salesPages.find((p) => p.id === id);

  const [blocks, setBlocks] = useState<SalesPageBlock[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed once — a background refetch must not throw away an in-progress edit.
  // Same guard, for the same reason, as MachineTemplate.
  useEffect(() => {
    if (seeded || !page) return;
    setBlocks(page.blocks);
    setSeeded(true);
  }, [page, seeded]);

  const move = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  };

  if (!page) {
    return (
      <Card className="p-6">
        <h1 className="text-[18px] font-bold text-navy">That sales page does not exist</h1>
        <Link
          to="/ocpi/sales-pages"
          className="mt-1 inline-block text-[13.5px] font-semibold text-orange hover:underline"
        >
          Back to sales pages
        </Link>
      </Card>
    );
  }

  const readOnly = !s.canManageMaster("machine");
  const usedBy = s.machines.filter((m) => m.salesPageId === page.id).map((m) => m.name);

  async function save() {
    if (!page) return;
    setBusy(true);
    setError(null);
    try {
      await updateSalesPage(page.id, { blocks: blocks.filter((b) => b.text.trim() !== "") });
      await s.refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">{page.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            {page.heading} ·{" "}
            <Link to="/ocpi/sales-pages" className="font-semibold text-orange hover:underline">
              all sales pages
            </Link>
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {saved && !busy && <span className="text-[12.5px] text-grey-2">Saved</span>}
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save page"}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] text-ryg-red">{error}</p>
        </Card>
      )}

      {/*
        ⚠ WHO ELSE PRINTS THIS, SAID BEFORE THE EDIT RATHER THAN AFTER. A page is
          shared across a family, so somebody correcting a typo for the 1.9 m
          Alpha II is also editing the 1.8 m and the 2.2 m. That is correct and
          intended — it is simply not obvious from a screen showing one page.
      */}
      <Card className="p-4">
        <p className="text-[13px] text-grey">
          {usedBy.length === 0 ? (
            <>
              <b>No machine points at this page yet</b>, so nothing prints it. Pick it under{" "}
              <Link to="/ocpi/machines" className="font-medium text-orange hover:underline">
                Machines
              </Link>{" "}
              → Performa Invoice sales page.
            </>
          ) : (
            <>
              Printed on the Performa Invoice of{" "}
              <b>{usedBy.join(", ")}</b>
              {usedBy.length > 1 && " — editing here changes all of them"}. Invoices already issued
              are frozen and are not affected.
            </>
          )}
        </p>
      </Card>

      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">The page, line by line</h2>
          <p className="mt-0.5 text-[13px] text-grey-2">
            In the order it prints, under the heading. Copy it off the real invoice rather than
            rewriting it &mdash; this is a page customers have already been sent.
          </p>
        </div>

        {blocks.length === 0 && (
          <p className="text-[13px] text-grey-2">
            Nothing here yet. This page prints as its heading alone until a line is added.
          </p>
        )}

        {blocks.map((b, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2">
            <div className="w-full sm:w-[150px]">
              <Select
                value={b.kind}
                onChange={(e) =>
                  setBlocks(
                    blocks.map((x, j) =>
                      i === j ? { ...x, kind: e.target.value as SalesPageBlock["kind"] } : x,
                    ),
                  )
                }
                disabled={readOnly}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[220px] flex-1">
              <TextArea
                rows={b.kind === "para" ? 3 : 1}
                value={b.text}
                onChange={(e) =>
                  setBlocks(blocks.map((x, j) => (i === j ? { ...x, text: e.target.value } : x)))
                }
                placeholder={KINDS.find((k) => k.value === b.kind)?.hint}
                disabled={readOnly}
              />
            </div>
            {!readOnly && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setBlocks(move(blocks, i, i - 1))}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => setBlocks(move(blocks, i, i + 1))}>↓</Button>
                <Button size="sm" variant="ghost" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>✕</Button>
              </div>
            )}
          </div>
        ))}

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Button
                key={k.value}
                size="sm"
                variant="ghost"
                onClick={() => setBlocks([...blocks, { kind: k.value, text: "" }])}
              >
                + {k.label}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
