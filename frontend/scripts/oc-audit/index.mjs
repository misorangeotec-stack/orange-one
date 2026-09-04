#!/usr/bin/env node
/**
 * OCPI-37 — does our order confirmation match the one Bushra actually sends?
 *
 * OCPI-12 compared the FORM against OUR OWN PDFs, so it could never find a clause
 * nobody ever transcribed. This has an external answer key: the real contracts in
 * `Misc/Bushra Reports/OCPI/`. It drives the module's OWN renderer with the facts
 * read off each real paper, then compares the two documents band by band.
 *
 * USAGE (from `frontend/`):  npm run oc-audit
 *
 * OUTPUT
 *   OCPI-OC-AUDIT.md                                (repo root, committed)
 *   Misc/Bushra Reports/OCPI/oc-audit/parsed/*.txt  (what the parser read)
 *   Misc/Bushra Reports/OCPI/oc-audit/ours/*.pdf    (what we render, + its facts)
 *
 * CREDENTIALS: `frontend/.env.local` plus the local browser-testing account, the
 * same pair `npm run field-map` uses. The password is never printed.
 *
 * 🔴 NO DEAL IS RAISED AND NO NUMBER IS BURNED. Producing a real OC means
 *    approving a quotation — which the module refuses to let one account do alone
 *    — and consumes a quotation number and an OC number permanently. Rendering
 *    against live master data costs nothing and is reversible by doing nothing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPdfLines, asText } from "./pdfText.mjs";
import { parseRealOc, parseToText, titleKey } from "./parseRealOc.mjs";
import { loadModuleCode, installAssetFetch } from "./ourRenderer.mjs";
import { factsFromPaper } from "./factsFromPaper.mjs";
import { compareDocuments, BUCKET } from "./compare.mjs";
import { SPECIMENS, K64_ROUTES, DELIBERATE, NEW_DECKS } from "./specimens.mjs";
import { walkPdfs, classify, identifyMachine, deckOnlyContracts } from "./discover.mjs";
import { readDecks } from "./decks.mjs";
import { buildReport } from "./report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..", "..");
const REPO = resolve(FRONTEND, "..");
const PAPERS = join(REPO, "Misc", "Bushra Reports", "OCPI");
const OUT = join(PAPERS, "oc-audit");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";
const BUILD = join(
  process.env.TEMP ?? "C:/Users/Admin/AppData/Local/Temp",
  "claude", "oc-audit-build",
);

function loadEnv() {
  const f = join(FRONTEND, ".env.local");
  if (!existsSync(f)) throw new Error("frontend/.env.local not found");
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const say = (...a) => console.log(...a);

async function main() {
  loadEnv();
  installAssetFetch();
  for (const d of ["parsed", "ours", "decks", "fixes"]) mkdirSync(join(OUT, d), { recursive: true });

  say("· loading the module's own renderer");
  const mod = await loadModuleCode(BUILD);

  if (!existsSync(CREDS)) throw new Error("Credentials file not found: " + CREDS);
  const { orangeOne } = JSON.parse(readFileSync(CREDS, "utf8"));
  const { error: authErr } = await mod.supabase.auth.signInWithPassword({
    email: orangeOne.username,
    password: orangeOne.password,
  });
  if (authErr) throw new Error("Sign-in failed: " + authErr.message);

  say("· reading live masters");
  const data = await mod.fetchers.fetchOcpiData();
  const machines = data.machines;
  const sections = data.machineSections;
  const profile = data.companyProfiles.find((p) => p.isDefault) ?? data.companyProfiles[0];
  const skeleton = data.deals[0];
  if (!skeleton) throw new Error("no deal row to use as a skeleton");

  /*
    The vocabulary of clause titles the module knows. Built from EVERY machine,
    not just the one being compared: a real contract may carry a clause another
    machine's template has, and calling that "unknown" would report a false new
    clause. Only titles nothing in the estate uses are unknown — and an unknown
    title is precisely the finding this audit exists for.
  */
  const knownTitles = new Set(sections.filter((s) => s.active).map((s) => titleKey(s.title ?? "")));

  const warranty = data.config.warranty
    ? { machineMonths: data.config.warranty.machineMonths, headMonths: data.config.warranty.headMonths }
    : undefined;

  /*
    ── EVERY CONTRACT IN 2026.27, NOT A HAND-PICKED SIX ──────────────────────

    Ritesh Bhai, 03-Sep-2026: *"you have just checked six to seven reports, but I
    want you to go through all the reports in the 2026-27 folder. I think there
    are 27 of them."*

    🔴 THERE ARE 27 DEAL FOLDERS AND ONLY 10 ORDER CONFIRMATIONS. Classified by
       reading all 50 PDFs, never by filename: 10 contracts, 33 Performa
       Invoices, 3 accessory-only PIs (Pankaj's separate dryer and ink papers,
       which carry no OTPL number), 4 image-only scans of already-covered papers.
       Two more folders — 102 Nayodra and 127 Sumati — hold their contract ONLY
       as a `.pptx` with no PDF beside it, and those are reported as uncovered
       rather than parsed. **Seventeen of the twenty-seven deals never produced a
       contract at all**, which is itself a finding and goes on the front page.

    ⚠ THE CURATED ENTRY WINS WHERE ONE EXISTS. `SPECIMENS` carries the controls,
      the two 2025.26 papers and the hand-written notes; discovery only ADDS the
      2026.27 contracts nobody had picked. A discovered paper whose machine
      cannot be identified is a FAILURE, never a silent skip.
  */
  const found = [];
  for (const f of await walkPdfs(join(PAPERS, "2026.27 OC&PI"))) {
    const c = await classify(f);
    if (c.kind === "contract") found.push(c);
  }
  const curatedFiles = new Set(SPECIMENS.map((s) => join(PAPERS, s.file).toLowerCase()));
  const discovered = [];
  for (const c of found) {
    if (curatedFiles.has(c.file.toLowerCase())) continue;
    const rel = c.file.slice(PAPERS.length + 1).replace(/\\/g, "/");
    /*
      ⚠ THE DEAL NUMBER COMES FROM THE PAPER FIRST AND THE FOLDER SECOND, never
        from the path blindly. Three of the ten contracts print no `OTPL/OC/nnn`
        at all — 108, 110 and 111 lose it to the PowerPoint box order — and
        slicing the relative path instead named one of them "OC202", after the
        year folder. The deal number is the first run of digits in the FOLDER
        name, which is how Bushra files them.
    */
    const folder = rel.split("/")[1] ?? "";
    const id = c.docNo?.match(/\/(\d+)\//)?.[1] ?? /^\s*(\d+)/.exec(folder)?.[1] ?? folder.slice(0, 6);
    /*
      ⚠ PARSED BEFORE IT IS IDENTIFIED, because the specification table is what
        identifies the machine and names do not — see `identifyMachine`. The
        paper is parsed twice as a result, once here and once in the main loop;
        that is a few hundred milliseconds against the alternative of matching a
        contract to the wrong template and reporting its every clause as a gap.
    */
    const pre = parseRealOc(c.doc, knownTitles);
    const { machine: m, score, why, runnerUp, confidence } =
      identifyMachine(c.lines, machines, pre.specRows);
    discovered.push({
      id: "OC" + id,
      machine: m?.name ?? null,
      year: "2026.27",
      file: rel,
      discovered: true,
      identifiedBy: why.join(" + ") || "nothing",
      identifyScore: score,
      identifyConfidence: confidence,
      runnerUp: runnerUp ? runnerUp.machine.name : null,
      note: "Found by sweeping 2026.27 — every PDF classified on its own heading and clause body.",
    });
  }
  discovered.sort((a, b) => a.id.localeCompare(b.id));
  say("· 2026.27 holds " + found.length + " contracts; " +
      (found.length - discovered.length) + " already curated, " + discovered.length + " newly swept in");

  const deckOnly = await deckOnlyContracts(join(PAPERS, "2026.27 OC&PI"));

  const results = [];
  const failures = [];

  for (const spec of [...SPECIMENS, ...discovered]) {
    if (!spec.machine) {
      failures.push({ spec, why: "the machine could not be identified from the paper's own text" });
      continue;
    }
    const machine = machines.find((m) => m.name === spec.machine);
    if (!machine) {
      failures.push({ spec, why: "machine '" + spec.machine + "' is not in the master" });
      continue;
    }
    const file = join(PAPERS, spec.file);
    if (!existsSync(file)) {
      failures.push({ spec, why: "paper not found: " + spec.file });
      continue;
    }

    say("· " + spec.id + "  " + spec.machine);
    const doc = await readPdfLines(file);
    if (!doc.hasTextLayer) {
      failures.push({ spec, why: "the PDF is an image-only scan with no text layer" });
      continue;
    }
    const real = parseRealOc(doc, knownTitles);

    const mySections = sections
      .filter((s) => s.machineId === machine.id && s.active)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const { deal, unread, read } = factsFromPaper(real, skeleton, {
      machine,
      categories: data.machineCategories,
      dryerTypes: data.dryerTypes,
    });

    const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
    const input = {
      deal, machine, sections: mySections, facts, profile,
      validityDays: data.config.quotationValidityDays,
      warranty, warrantyNote: data.config.warrantyNote,
    };

    let ours = null;
    let ourText = "";
    let ourPdfPath = null;
    if (machine.hasTemplate) {
      ours = mod.resolvedOcDocument(input);
      const pdf = await mod.buildOcPdf(input);
      ourPdfPath = join(OUT, "ours", spec.id + "-ours.pdf");
      writeFileSync(ourPdfPath, Buffer.from(pdf.output("arraybuffer")));
      ourText = asText(await readPdfLines(ourPdfPath));
    }

    writeFileSync(
      join(OUT, "parsed", spec.id + "-real.txt"),
      parseToText(real, {
        title: spec.id + " — " + spec.machine,
        paper: spec.file,
        year: spec.year,
        note: spec.note,
      }),
      "utf8",
    );
    writeFileSync(
      join(OUT, "ours", spec.id + "-facts.json"),
      JSON.stringify({ readOffThePaper: read, couldNotRead: unread, deal }, null, 2),
      "utf8",
    );

    const cmp = machine.hasTemplate
      ? compareDocuments(real, ours, ourText, {
          machineName: machine.name,
          normalise: mod.normalise,
          deliberate: DELIBERATE,
        })
      : { findings: [], netted: [], firedDeliberate: [], staleDeliberate: [] };

    results.push({ spec, machine, real, ours, cmp, unread, read, ourPdfPath, hasTemplate: machine.hasTemplate });
  }

  /* ── can this check still see a missing clause? ────────────────────────── */
  const selfTest = provesItCanSee(results, mod.normalise);

  /* ── K64, which has no contract of its own ─────────────────────────────── */
  const k64 = k64Coverage(machines, sections, mod.normalise);

  say("· reading the two decks added 02-09-2026");
  const decks = await readDecks(
    NEW_DECKS.map((d) => ({ ...d, path: join(PAPERS, d.file) })),
    machines,
    sections,
  );

  /* ── the whole-estate sweep ────────────────────────────────────────────── */
  say("· sweeping all templated machines for unresolved tokens");
  const sweep = await sweepEstate(mod, data, profile, warranty, skeleton);

  /* ── self-assertions: no loose ends ────────────────────────────────────── */
  assertNoLooseEnds({
    results, failures, sweep, selfTest,
    attempted: SPECIMENS.length + discovered.length,
    found: found.length,
    deckOnly,
  });

  const md = buildReport({
    results, failures, k64, sweep, selfTest, decks, deliberate: DELIBERATE, data,
    coverage: { found: found.length, deckOnly, discovered: discovered.length },
  });
  const reportPath = join(REPO, "OCPI-OC-AUDIT.md");
  writeFileSync(reportPath, md, "utf8");

  const gaps = results.flatMap((r) => r.cmp.findings.filter((f) => f.bucket === BUCKET.GAP));
  say("");
  say("  specimens " + results.length + "   gaps " + gaps.length +
      "   failures " + failures.length + "   sweep " + sweep.length);
  say("  wrote " + reportPath);
}

/**
 * Prove the comparison can still see a missing clause.
 *
 * 🔴 THE KNOWN-POSITIVE CONTROL CONSUMED ITSELF. Until 02-09-2026 the proof that
 *    this check works was that it found `HOMER K32 CONSUMABLES PARTS LIST WHICH
 *    NOT COVER UNDER WARRANTY` — on four real contracts and in no template. That
 *    clause has now been added, so the probe passes silently and the audit can no
 *    longer demonstrate anything by finding it. A control that disappears the
 *    moment it succeeds is not a control.
 *
 *    So the proof is synthetic and permanent instead: take a real specimen, DELETE
 *    one clause from our side of the comparison, and require the comparator to
 *    report it. It depends on no live defect, and it fails loudly if somebody
 *    later weakens the matching — which is the failure that would turn this whole
 *    report into a page of false reassurance.
 */
function provesItCanSee(results, normalise) {
  const subject = results.find((r) => r.hasTemplate && (r.ours?.sections ?? []).length > 2);
  if (!subject) return { ran: false };

  /*
    ⚠ THE VICTIM MUST HAVE A BODY ON THE REAL CONTRACT. The first version deleted
      whichever clause matched first, which was `SALE CONDITIONS OF THE SUPPLY` —
      and on these decks that heading carries no body of its own, because the
      terms beneath it are parsed into the terms band. A missing heading with no
      body is deliberately reported as drift rather than as a lost clause, so the
      self-test "failed" while the comparator was behaving exactly as designed.
      Deleting a clause that genuinely says something is the only honest probe.
  */
  const victim = subject.ours.sections.find((s) => {
    const rs = subject.real.sections.find((x) => titleKey(x.title) === titleKey(s.title ?? ""));
    return rs && rs.body.join(" ").trim().length > 40;
  });
  if (!victim) return { ran: false };

  const maimed = { ...subject.ours, sections: subject.ours.sections.filter((s) => s.key !== victim.key) };
  const cmp = compareDocuments(subject.real, maimed, "", {
    machineName: subject.machine.name,
    normalise,
    deliberate: DELIBERATE,
  });
  const caught = cmp.findings.some(
    (f) => f.bucket === "a" && titleKey(f.realText ?? "") === titleKey(victim.title ?? ""),
  );
  return { ran: true, caught, machine: subject.machine.name, clause: victim.title };
}

/**
 * K64's three routes. The inheritance one is RE-ASSERTED here rather than taken
 * on trust from the plan — if somebody edits K24's warranty clause tomorrow, the
 * transfer stops being true and this must say so.
 */
function k64Coverage(machines, sections, normalise) {
  const k64 = machines.find((m) => m.name === K64_ROUTES.machine);
  const k24 = machines.find((m) => m.name === K64_ROUTES.inheritsFrom);
  if (!k64 || !k24) return { available: false };
  const of = (m) => sections.filter((s) => s.machineId === m.id && s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const a = of(k24);
  const b = of(k64);
  const shared = [];
  const diverged = [];
  for (const s of b) {
    const mine = a.find((x) => x.key === s.key);
    if (mine && normalise(mine.body) === normalise(s.body)) shared.push(s.key);
    else diverged.push({ key: s.key, title: s.title, inK24: !!mine });
  }
  return { available: true, shared, diverged, total: b.length, deck: K64_ROUTES.deck, pis: K64_ROUTES.pis };
}

/**
 * Every templated machine rendered once, looking for an unresolved `{{token}}`
 * or a ruled blank.
 *
 * ⚠ THIS IS WHAT STOPS "NOT COMPARED" READING AS "NOT LOOKED AT". Seven machines
 *   have a real contract to check against; twenty-one have a template. The other
 *   fourteen still get an answer here, and the report says which check each one
 *   received.
 */
async function sweepEstate(mod, data, profile, warranty, skeleton) {
  const rows = [];
  for (const machine of data.machines.filter((m) => m.active && m.hasTemplate)) {
    const secs = data.machineSections
      .filter((s) => s.machineId === machine.id && s.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const deal = {
      ...skeleton,
      machineId: machine.id,
      machineCategoryId: machine.categoryId,
      ocNo: "OTPL/OC/SWEEP",
      machineCount: 1,
      headCount: 8,
      machineModelNo: machine.machineModelNo,
      dryerType: data.dryerTypes.find((t) => !t.meansNoDryer)?.name ?? "Chinese",
      dealValueCurrency: "INR",
    };
    const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
    const input = {
      deal, machine, sections: secs, facts, profile,
      validityDays: data.config.quotationValidityDays,
      warranty, warrantyNote: data.config.warrantyNote,
    };
    let unresolved = [];
    let blanks = 0;
    let error = null;
    try {
      const doc = mod.resolvedOcDocument(input);
      const text = JSON.stringify(doc);
      unresolved = [...text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]);
      blanks = (text.match(/_{4,}/g) ?? []).length;
    } catch (e) {
      error = e.message;
    }
    rows.push({
      machine: machine.name,
      sections: secs.length,
      unresolved: [...new Set(unresolved)],
      blanks,
      error,
    });
  }
  return rows;
}

/**
 * 🔴 THE RUN FAILS RATHER THAN REPORTING A PARTIAL RESULT. A silent gap — a
 *    specimen that quietly did not parse, a finding with no bucket, an exemption
 *    with no reason — is the failure mode that makes an audit worse than none,
 *    because a short report reads as good news.
 */
function assertNoLooseEnds({ results, failures, sweep, selfTest, attempted, found, deckOnly }) {
  const problems = [];

  if (results.length + failures.length !== attempted) {
    problems.push("specimen count does not reconcile: " + results.length + " + " + failures.length +
      " != " + attempted + " attempted");
  }
  /*
    🔴 EVERY CONTRACT IN 2026.27 IS EITHER COMPARED OR NAMED AS NOT COMPARED.
       This is the assertion that makes "we checked all of them" a fact rather
       than a claim: the number of contracts discovered in the year folder must
       equal the number that came through the comparison, and a deck-only
       contract must be listed by name. A paper that quietly fell out of the run
       is the exact failure this whole audit exists to prevent.
  */
  const y26 = results.filter((r) => r.spec.year === "2026.27").length +
    failures.filter((f) => f.spec.year === "2026.27").length;
  if (y26 !== found) {
    problems.push("2026.27 contracts do not reconcile: " + found + " discovered, " + y26 + " carried through");
  }
  for (const d of deckOnly) {
    if (!d.deck) problems.push("a deck-only contract is listed without naming its file");
  }
  for (const r of results) {
    for (const f of r.cmp.findings) {
      if (![BUCKET.GAP, BUCKET.DELIBERATE, BUCKET.DRIFT].includes(f.bucket)) {
        problems.push(r.spec.id + ": a finding carries no bucket");
      }
    }
    if (r.hasTemplate && !r.ours) problems.push(r.spec.id + ": templated machine produced no resolved document");
  }
  for (const d of DELIBERATE) {
    if (!d.because || !d.because.trim()) problems.push("deliberate " + d.id + " carries no quoted reason");
  }
  if (sweep.length === 0) problems.push("the estate sweep covered no machines");
  if (selfTest.ran && !selfTest.caught) {
    problems.push("the self-test failed: a clause deleted from our side was NOT reported as missing, so this run cannot see a gap and every clean result in it is meaningless");
  }

  if (problems.length) {
    throw new Error("loose ends:\n  - " + problems.join("\n  - "));
  }
}

main().catch((e) => {
  console.error("\nFAILED: " + e.message);
  process.exit(1);
});
