/**
 * compare.mjs — the real contract against ours, band by band, with every
 * difference put in exactly one bucket.
 *
 * 🔴 A RAW DIFF IS NOT A FINDING, IT IS A SECOND PROBLEM. These two documents
 *    disagree on hundreds of spaces, capitals and line breaks; a list of four
 *    hundred undifferentiated differences hides the one clause that matters and
 *    nobody reads the second page. So every difference is classified:
 *
 *      (a) GAP     — the real contract says something ours does not, and it
 *                    matters. THE DEFAULT: anything not positively shown to be
 *                    (b) or (c) is a gap. Silence is never the safe answer here.
 *      (b) DELIBERATE — declared in specimens.mjs with the reason quoted from the
 *                    record. Adding one is a claim, and a claim that never fires
 *                    is reported as stale.
 *      (c) DRIFT   — identical once normalised. A rule, not a list.
 *
 * ⚠ TITLES FOLD HARDER THAN BODIES — see parseRealOc.mjs. `titleKey` matches
 *   `INSTALLATION AND START -UP` to ours; `normalise` (imported from the app's
 *   own templateDiff.ts, never copied) decides whether two clause BODIES say the
 *   same thing, and it is deliberately gentler so that a real wording change
 *   still surfaces as drift rather than vanishing.
 */

import { titleKey } from "./parseRealOc.mjs";

export const BUCKET = { GAP: "a", DELIBERATE: "b", DRIFT: "c" };

/**
 * One line of the real contract, and what became of it.
 * `where` is the band, so the report can rank a missing clause above a label.
 */
function finding(bucket, where, realText, ourText, detail = {}) {
  return { bucket, where, realText, ourText, ...detail };
}

/** Does any declared exemption cover this text on this machine? */
function deliberateFor(deliberate, machineName, text) {
  return deliberate.find(
    (d) =>
      (!d.machines || d.machines.includes(machineName)) &&
      typeof d.matches === "function" &&
      d.matches(text),
  );
}

/**
 * @param real       parsed real OC
 * @param ours       `resolvedOcDocument()` output for the same deal
 * @param ourText    our rendered PDF, read back as lines — the coverage net
 * @param ctx        { machineName, normalise, deliberate }
 */
export function compareDocuments(real, ours, ourText, ctx) {
  const { normalise, deliberate, machineName } = ctx;
  const out = [];
  const fired = new Set();

  const push = (bucket, where, realText, oursText, detail) => {
    if (bucket === BUCKET.GAP) {
      const d = deliberateFor(deliberate, machineName, realText ?? "");
      if (d) {
        fired.add(d.id);
        out.push(finding(BUCKET.DELIBERATE, where, realText, oursText, { ...detail, deliberate: d }));
        return;
      }
    }
    out.push(finding(bucket, where, realText, oursText, detail));
  };

  /* ── sections: the band that carries contractual obligations ───────────── */
  const ourSections = (ours.sections ?? []).map((s) => ({
    key: s.key,
    title: s.title ?? "",
    body: s.body ?? "",
    tk: titleKey(s.title ?? ""),
  }));
  const seenOurs = new Set();

  for (const rs of real.sections) {
    const tk = titleKey(rs.title);
    const mine = ourSections.find((o) => o.tk === tk);
    const realBody = rs.body.join(" ").trim();

    if (!mine) {
      /*
        ⚠ A HEADING WITH NO BODY IS NOT A MISSING CLAUSE. The real papers carry a
          bare `PRINTHEAD WARRANTY` line above `PRINT HEAD POLICY PROGRAM` with
          nothing under it — a sub-heading in the deck's layout, not a term. It is
          reported as drift so it is visible, without claiming a clause is absent.
      */
      if (realBody.length === 0) {
        push(BUCKET.DRIFT, "sections", rs.title, null, {
          why: "a heading with no body under it — layout, not a term",
        });
        continue;
      }
      push(BUCKET.GAP, "sections", rs.title, null, {
        why: "this whole clause is on the real contract and in no template",
        body: realBody,
        bodyLines: rs.body,
        severity: "contract",
      });
      continue;
    }

    seenOurs.add(mine.key);
    if (normalise(realBody) === normalise(mine.body)) continue;
    if (rs.title.trim() !== mine.title.trim() && normalise(realBody) === normalise(mine.body)) continue;

    /*
      The clause exists on both sides but says something different. Report the
      sentences on the real one that are not on ours — a whole-clause dump is
      unreadable and hides which sentence moved.

      🔴 CONTAINMENT, NOT SET MEMBERSHIP. The first run compared normalised
         sentence SETS and reported 36 missing sentences on Homer K24 — the
         known-clean control, hand-verified as matching. Not one was real: a PDF
         wraps a clause at the text-box edge and our template stores it with its
         own line breaks, so the two chunk the same words into different
         "sentences" and every boundary mismatch reads as a missing sentence.
         Asking whether the real sentence appears ANYWHERE in our clause text
         compares content instead of chunking.

      ⚠ SHORT FRAGMENTS ARE SKIPPED. Splitting a numbered list yields "1." and
        "the following:", which match everything and mean nothing.
    */
    const missing = missingRuns(realBody, mine.body, normalise);
    if (missing.length === 0) {
      push(BUCKET.DRIFT, "sections", rs.title, mine.title, {
        why: "same sentences, different punctuation or order",
      });
      continue;
    }
    for (const s of missing) {
      const material = changesAnObligation(s);
      push(material ? BUCKET.GAP : BUCKET.DRIFT, "sections", s, null, {
        why: material
          ? "inside " + mine.title + " — wording on the real contract that carries a figure or a duty, and is not in ours"
          : "inside " + mine.title + " — reworded when the deck was transcribed; same duty, different sentence",
        clause: mine.key,
        severity: "contract",
        wording: !material,
      });
    }
  }

  for (const o of ourSections) {
    if (seenOurs.has(o.key)) continue;
    push(BUCKET.DRIFT, "sections", null, o.title, {
      why: "we print this clause and this contract does not carry it",
      oursOnly: true,
    });
  }

  /* ── specification rows ────────────────────────────────────────────────── */
  const ourSpec = (ours.spec_rows ?? []).map((r) => ({ ...r, k: titleKey(r.label) }));
  for (const rr of real.specRows) {
    const k = titleKey(rr.label);
    const mine = ourSpec.find((o) => o.k === k);
    if (!mine) {
      push(BUCKET.GAP, "spec", rr.label + ": " + rr.value, null, {
        why: "specification row on the real contract, absent from ours",
        severity: "states",
      });
      continue;
    }
    if (normalise(rr.value) === normalise(mine.value)) continue;
    push(BUCKET.GAP, "spec", rr.label + ": " + rr.value, mine.label + ": " + mine.value, {
      why: "same row, different value",
      severity: "states",
    });
  }
  for (const o of ourSpec) {
    if (real.specRows.some((r) => titleKey(r.label) === o.k)) continue;
    push(BUCKET.DRIFT, "spec", null, o.label + ": " + o.value, {
      why: "we print this row and this contract does not carry it",
      oursOnly: true,
    });
  }

  /* ── composition ───────────────────────────────────────────────────────── */
  const ourComp = (ours.composition ?? []).map(normalise);
  const realComp = joinWrapped(real.composition);
  for (const c of realComp) {
    if (ourComp.some((o) => o === normalise(c) || o.includes(normalise(c)) || normalise(c).includes(o))) continue;
    push(BUCKET.GAP, "composition", c, null, {
      why: "composition bullet on the real contract, absent from ours",
      severity: "states",
    });
  }

  /* ── the priced supply line and the money block ────────────────────────── */
  const realSupply = real.supplyDescription.join(" ").trim();
  /*
    ⚠ THE INK NOTE IS PART OF THIS BLOCK ON THE PAGE, even though it does not
      live in `supply_description`. The template holds the product line; the
      renderer draws the included-ink note directly beneath it, above the money —
      which is where the real contracts put it too. Compared against the template
      string alone, the note read as missing on three machines immediately after
      it had been implemented and proved on a rendered page.
  */
  const oursSupply = [
    ours.supply_description ?? "",
    /*
      ⚠ AND SO IS THE MODEL / HSN LINE, for the same reason and with the same
        history. `machine_detail_line` is drawn by the renderer off the machine
        master — it is not in `supply_description` — and the real contracts print
        it inside this block: K32's "MODEL (HM1800B- TK32-B1) (HSN CODE
        84433910)" sits directly under the description. Left out here, the audit
        would report the model and the HSN as missing for ever, even standing on
        a rendered page that carries both.
    */
    ours.machine_detail_line ?? "",
    ours.included_ink_note ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (realSupply && normalise(realSupply) !== normalise(oursSupply)) {
    /*
      ⚠ THE PRICED BLOCK IS NUMBERED ON THE REAL PAPERS AND NOT ON OURS. Three
        P8S contracts write "Note: 1)300 Kgs ink included" where ours prints
        "Note: 300 Kgs ink included" — identical terms, one list marker apart —
        and the diff reported "1)300" as missing text on all three. `wordsOf`
        already strips markers for the clause walk; the supply band split on
        whitespace of its own and did not.
    */
    const stripMarkers = (s) =>
      String(s ?? "").replace(/\b\d{1,2}\.(?=[^\d]|$)/g, " ").replace(/\b\d{1,2}\)(?=\s*\S)/g, " ");
    const oursWords = new Set(normalise(stripMarkers(oursSupply)).split(/\s+/));
    /*
      ⚠ THE MODEL NUMBER AND THE HSN ARE IDENTIFIERS, NOT PROSE. The papers and
        the master punctuate them differently — "MODEL (HM1800B- TK32-B1) (HSN
        CODE 84433910)" against "(Model No: HM1800B-TK32-B1) (HSN Code:
        84433910)" — so a word-by-word diff reports four words missing from a
        line that states exactly the same two facts. Both are therefore matched
        FOLDED, on letters and digits only, exactly as the renderer's own
        duplicate guard does; what survives is left to the prose diff, which is
        good at what it is for. The floor of six characters is deliberate: fold
        "and" and it is a substring of "STANDARD".
    */
    const foldAll = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const oursFolded = foldAll(oursSupply);
    const isLabel = (w) => ours.machine_detail_line && /^(model|no|hsn|code)$/i.test(w.replace(/\W/g, ""));
    const missingWords = normalise(stripMarkers(realSupply))
      .split(/\s+/)
      .filter((w) => w.length > 2 && !oursWords.has(w))
      .filter((w) => !isLabel(w))
      .filter((w) => {
        const f = foldAll(w);
        return !(f.length >= 6 && oursFolded.includes(f));
      });
    push(missingWords.length ? BUCKET.GAP : BUCKET.DRIFT, "supply", realSupply, oursSupply, {
      why: missingWords.length
        ? "the priced line the customer signs under states things ours does not: " + missingWords.join(" ")
        : "same content, different wording",
      severity: "contract",
    });
  }

  /* ── header fields ─────────────────────────────────────────────────────── */
  const ourHeader = new Set((ours.header_fields ?? []).map((h) => String(h).toLowerCase()));
  for (const h of real.headerFields) {
    if (!h.label) continue;
    const k = h.label.toLowerCase().replace(/[^a-z]/g, "");
    const map = { attn: "attn", date: "date", ref: "ref", address: "address" };
    if (map[k] && !ourHeader.has(map[k])) {
      push(BUCKET.GAP, "header", h.label + ": " + h.value, null, {
        why: "header line on the real contract, not declared on our machine",
        severity: "states",
      });
    }
    /*
      ⚠ THE GSTIN IS NOT ONE OF THE FOUR DECLARED HEADER FIELDS, and looking for
        it there would report it missing on every machine for ever. The renderer
        draws it from the deal directly under the address — see `ocPdf.ts` — so
        the frozen `customer_gstin` is what says whether it printed, not
        `header_fields`. Compared on digits and letters because the papers write
        the label three ways ("GST:", "GST :", "GSTIN").
    */
    if (/^gst/i.test(h.label) && h.value && h.value.trim()) {
      const fold = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const printed = fold(ours.customer_gstin ?? "");
      if (!printed || printed !== fold(h.value)) {
        push(BUCKET.GAP, "header", h.label + ": " + h.value, ours.customer_gstin ?? null, {
          why: printed
            ? "the customer's GST number on the real contract is not the one ours prints"
            : "the customer's GST number is printed on the real contract",
          severity: "states",
          tag: "gstin",
        });
      }
    }
  }

  /* ── the terms block ───────────────────────────────────────────────────── */
  // Our template keeps these INSIDE the sale-conditions clause; the decks put
  // them in a block of their own. Compared against the union so the layout
  // difference is not reported as eleven missing terms.
  const ourTermsText = normalise(
    [(ours.sections ?? []).find((s) => s.key === "sale_conditions")?.body ?? "", oursSupply].join(" "),
  );
  /*
    ⚠ THE VALUE DECIDES, NOT THE LABEL. The real contracts head this line
      `Trade Terms:` and ours heads it `Delivery Terms:` — the same agreed term
      under a different caption. Judged on the label the audit reported "this term
      is on the real contract and not in ours" for a term that prints in full,
      three words further along. A term is missing only when its VALUE is absent.
  */
  for (const t of real.terms) {
    const line = t.label + ": " + t.value;
    // ⚠ FILLER WORDS ARE NOT THE TERM. Real: "Insurance will Borne by Customer";
    //   ours: "Product Insurance borne by Customer". Requiring "will" to appear
    //   reported an identical undertaking as a missing term. What matters is
    //   whether the SUBSTANTIVE words survive — and on K32, where the real
    //   contract says "at our care till Port" against our "borne by Customer",
    //   they do not, so that one still fires.
    const FILLER = new Set(["will", "shall", "with", "that", "this", "your", "from", "into", "only", "also", "been", "were", "have"]);
    const valueWords = normalise(t.value)
      .split(/\s+/)
      .filter((w) => w.length > 3 && !/^\d+$/.test(w) && !FILLER.has(w));
    const labelPresent = normalise(t.label).length > 0 && ourTermsText.includes(normalise(t.label));
    const valuePresent = valueWords.length > 0 && valueWords.every((w) => ourTermsText.includes(w));

    if (valuePresent && labelPresent) continue;
    if (valuePresent) {
      push(BUCKET.DRIFT, "terms", line, null, {
        why: "the same term under a different caption — the value prints in full",
      });
      continue;
    }
    push(BUCKET.GAP, "terms", line, null, {
      why: labelPresent
        ? "the term is named on both, but the real contract's wording is not on ours"
        : "this term is on the real contract and not in ours",
      severity: "contract",
    });
  }

  /* ── the coverage net ──────────────────────────────────────────────────── */
  // Anything on the real contract that appears nowhere in our RENDERED text.
  // Catches whatever the band walk mis-filed — a parser bug must not read as a
  // clean result.
  /*
    ⚠ THE NET USES WORD RUNS TOO, over the WHOLE document at once. Line by line it
      reported 42 "missing" lines on the clean control, every one of which was
      present — a PDF wraps where the text box ends and ours wraps where the
      column ends, so almost no whole line is ever a literal match. Its job is to
      catch a band-walk mistake, and it can only do that if its own comparison is
      sound.

    ⚠ IT RUNS AGAINST THE RENDERED PDF, not against the resolved document, so it
      also catches anything that is in the data and does not reach the page.
  */
  const realAll = [
    real.intro ?? "",
    ...real.specRows.map((r) => r.label + " " + r.value),
    ...real.composition,
    ...real.supplyDescription,
    ...real.terms.map((t) => t.label + " " + t.value),
    ...real.sections.flatMap((s) => [s.title, ...s.body]),
  ].join("\n");
  const netRuns = missingRuns(realAll, ourText, normalise);

  /*
    🔴 WHAT THE NET FINDS IS A FINDING, NOT AN APPENDIX. On the first run with a
       sound comparison it surfaced a non-refundable cancellation term, an AMC
       clause, a chargeable-technician clause and the included-ink quantities from
       the priced block — real contractual wording on real contracts, in no
       template. Left in a footnote below the coverage table nobody would have
       acted on any of them.

    ⚠ DEDUPED AGAINST WHAT THE BAND WALK ALREADY SAID, in both directions: the
      walk reports a clause-level run and the net reports the same words as part
      of a longer one, so containment has to be checked each way or every finding
      appears twice under two different numbers.
  */
  const already = out.map((f) => normalise(f.realText ?? "")).filter((t) => t.length > 0);
  const netted = [];
  for (const run of netRuns) {
    const n = normalise(run);
    if (already.some((a) => a.includes(n) || n.includes(a))) continue;
    netted.push(run);
    const material = changesAnObligation(run);
    push(material ? BUCKET.GAP : BUCKET.DRIFT, "net", run, null, {
      why: material
        ? "on the real contract and nowhere in our rendered document — the clause walk did not place it"
        : "wording on the real contract that does not appear in ours; reads as a rewrite rather than a term",
      severity: "contract",
      wording: !material,
    });
  }

  const stale = deliberate.filter((d) => !fired.has(d.id)).map((d) => d.id);
  return { findings: out, netted, firedDeliberate: [...fired], staleDeliberate: stale };
}

/**
 * The words of one clause that do not appear in the other, as contiguous runs.
 *
 * 🔴 THIS REPLACED A SENTENCE-BY-SENTENCE COMPARISON THAT FAILED THE CLEAN
 *    CONTROL. Splitting into sentences reported 32 differences on Homer K24 —
 *    hand-verified as matching — and not one of them was real. Three causes, and
 *    all three are unfixable at the sentence level:
 *
 *      · A PDF wraps a clause at the text-box edge; our template stores it with
 *        different line breaks. The same words chunk into different sentences.
 *      · Numbered lists split badly. "…due to the below mentioned reasons : 1."
 *        leaves the "1." glued to the wrong side, so both chunks fail to match.
 *      · The decks type `1.Modification` and we store `1. Modification`.
 *
 *    Words are compared instead of sentences, punctuation is dropped entirely,
 *    and a run of words only counts as missing if it is long enough to be a
 *    clause rather than a coincidence. What survives is content, not layout.
 *
 * ⚠ THE WINDOW AND THE FLOOR ARE THE WHOLE CALIBRATION. An 8-word window decides
 *   whether a position is "found somewhere in ours"; a run must reach 12 words
 *   before it is reported. Lower and the noise returns; much higher and a short
 *   real clause slips through. Both were set against the two controls: K24 must
 *   come out clean and K32 must still surface its consumables list.
 */
const WINDOW = 8;
const MIN_RUN = 12;

/**
 * ⚠ A BARE LIST ORDINAL IS NOT CONTENT. The decks number the warranty exclusions
 *   `1. … 2. … 3. …`; our templates store the same items unnumbered, because the
 *   renderer draws the list. Left in the word stream those digits break every
 *   window that spans an item boundary, and the clean control reported
 *   "2 dismantling or refitting without our permission 3 destruction by external
 *   forces 4" as missing text when every word of it is present.
 *
 *   Only a STANDALONE small integer is dropped. `12` inside "12 months" is a
 *   contractual term and survives, because it is never on its own.
 */
const wordsOf = (s, normalise) =>
  // The marker is removed from the TEXT, not filtered out of the tokens: a bare
  // `12` must survive, because "12 months" is a contractual term and "12." is a
  // bullet. Only a digit followed by a full stop and a space is a list marker.
  // ⚠ THE DECKS TYPE `3.Liquid contact` WITH NO SPACE. A marker rule that
  //   required whitespace after the full stop missed every such item and the
  //   clean control reported "3 liquid contact on terminals of connectors 4 print
  //   head operation under harsh environment 5" as missing text. Matching "digit,
  //   full stop, anything that is not a digit" catches both spellings and still
  //   leaves decimals alone — `0.6 Mpa` is a digit after the stop.
  // ⚠ AND `1)300 Kgs` WITH A CLOSING BRACKET AND NO SPACE. Three real P8S
  //   contracts number the note that way, so the priced-line diff reported
  //   "1)300" as text our contract was missing when the only difference was the
  //   list marker itself.
  (normalise(
    String(s ?? "")
      .replace(/\b\d{1,2}\.(?=[^\d]|$)/g, " ")
      .replace(/\b\d{1,2}\)(?=\s*\S)/g, " "),
  ).match(/[a-z0-9]+/g) ?? []);

/**
 * Does this difference change an obligation, or is it only different words?
 *
 * 🔴 THE DISTINCTION THE WHOLE REPORT TURNS ON. Our templates were transcribed
 *    from these decks by people who tidied the English as they went — the real
 *    contract says "We recommend the below point to be followed when the machine
 *    is on idle condition", ours says "When the machine is idle:". Same duty,
 *    different sentence. Reporting every rewrite as a gap buries the handful that
 *    matter, and a front page of 200 rewordings gets the whole audit ignored.
 *
 *    An obligation is carried by figures and by a small vocabulary of duty words.
 *    A run holding one of those is a GAP to read; a run holding neither is filed
 *    as worded differently, listed but off the front page.
 */
const OBLIGATION = /\b(warrant\w*|free of cost|free of charge|not covered|not cover|exclud\w*|liable|liability|chargeable|payable|penalty|at the buyer|at customer|borne by)\b/;

/**
 * A duration, a price or a share — the numbers a contract argues about.
 *
 * ⚠ A BARE DIGIT IS NOT ONE. Treating any digit as material put the sentence
 *   "temperature range of 22 degree to 28 degree celsius and relative humidity
 *   between 50 to 60%" on the front page as a contractual gap; ours says "22 to
 *   28 degrees Celsius … between 50 and 60%", which is the same requirement in
 *   tidier English. Warranty months and rupee figures are what change what
 *   somebody owes.
 */
// ⚠ AN INCLUDED QUANTITY IS A COMMERCIAL TERM. The priced block on the Sub Pro
//   and Alpha contracts carries "Note: 300 kgs ink included in above value" —
//   what the customer gets for the money. Without the unit words below it read as
//   a rewrite and stayed off the front page.
const MATERIAL_NUMBER =
  /\b\d+\s*(month|months|year|years|day|days|kg|kgs|ltr|litre|liters?|mtr|meter|metre|nos|pcs|pieces)\b|(?:inr|rs|usd|₹|\$)\s*[\d,]|\b\d+\s*%/;

function changesAnObligation(run) {
  return MATERIAL_NUMBER.test(run) || OBLIGATION.test(run);
}

function missingRuns(realBody, ourBody, normalise) {
  const real = wordsOf(realBody, normalise);
  const ours = " " + wordsOf(ourBody, normalise).join(" ") + " ";
  if (real.length === 0) return [];

  const covered = new Array(real.length).fill(false);
  for (let i = 0; i + WINDOW <= real.length; i++) {
    const probe = " " + real.slice(i, i + WINDOW).join(" ") + " ";
    if (ours.includes(probe)) for (let k = i; k < i + WINDOW; k++) covered[k] = true;
  }
  // A tail shorter than the window can never be probed on its own; judge it by
  // the last full window that could contain it.
  if (real.length < WINDOW) {
    const whole = " " + real.join(" ") + " ";
    if (ours.includes(whole)) covered.fill(true);
  }

  const runs = [];
  let start = -1;
  for (let i = 0; i <= real.length; i++) {
    if (i < real.length && !covered[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN_RUN) runs.push(real.slice(start, i).join(" "));
      start = -1;
    }
  }
  return runs;
}

/**
 * Re-join composition bullets that the deck wrapped across lines.
 *
 * ⚠ A WRAPPED BULLET IS ONE BULLET. The decks wrap at the text-box edge, so
 *   "Driven unwinding unit with expanding shaft to support fabric rolls on
 *   cardboard cores having" and "max. Diameter of 400 mm." arrive as two lines
 *   and neither matches our single stored bullet. Reported line by line that is
 *   two fabricated gaps per wrapped bullet, on every machine.
 */
function joinWrapped(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev && !/[.:;]$/.test(prev)) out[out.length - 1] = prev + " " + line;
    else out.push(line);
  }
  return out;
}
