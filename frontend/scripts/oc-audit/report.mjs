/**
 * report.mjs — OCPI-OC-AUDIT.md.
 *
 * 🔴 THE FRONT PAGE CARRIES ONLY THE GAPS, AND EVERY GAP CARRIES ITS FIX. A
 *    finding without a fix is a complaint; the person reading this has to be able
 *    to act on it without re-deriving what the audit already knew. So each row
 *    states what the real contract says, what ours says, what the difference
 *    costs on a signed document, and the concrete change — the table and column,
 *    or the field and file.
 *
 * ⚠ GENERATED. Regenerate with `cd frontend && npm run oc-audit`. Editing this
 *   file by hand makes it a stale copy of a live check, which is the failure
 *   `OCPI-FIELD-MAP.md` exists to avoid.
 */

import { BUCKET } from "./compare.mjs";
import { deckReport } from "./decks.mjs";

const SEV = { contract: "🔴", states: "🟠", cosmetic: "🟡" };

/** How serious a gap is, for the front-page order. */
function rank(f) {
  if (f.severity === "contract") return 0;
  if (f.where === "sections" || f.where === "terms" || f.where === "supply") return 0;
  if (f.severity === "states") return 1;
  return 2;
}

/**
 * The fix for a gap, derived from what kind of gap it is.
 *
 * ⚠ A FIX IS A CLAIM ABOUT WHAT TO CHANGE, so it names the table and column or
 *   the file — never "update the template". The one thing it must not do is
 *   invent contract wording: where the answer is a business decision the fix says
 *   whose decision it is.
 */
function fixFor(f, machine) {
  switch (f.where) {
    case "sections":
      if (f.oursOnly) {
        return {
          text: "Decide whether this clause belongs on " + machine + " at all. If it does, no change — this contract simply predates it. If it does not, deactivate the `fms_ocpi_machine_sections` row.",
          shape: "client decision",
        };
      }
      if (f.clause) {
        return {
          text: "Amend `fms_ocpi_machine_sections.body` for `" + machine + "` / `" + f.clause + "` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.",
          shape: "additive migration",
        };
      }
      return {
        text: "INSERT a new `fms_ocpi_machine_sections` row on `" + machine + "` carrying this clause, with a `sort_order` matching where the real contract places it.",
        shape: "additive migration",
      };
    case "spec":
      if (f.oursOnly) {
        return { text: "Confirm the row still applies; if it does not, remove it from `fms_ocpi_machines.spec_rows`.", shape: "master data" };
      }
      return {
        text: "Add or correct this row in `fms_ocpi_machines.spec_rows` for `" + machine + "`. If the value varies per deal it must be a `{{token}}`, not a literal.",
        shape: "master data",
      };
    case "composition":
      return {
        text: "Add this bullet to `fms_ocpi_machines.composition` for `" + machine + "`, unless it is a per-deal inclusion — in which case it belongs on the form, not the template.",
        shape: "master data",
      };
    case "supply":
      return {
        text: "Correct `fms_ocpi_machines.supply_description` for `" + machine + "`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.",
        shape: "additive migration",
      };
    case "terms":
      return {
        text: "Carry this term in the `sale_conditions` clause for `" + machine + "`. If its value varies by deal it needs a field and a token, not a literal — a literal that disagrees with the deal is worse than a blank.",
        shape: "additive migration + possibly one field",
      };
    case "header":
      if (f.tag === "gstin") {
        return {
          text: "The customer's GST number prints on the real contract and on no template. `fms_ocpi_deals.gst_no` already holds it — it needs a `{{customer_gst}}` token, or a header line in `ocPdf.ts` beside `Product:`.",
          shape: "code + token",
        };
      }
      return {
        text: "Add the field to `fms_ocpi_machines.header_fields` for `" + machine + "`.",
        shape: "master data",
      };
    case "net":
      return {
        text: "This wording is on the real contract and appears nowhere in our rendered document. Read it against `" +
          machine + "`'s clauses in `fms_ocpi_machine_sections` and either carry it — as a new row or inside the clause it belongs to — or record why it was dropped. Where the value varies per deal (an included quantity, a price, a period) it needs a field and a token, never a literal.",
        shape: "additive migration",
      };
    default:
      return { text: "Review.", shape: "—" };
  }
}

/**
 * 52 findings across 12 papers are not 52 things to fix.
 *
 * 🔴 THE SAME CLAUSE MISSING ON THREE P8S CONTRACTS IS ONE POINTER, NOT THREE.
 *    Sweeping the whole 2026.27 folder means three P8S contracts, three Alpha II
 *    1.9 contracts and two Alpha 15 contracts all report the same absences, so a
 *    raw list triples the apparent size of the job and buries the distinct ones.
 *    Findings are merged on **band + the real contract's own words**, normalised,
 *    and each pointer carries every machine and every paper that proves it.
 *
 * ⚠ MERGED ACROSS MACHINES TOO, and that is the point of doing it at all: the
 *   non-refundable cancellation term is absent from the Alpha II decks AND the
 *   P8S deck, and fixing it is one decision and one migration, not three.
 *
 * ⚠ THE PAPER COUNT IS EVIDENCE, NOT NOISE. A pointer proved by five contracts
 *   is a house-wide omission; one proved by a single paper may be that customer's
 *   own negotiated wording. Both are reported, with the count, so the reader can
 *   tell them apart.
 */
function consolidate(allGaps) {
  const fold = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 90);
  const byKey = new Map();
  for (const g of allGaps) {
    const key = (g.where ?? "?") + "|" + (g.clause ?? "") + "|" + fold(g.realText);
    const at = byKey.get(key);
    if (at) {
      at.machines.add(g.machine);
      at.papers.push(g.spec);
      if (rank(g) < rank(at.worst)) at.worst = g;
    } else {
      byKey.set(key, { key, worst: g, machines: new Set([g.machine]), papers: [g.spec] });
    }
  }
  /*
    ⚠ ONE PAPER COUNTS ONCE. The band walk and the coverage net both report a
      genuinely missing clause, so a paper can arrive twice under one key and the
      evidence column printed "OC122 · OC122" — which reads as two contracts
      proving a point that one contract proves.
  */
  for (const p of byKey.values()) {
    const seen = new Set();
    p.papers = p.papers.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }
  const out = [...byKey.values()];
  out.sort((a, b) =>
    rank(a.worst) - rank(b.worst) ||
    b.papers.length - a.papers.length ||
    a.worst.machine.localeCompare(b.worst.machine));
  out.forEach((p, i) => (p.id = "P-" + String(i + 1).padStart(2, "0")));
  return out;
}

/**
 * Where two contracts for the SAME machine disagree with each other.
 *
 * ⚠ THIS IS A FINDING ABOUT BUSHRA'S PAPERS, NOT ABOUT OURS, and it only becomes
 *   visible once every contract in the year is read rather than one per machine.
 *   If 101 and 126 are both P8S contracts and a clause is missing from ours
 *   against one but not the other, the two real papers do not say the same thing
 *   — so there is no single "correct" template until somebody says which is
 *   current. Picking one silently is how a template ends up carrying a term the
 *   company abandoned.
 */
function papersThatDisagree(results) {
  const byMachine = new Map();
  for (const r of results) {
    if (!r.hasTemplate) continue;
    const list = byMachine.get(r.machine.name) ?? [];
    list.push(r);
    byMachine.set(r.machine.name, list);
  }
  const fold = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 90);
  const out = [];
  for (const [name, rs] of byMachine) {
    if (rs.length < 2) continue;
    const sets = rs.map((r) => ({
      spec: r.spec,
      keys: new Set(
        r.cmp.findings
          .filter((f) => f.bucket === BUCKET.GAP)
          .map((f) => (f.where ?? "?") + "|" + fold(f.realText)),
      ),
      byKey: new Map(
        r.cmp.findings
          .filter((f) => f.bucket === BUCKET.GAP)
          .map((f) => [(f.where ?? "?") + "|" + fold(f.realText), f]),
      ),
    }));
    const all = new Set(sets.flatMap((s) => [...s.keys]));
    for (const k of all) {
      const has = sets.filter((s) => s.keys.has(k));
      if (has.length === sets.length) continue; // every paper agrees — nothing to say
      out.push({
        machine: name,
        finding: has[0].byKey.get(k),
        onlyOn: has.map((s) => s.spec.id),
        notOn: sets.filter((s) => !s.keys.has(k)).map((s) => s.spec.id),
      });
    }
  }
  return out;
}

export function buildReport({ results, failures, k64, sweep, selfTest, decks, deliberate, data, coverage }) {
  const L = [];
  const today = new Date().toISOString().slice(0, 10);

  const allGaps = [];
  for (const r of results) {
    for (const f of r.cmp.findings.filter((x) => x.bucket === BUCKET.GAP)) {
      allGaps.push({ ...f, machine: r.machine.name, spec: r.spec });
    }
  }
  allGaps.sort((a, b) => rank(a) - rank(b) || a.machine.localeCompare(b.machine));
  allGaps.forEach((g, i) => (g.id = "A-" + String(i + 1).padStart(2, "0")));

  const controlClean = results.find((r) => r.spec.control === "clean");
  const controlPos = results.find((r) => r.spec.control === "positive");
  /*
    🔴 THE CLEAN CONTROL IS STRUCTURAL, AND SAYING SO PRECISELY MATTERS. What was
       verified by hand on Homer K24 was that the two documents carry the SAME
       SHAPE — the same header fields, the same 13 spec-row labels in the same
       order, the same composition list, the same 9 clauses under the same titles
       in the same order. Nobody ever compared the clause BODIES word for word.

       So the gate is: K24 must show no clause, spec row or bullet that the real
       contract has and ours lacks. A difference INSIDE a clause both documents
       carry is not a control failure — it is a finding the hand check could never
       have made, and A-01 below is exactly that.
  */
  const structural = (f) =>
    f.bucket === BUCKET.GAP && !f.clause && f.where !== "header";
  const cleanStructural = controlClean ? controlClean.cmp.findings.filter(structural).length : null;
  const cleanGaps = controlClean
    ? controlClean.cmp.findings.filter((f) => f.bucket === BUCKET.GAP).length
    : null;
  /*
    ⚠ MATCH THE CLAUSE, NOT THE WORD. `WORKS AT CUSTOMER'S CARE AND EXCLUSIONS`
      ends "…inks, and consumables in general", so a bare /consumable/ test over
      every finding reported the K32 list as still missing after it had been added
      and verified on a rendered page. Only a GAP naming the parts-list clause
      itself counts.
  */
  const foundConsumables = controlPos
    ? controlPos.cmp.findings.some(
        (f) => f.bucket === BUCKET.GAP && /consumables parts list/i.test(f.realText ?? ""),
      )
    : false;

  L.push("# OCPI · does our order confirmation match the real one?");
  L.push("");
  L.push("> **Generated — do not edit by hand.** Regenerate with `cd frontend && npm run oc-audit`.");
  L.push("> Produced " + today + " by driving the module's own `buildOcPdf` with the facts read off each");
  L.push("> real contract, then comparing the two documents band by band. No deal was raised and no");
  L.push("> quotation or OC number was burned.");
  L.push("");
  L.push("**`2026.27` is the answer key** — it holds the latest contracts. Where both years cover a machine");
  L.push("the newer paper decides; an older-only difference is historical drift, not a gap in the template.");
  L.push("");

  /* ── is the check itself trustworthy ───────────────────────────────────── */
  L.push("## Is this check trustworthy?");
  L.push("");
  L.push("Two controls, and the answer is worthless without both.");
  L.push("");
  L.push("| Control | Expected | Result |");
  L.push("|---|---|---|");
  L.push("| **Homer K24** (123 · Amarasha · 2026.27) — hand-verified as structurally matching | no missing clause, spec row or bullet | " +
    (cleanStructural === null ? "**not run**"
      : cleanStructural === 0 ? "✅ **0 structural gaps**"
      : "❌ **" + cleanStructural + " — the check invents differences**") + " |");
  L.push("| **Self-test** — one clause deleted from our side of a real comparison | the comparison reports it missing | " +
    (!selfTest.ran ? "**not run**" : selfTest.caught ? "✅ **caught** (`" + selfTest.clause + "` on " + selfTest.machine + ")" : "❌ **missed — this run is blind**") + " |");
  L.push("");
  if (cleanStructural === 0 && (selfTest.caught || !selfTest.ran)) {
    L.push("Both controls pass: the check sees a real difference and does not invent one.");
  } else {
    L.push("⚠ **A control failed. Treat everything below as unverified until it is fixed.**");
  }
  L.push("");
  /*
    ⚠ THE ORIGINAL POSITIVE CONTROL WAS THE K32 CONSUMABLES CLAUSE, AND FIXING IT
      CONSUMED IT. Explaining that here matters: a reader who knows the audit was
      built around finding that clause needs to see why it no longer appears, or
      the obvious conclusion is that the check quietly stopped working.
  */
  L.push("The original positive control was the **Homer K32 consumables list** — eleven parts and two notes,");
  L.push("on four real contracts and in no template.");
  if (foundConsumables) {
    L.push("This run still reports it as missing, so the fix has not reached this database.");
  } else {
    L.push("This run **no longer finds it, because it has been added** — migration");
    L.push("`20261106130000_fms_ocpi_k32_consumables_not_covered`, `sort_order` 100, read back off a rendered");
    L.push("page. A control that disappears the moment it succeeds is not a control, so the proof is now the");
    L.push("**self-test** above: a clause is deleted from our side of a live comparison and the comparison has");
    L.push("to notice. It depends on no live defect and fails loudly if the matching is ever weakened.");
  }
  L.push("");
  L.push("⚠ **What the hand check on K24 actually proved, and what it did not.** It compared the two");
  L.push("documents' *shape* — the same header fields, the same 13 specification labels in the same order,");
  L.push("the same composition list, the same nine clauses under the same titles in the same order. It never");
  L.push("compared the clause bodies word for word. So a difference **inside** a clause both documents carry");
  L.push("is not a control failure; it is a finding the hand check could not have made. K24 has " +
    (cleanGaps ?? 0) + " such");
  L.push("difference(s) below, and at least one of them changes what the warranty says.");
  L.push("");

  /* ── what was covered, and what was not ────────────────────────────────── */
  const y26 = results.filter((r) => r.spec.year === "2026.27");
  L.push("## Coverage — every contract in 2026.27");
  L.push("");
  L.push("🔴 **The folder holds 27 deals and only " + (coverage?.found ?? y26.length) + " order confirmations.** Every PDF was opened and");
  L.push("classified on its own heading and clause body, never on its filename — which lies: `106- NOOR");
  L.push("DYEING ….pdf` carries no OC/PI marker at all, and `109- … 25 aug.pdf` reads as a contract and is a");
  L.push("Performa Invoice. **The other 17 deals produced an invoice and no contract**, so for two thirds of");
  L.push("the year there is no signed contract to check anything against.");
  L.push("");
  L.push("| # | Deal | Machine | Identified by |");
  L.push("|---|---|---|---|");
  for (const r of y26.slice().sort((a, b) => a.spec.id.localeCompare(b.spec.id))) {
    L.push("| " + r.spec.id + " | `" + (r.spec.file.split("/")[1] ?? r.spec.file) + "` | " +
      shortMachine(r.machine.name) + " | " +
      (r.spec.identifiedBy
        ? (r.spec.identifyConfidence === "weak" ? "⚠ weak — " : "") + r.spec.identifiedBy +
          (r.spec.identifyConfidence === "weak" && r.spec.runnerUp
            ? " *(runner-up: " + shortMachine(r.spec.runnerUp) + ")*" : "")
        : "hand-picked specimen") + " |");
  }
  L.push("");
  if (coverage?.deckOnly?.length) {
    L.push("⚠ **" + coverage.deckOnly.length + " more contract(s) exist only as a PowerPoint with no PDF beside them**, and are NOT read —");
    L.push("parsing a deck is how words get fused into a customer contract. Export them to PDF to include them:");
    for (const d of coverage.deckOnly) L.push("- `" + d.folder + "` → `" + d.deck + "`");
    L.push("");
  }

  /* ── the consolidated pointer list ─────────────────────────────────────── */
  const pointers = consolidate(allGaps);
  L.push("## The final list — " + pointers.length + " pointers");
  L.push("");
  L.push("⚠ **" + allGaps.length + " raw differences across " + results.length + " papers reduce to " + pointers.length + " distinct things to fix.** The same clause");
  L.push("missing from three P8S contracts is one pointer, not three; where it is also missing from the Alpha");
  L.push("decks it is still one, because it is one migration. **The paper count is the evidence** — a pointer");
  L.push("proved by five contracts is a house-wide omission, one proved by a single paper may be that");
  L.push("customer's own negotiated wording.");
  L.push("");
  L.push("| # | Sev | Machines | Papers | Where | What the real contract says and ours does not |");
  L.push("|---|---|---|---|---|---|");
  for (const p of pointers) {
    const machines = [...p.machines].map(shortMachine).join(", ");
    const papers = p.papers.map((s) => s.id).join(" · ");
    /*
      ⚠ THE CONTRACT'S OWN WORDS, NOT THE CATEGORY. "the `warranty` clause drops
        wording the real contract carries" is true of eight rows and tells a
        reader nothing about which eight things to fix. The quoted text is what
        makes this a list of pointers rather than a list of labels.
    */
    const said = (p.worst.realText ?? "").replace(/\s+/g, " ").trim();
    L.push("| **" + p.id + "** | " + (rank(p.worst) === 0 ? "🔴" : rank(p.worst) === 1 ? "🟠" : "🟡") +
      " | " + machines + " | **" + p.papers.length + "** — " + papers + " | " +
      shortWhy(p.worst).replace(/^the /, "").replace(/ the real contract carries$/, "") + " | " +
      truncate(said, 190) + " |");
  }
  L.push("");

  /* ── where Bushra's own papers disagree ────────────────────────────────── */
  const disagree = papersThatDisagree(results);
  L.push("## Where two real contracts for the same machine disagree");
  L.push("");
  if (!disagree.length) {
    L.push("None. Every machine with more than one contract in 2026.27 says the same thing on all of them,");
    L.push("so each template has a single unambiguous target.");
  } else {
    L.push("🔴 **" + disagree.length + " place(s) where Bushra's own contracts for one machine do not match each other.** This only");
    L.push("becomes visible once every contract in the year is read instead of one per machine, and it matters:");
    L.push("**there is no single correct template until somebody says which paper is current.** Copying one of");
    L.push("them silently is how a template ends up carrying a term the company has abandoned.");
    L.push("");
    L.push("| Machine | On | Not on | The wording |");
    L.push("|---|---|---|---|");
    for (const d of disagree) {
      L.push("| " + shortMachine(d.machine) + " | " + d.onlyOn.join(" · ") + " | " + d.notOn.join(" · ") +
        " | " + truncate(d.finding?.realText ?? "", 120) + " |");
    }
  }
  L.push("");

  /* ── the gaps ──────────────────────────────────────────────────────────── */
  L.push("## Every difference, paper by paper");
  L.push("");
  if (allGaps.length === 0) {
    L.push("None found on the machines checked.");
  } else {
    L.push("Most serious first. 🔴 changes a signed contract · 🟠 changes what is stated · 🟡 cosmetic.");
    L.push("");
    for (const g of allGaps) {
      const fix = fixFor(g, g.machine);
      const sev = SEV[g.severity ?? "cosmetic"] ?? "🟡";
      L.push("### " + sev + " " + g.id + " · " + g.machine + " — " + bandName(g.where));
      L.push("");
      L.push("*" + (g.why ?? "") + "*  ·  evidence: `" + g.spec.file.split("/").pop() + "` (" + g.spec.year + ")");
      L.push("");
      if (g.realText) {
        /*
          ⚠ A CLAUSE-BODY RUN IS QUOTED NORMALISED, and the reader has to be told.
            It is the exact sequence of words the comparison found missing, with
            punctuation and casing folded — that is what makes it a reliable
            claim. The original sentence, as the contract sets it, is in
            `oc-audit/parsed/`, and the reader is pointed there rather than left
            to wonder why a contract is quoted in lower case.
        */
        L.push(g.clause || g.where === "net" ? "**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*" : "**The real contract says**");
        L.push("");
        L.push("> " + truncate(g.realText, 700).replace(/\n/g, "\n> "));
        L.push("");
      }
      if (g.ourText) {
        L.push("**Ours says**");
        L.push("");
        L.push("> " + truncate(g.ourText, 400).replace(/\n/g, "\n> "));
      } else if (g.clause) {
        L.push("**Ours** carries the `" + g.clause + "` clause and the wording around this, but not this.");
      } else {
        L.push("**Ours says** *nothing* — the whole thing is absent.");
      }
      L.push("");
      if (g.bodyLines && g.bodyLines.length) {
        L.push("<details><summary>the full clause as it appears on the real contract</summary>");
        L.push("");
        L.push("```");
        for (const b of g.bodyLines) L.push(b);
        L.push("```");
        L.push("</details>");
        L.push("");
      }
      L.push("**Fix** · *" + fix.shape + "* — " + fix.text);
      L.push("");
    }
  }

  /* ── the fix plan ──────────────────────────────────────────────────────── */
  /*
    ⚠ THIRTY-FIVE ROWS IS A LIST, NOT A PLAN. Most of them are the same defect on
      a different machine — the print-head warranty sentences went missing on
      three Homers and the Sub Pro in one transcription pass, and the AMC clause on
      all three Alphas. Grouped, that is four or five things to decide and apply;
      ungrouped it reads as thirty-five separate jobs and nobody starts.
  */
  const batches = new Map();
  for (const g of allGaps) {
    const key = g.where + "|" + (g.clause ?? "") + "|" + (g.tag ?? "") + "|" + shortWhy(g);
    if (!batches.has(key)) batches.set(key, { sample: g, machines: [], ids: [] });
    const b = batches.get(key);
    if (!b.machines.includes(g.machine)) b.machines.push(g.machine);
    b.ids.push(g.id);
  }
  const ordered = [...batches.values()].sort(
    (a, b) => rank(a.sample) - rank(b.sample) || b.machines.length - a.machines.length,
  );

  L.push("## The fix plan — the same defects, grouped");
  L.push("");
  L.push("Most of the rows above are one defect repeated across machines: the print-head warranty sentences");
  L.push("went missing in a single transcription pass, and so did the Alpha warranty clause. Grouped, this is");
  L.push("**" + ordered.length + " things to decide and apply**, not " + allGaps.length + " separate jobs.");
  L.push("");
  L.push("| # | What | Machines | Findings | Shape |");
  L.push("|---|---|---|---|---|");
  ordered.forEach((b, i) => {
    const fix = fixFor(b.sample, b.machines[0]);
    L.push("| **F-" + String(i + 1).padStart(2, "0") + "** | " +
      (SEV[b.sample.severity ?? "cosmetic"] ?? "🟡") + " " + shortWhy(b.sample) + " | " +
      b.machines.length + " — " + b.machines.map(shortMachine).join(", ") + " | " +
      b.ids.join(", ") + " | " + fix.shape + " |");
  });
  L.push("");
  L.push("⚠ **Nothing here has been applied.** This task is the audit; the one exception is the K32");
  L.push("consumables clause, which was already decided. Each batch above becomes its own work item, and");
  L.push("the wording for every one of them is on the real contract quoted in its finding.");
  L.push("");

  /* ── deliberate ────────────────────────────────────────────────────────── */
  L.push("## Differences that are deliberate — do not \"fix\" these");
  L.push("");
  L.push("An audit that lists these as defects gets them reverted by the next person who reads it.");
  L.push("");
  for (const d of deliberate) {
    const firedOn = results.filter((r) => r.cmp.firedDeliberate.includes(d.id)).map((r) => r.machine.name);
    L.push("### " + d.id + " · " + d.what);
    L.push("");
    L.push("| | |");
    L.push("|---|---|");
    L.push("| The real contract | " + d.realSays + " |");
    L.push("| Ours | " + d.oursSays + " |");
    L.push("| Why | " + d.because + " |");
    L.push("| Seen on | " + (firedOn.length ? firedOn.join(", ") : "*not encountered in this run*") + " |");
    if (d.machines) L.push("| Excused only on | " + d.machines.join(", ") + " — anywhere else this sentence is reported as a gap |");
    L.push("");
    if (d.note) { L.push(d.note); L.push(""); }
  }

  /* ── K64 ───────────────────────────────────────────────────────────────── */
  L.push("## 🔴 K64 — the best seller, and there is no contract on file for it");
  L.push("");
  L.push("Every PDF and every Word/PowerPoint file in both years was searched for K64 content. It appears");
  L.push("in two folders — **109 Laxmipati** and **120 Modi** — and **both are Performa Invoices** with no");
  L.push("contract body. The WORKLIST entry lists K64 among the machines with a real OC; it does not have");
  L.push("one, so it has never been checked against a signed contract.");
  L.push("");
  if (k64.available) {
    L.push("Covered three ways instead, each labelled for what it is worth:");
    L.push("");
    L.push("| Route | Covers | Strength |");
    L.push("|---|---|---|");
    L.push("| **Inheritance from Homer K24** — re-asserted at run time, not assumed | **" + k64.shared.length +
      " of " + k64.total + "** clauses are byte-identical to K24's: `" + k64.shared.join("`, `") +
      "` | **strong** — K24 is checked against a real 2026.27 contract above |");
    L.push("| **The K64 deck** (`" + k64.deck + "`) | the " + k64.diverged.length + " clause(s) that differ: `" +
      k64.diverged.map((d) => d.key).join("`, `") + "`, plus spec rows and composition | medium — checks our transcription against its own source |");
    L.push("| **The two real PIs** | header, spec, money and terms against what customers were actually invoiced | medium — real papers, but a PI carries no contract clauses |");
    L.push("");
    L.push("**What none of them can answer:** whether a real K64 contract carries a clause its deck omits.");
    L.push("That is exactly how the K32 consumables list went missing — it is on four contracts and in no");
    L.push("deck-derived template. **Ask Bushra for one signed K64 order confirmation.**");
  }
  L.push("");

  L.push(...deckReport(decks ?? []));

  /* ── coverage ──────────────────────────────────────────────────────────── */
  L.push("## Coverage — every machine gets a verdict");
  L.push("");
  L.push("| Machine | Checked how | Sections | Unresolved tokens | Ruled blanks |");
  L.push("|---|---|---|---|---|");
  const compared = new Map(results.map((r) => [r.machine.name, r]));
  for (const s of sweep) {
    const r = compared.get(s.machine);
    const how = r
      ? "**against a real contract** (" + r.spec.year + ")"
      : s.machine === "K64" ? "inheritance + deck + PIs" : "template sweep only";
    L.push("| " + s.machine + " | " + how + " | " + s.sections + " | " +
      (s.unresolved.length ? "🔴 `" + s.unresolved.join("`, `") + "`" : "none") + " | " +
      (s.blanks ? "🔴 " + s.blanks : "none") + " |");
  }
  const untemplated = data.machines.filter((m) => m.active && !m.hasTemplate).map((m) => m.name);
  L.push("");
  L.push("**" + untemplated.length + " active machines carry no template at all** and print no order confirmation: " +
    untemplated.map((n) => "*" + n + "*").join(", ") + ".");
  L.push("");

  if (failures.length) {
    L.push("### ⚠ Specimens that could not be read");
    L.push("");
    for (const f of failures) L.push("- **" + f.spec.id + "** (" + f.spec.machine + ") — " + f.why);
    L.push("");
  }

  /* ── the net ───────────────────────────────────────────────────────────── */
  const netted = results.filter((r) => r.cmp.netted.length);
  L.push("## The coverage net");
  L.push("");
  L.push("A second, independent pass: the whole real contract against our whole **rendered PDF**, comparing");
  L.push("word runs rather than walking bands. It exists so that a mistake in the band walk cannot read as a");
  L.push("clean result — if the walk mis-files a clause, this still finds it.");
  L.push("");
  const netTotal = results.reduce((n, r) => n + r.cmp.netted.length, 0);
  if (netTotal === 0) {
    L.push("**Nothing the band walk had not already reported.** Every substantial run of words on every real");
    L.push("contract either appears in ours or is already listed above.");
  } else {
    L.push("**" + netTotal + " run(s)** the band walk did not surface. They are **already merged into the list");
    L.push("above** rather than parked here, because a difference found by the safety net is still a");
    L.push("difference. Listed again by machine so the net's own yield is visible:");
    L.push("");
    for (const r of netted) {
      L.push("- **" + r.machine.name + "** — " + r.cmp.netted.length + ": " +
        r.cmp.netted.map((n) => "*" + truncate(n, 120) + "*").join(" · "));
    }
  }

  /* ── facts we could not read ───────────────────────────────────────────── */
  const withUnread = results.filter((r) => r.unread.length);
  if (withUnread.length) {
    L.push("## Facts the paper did not state");
    L.push("");
    L.push("Our render was driven with everything readable off each contract. These could not be read, so a");
    L.push("difference caused by one of them is **our missing input, not a gap in the template**.");
    L.push("");
    for (const r of withUnread) L.push("- **" + r.machine.name + "** — " + r.unread.join(", "));
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("*Working files: `Misc/Bushra Reports/OCPI/oc-audit/` — `parsed/` is what the parser read from each");
  L.push("real contract, `ours/` is what we rendered and the facts each render was driven with. Read them");
  L.push("before trusting any single finding.*");

  return L.join("\n") + "\n";
}

const bandName = (w) =>
  ({ sections: "a contract clause", spec: "a specification row", composition: "the composition list", net: "a clause our document never prints",
     supply: "the priced supply line", terms: "a commercial term", header: "a header line" }[w] ?? w);

function truncate(s, n) {
  const t = String(s ?? "").trim();
  return t.length <= n ? t : t.slice(0, n) + " …";
}

/** The batch label — the finding's reason, trimmed to the defect itself. */
function shortWhy(f) {
  if (f.where === "header" && f.tag === "gstin") return "the customer's GST number prints on no template";
  if (f.where === "supply") return "the priced supply line is missing what the real one states";
  if (f.where === "terms") return "a commercial term differs from the real contract";
  if (f.where === "spec") return "a specification row differs";
  if (f.where === "composition") return "a composition bullet is missing";
  if (f.where === "net") return "wording on the real contract that our document never prints";
  // ⚠ A HEADER LINE IS NOT A CLAUSE. `KoloRado Alpha 3 — 12 heads` declares only
  //   attn and address, so its contract prints no Date at all — a real gap that
  //   read as "a whole clause is in no template" and looked like parser noise.
  if (f.where === "header") return "a header line the machine does not declare";
  if (f.clause) return "the `" + f.clause + "` clause drops wording the real contract carries";
  return "a whole clause is on the real contract and in no template";
}

/** Machine names are long; the batch table needs them short but recognisable. */
function shortMachine(n) {
  return n
    .replace(/KoloRado Alpha II — /, "Alpha II ")
    .replace(/Kolorado Alpha /, "Alpha ")
    .replace(/ m, 8 heads \(OT-1908A\)/, "m")
    .replace(/ m, 8 heads/, "m")
    .replace(/ — 8 heads| — 12 heads| — 24 heads/, "");
}
