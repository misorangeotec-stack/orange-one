/**
 * parseRealOc.mjs — a real order confirmation, read into the same shape our own
 * renderer produces.
 *
 * The bands are `resolvedOcDocument`'s bands, deliberately: heading · header
 * fields · spec rows · intro · composition · the priced supply block · the money
 * block · the terms block · sections · sign-off. Comparing anything else would
 * mean inventing a second vocabulary and then translating between them.
 *
 * 🔴 THE HEADING RULE IS THE ONE PLACE THIS CAN BE CONFIDENTLY WRONG, so it is
 *    built the safe way round: known titles are MATCHED, and everything else that
 *    looks like a heading is reported as UNKNOWN rather than absorbed into the
 *    clause above it. An unknown heading is exactly what the audit is hunting —
 *    `HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY` is on four
 *    real contracts and in no template — so the failure mode has to be "reported
 *    as unknown", never "silently swallowed".
 *
 * ⚠ TITLES FOLD HARDER THAN BODIES. `titleKey` strips every non-alphanumeric, so
 *   the real papers' `INSTALLATION AND START -UP`,
 *   `NOT INCLUDED IN OUR DELIVERY SCOPE .` and
 *   `WORKS AT CUSTOMER'S CARE AND EXCLUSIONS:` all land on ours. Titles are short
 *   and distinctive, so that is safe; bodies use the gentler `normalise` from
 *   templateDiff.ts, because inside a clause a punctuation change is a finding to
 *   report as drift, not noise to erase.
 *
 * ⚠ A NUMBERED LINE IS NEVER A HEADING, even in capitals. `1. SPONGE ROLL COVER`
 *   is all uppercase and is the first item of the very list this parser exists to
 *   find; treated as a heading it would eat the clause it belongs to.
 */

/** Aggressive fold, for matching one heading against another. */
export const titleKey = (s) =>
  (s ?? "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const CAPS_MIN = 0.8;

/** Does this line read as a section heading? */
function looksLikeHeading(text) {
  const t = (text ?? "").trim();
  if (t.length === 0 || t.length > 95) return false;
  if (t.includes("\t")) return false; // a table row, not a heading
  if (/^\(?\d+[.)]/.test(t)) return false; // "1. SPONGE ROLL COVER"
  if (/^[•▪–-]/.test(t)) return false; // a bullet
  /*
    ⚠ A COLON IN THE MIDDLE MAKES IT A LABELLED LINE, NOT A HEADING. The Alpha 15
      deck sets its PC specification as ` 16 Gb RAM  HDD: 1 TB  250Gb SSD`, which
      is 87% capitals once the two lowercase b's are set against RAM, HDD, TB and
      SSD — so the capitals rule claimed it, opened a phantom clause, and the
      audit reported a whole PC-spec clause as missing from a template that has
      it. A real heading ends with its colon or carries none.

    ⚠ AND A LINE THAT IS MOSTLY FIGURES IS DATA. Same line, same reason: model
      numbers, capacities and voltages read as capitals to a naive test.
  */
  const colon = t.indexOf(":");
  if (colon >= 0 && colon < t.length - 1) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const digits = t.replace(/[^0-9]/g, "").length;
  if (digits / letters.length > 0.3) return false;
  const upper = t.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= CAPS_MIN;
}

const MONEY_RE =
  /^(machine value|total value|final total|machine total|dryer value|\+\s*\d+(\.\d+)?\s*%|usd\b|inr\b|@)/i;

const TERM_LABELS = [
  "terms",
  "trade terms",
  "delivery terms",
  "shipment terms",
  "payment terms",
  "insurance",
  "bank details",
  "tentative machine delivery date",
];

/**
 * Split a rebuilt line into label and value on the column tab.
 *
 * ⚠ ONLY THE FIRST TAB SPLITS. `Compressed Air consumption:` carries
 *   `0.6 Mpa|0.15m3/hr (Dry, No Oil or Water) 7 Bar`, which itself contains wide
 *   gaps and therefore more tabs; splitting on all of them would shred the value
 *   into three cells and report two of them as missing.
 */
function cells(text) {
  const at = text.indexOf("\t");
  if (at < 0) return [text.trim(), null];
  return [text.slice(0, at).trim(), text.slice(at + 1).replace(/\t/g, " ").trim()];
}

/** Header lines, which are never specification rows however they are laid out. */
const HEADER_LABEL_RE = /^(attn|date|ref|address|gst|gstin|gst no|to)\b/i;

/**
 * A specification row, from either deck style.
 *
 * 🔴 THE TWO DECK GENERATIONS LAY THIS OUT DIFFERENTLY AND BOTH ARE LIVE. Homer
 *    K24's deck uses a real PowerPoint table, so the label and the value are
 *    separate shapes and arrive separated by a column gap — `Model:\tHomer K24`.
 *    Homer K32's deck types the whole row into ONE text box —
 *    `No. of Machine Supply: 1` — with no gap at all. Keyed on the tab alone the
 *    parser read thirteen rows off K24 and **zero** off K32, which would have
 *    reported the entire K32 specification table as missing from our template.
 *
 * ⚠ THE FULL-WIDTH COLON IS NOT A SEPARATOR. The electrical rows read
 *   `Printer：AC220V…` with U+FF1A, and the label class below deliberately
 *   excludes only the ASCII colon, so the split lands after "Electrical Voltage"
 *   and the value keeps its own punctuation.
 */
function specRowFrom(raw) {
  const [label, value] = cells(raw);
  if (value !== null && /:$/.test(label)) {
    return { label: label.replace(/:\s*$/, "").trim(), value };
  }
  if (value !== null) return null;
  const m = /^([^:\t]{2,45}?)\s*:\s*(\S.*)$/.exec(raw.trim());
  if (!m) return null;
  if (HEADER_LABEL_RE.test(m[1].trim())) return null;
  return { label: m[1].trim(), value: m[2].trim() };
}

/**
 * @param doc         the result of readPdfLines
 * @param knownTitles Set of titleKey()s the module's templates use — the
 *                    vocabulary. Anything outside it is reported, not guessed at.
 */
export function parseRealOc(doc, knownTitles = new Set()) {
  const lines = [];
  for (const page of doc.pages) {
    for (const l of page.lines) {
      // ⚠ THE DECKS OVERLAP TEXT BOXES AND THE SAME LINE COMES BACK TWICE — the
      //   K24 electrical rows do exactly this. An exact repeat of the line just
      //   seen is an artefact of the deck, not a repeated clause.
      if (lines.length && lines[lines.length - 1].text === l.text) continue;
      lines.push({ text: l.text, page: page.number });
    }
  }

  const out = {
    heading: null,
    ocNo: null,
    headerFields: [],
    intro: null,
    specRows: [],
    composition: [],
    supplyDescription: [],
    money: [],
    terms: [],
    sections: [],
    signoff: [],
    unparsed: [],
  };

  // ── heading + OC number ──────────────────────────────────────────────────
  // ⚠ THE TITLE LINE IS CONSUMED, NOT LEFT IN THE STREAM. It is in capitals, so
  //   the section walk below would otherwise open the document with a section
  //   called "ORDER CONFIRMATION OTPL/OC/78.25-26" and every header line after it
  //   would land in that section's body — which is exactly what the first run did.
  let titleAt = -1;
  for (const [idx, l] of lines.slice(0, 12).entries()) {
    const m = /(ORDER\s*CONFIRMATION|OFFER\s*QUOTE)/i.exec(l.text);
    if (!m) continue;
    out.heading = m[1].replace(/\s+/g, " ").toUpperCase();
    const n = /OTPL\s*\/\s*OC\s*\/[\w./ -]*/i.exec(l.text);
    if (n) out.ocNo = n[0].replace(/\s+/g, "");
    titleAt = idx;
    break;
  }
  if (!out.ocNo) {
    const n = lines
      .slice(0, 25)
      .map((l) => /OTPL\s*\/\s*OC\s*\/[\w./ -]*/i.exec(l.text))
      .find(Boolean);
    if (n) out.ocNo = n[0].replace(/\s+/g, "");
  }

  // ── walk ─────────────────────────────────────────────────────────────────
  // `zone` only ever moves forwards, which is what stops a stray capitalised
  // line on page 2 from re-opening the header.
  let zone = "head";
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    if (i === titleAt) continue;
    const raw = lines[i].text;
    const text = raw.trim();
    const [label, value] = cells(raw);
    const lower = label.replace(/:\s*$/, "").trim().toLowerCase();

    // ⚠ THE TERMS BLOCK IS TESTED BEFORE THE HEADING RULE, on the whole line
    //   rather than on a tab cell. `Terms: CIF NHAVASHEVA.(HIGH SEAS SALES UNDER
    //   EPCG)` is 87% capitals, so the heading rule claims it first and the
    //   delivery, payment, insurance and bank lines all vanish into a section
    //   body — which is what made the first run report zero terms on every paper.
    if (zone === "supply" || zone === "terms" || zone === "sections") {
      const flat = text.replace(/\t/g, " ");
      const tm = /^([^:]{2,40}):\s*(.*)$/.exec(flat);
      if (tm && TERM_LABELS.includes(tm[1].trim().toLowerCase())) {
        out.terms.push({ label: tm[1].trim(), value: tm[2].trim() });
        zone = "terms";
        continue;
      }
    }

    if (/^following up your kind/i.test(text)) {
      const buf = [text];
      while (
        i + 1 < lines.length &&
        !lines[i + 1].text.includes("\t") &&
        !looksLikeHeading(lines[i + 1].text) &&
        !/^(attn|date|ref|address|to)\b/i.test(lines[i + 1].text.trim())
      ) {
        buf.push(lines[++i].text.trim());
      }
      out.intro = buf.join(" ");
      continue;
    }

    if (/^THE MACHINE IS COMPOSED/i.test(text)) {
      zone = "composition";
      continue;
    }

    if (zone === "head" || zone === "spec") {
      if (/^(attn|date|ref|address|gst|gstin|gst no|to)\b/i.test(lower)) {
        // A header line may carry two fields — "Attn: \tDate: 21.08.2026".
        for (const part of raw.split("\t")) {
          const p = part.trim();
          if (!p) continue;
          const m = /^([A-Za-z. ]{2,20})\s*[:.]\s*(.*)$/.exec(p);
          if (m) out.headerFields.push({ label: m[1].trim(), value: m[2].trim() });
          else out.headerFields.push({ label: "", value: p });
        }
        zone = "head";
        continue;
      }
      /*
        🔴 A WRAPPED VALUE CAN BEGIN ON THE LINE **ABOVE** ITS OWN LABEL. On the
           Homer decks the electrical cell is a tall text box whose first baseline
           sits higher than the label beside it, so the geometric read yields

             Max. Fabric width:  1920 mm
             AC220V~240V +- 10% single phase|Printer 34A (7.4 kW) + Belt   <-- electrical
             Electrical Voltage: Drying 25A (5.2 Kw)|50Hz/60Hz

           Appended to the row above — the obvious reading — that fragment turned
           `Max. Fabric width` into a mismatch on both Homer specimens, and the
           electrical row lost its first line. A stray line immediately followed
           by a labelled row belongs to THAT row, in front of its value.
      */
      if (!specRowFrom(raw) && zone === "spec" && i + 1 < lines.length) {
        const next = specRowFrom(lines[i + 1].text);
        if (next && !looksLikeHeading(text) && !HEADER_LABEL_RE.test(text)) {
          const row = { label: next.label, value: text + "\n" + next.value };
          i++;
          while (i + 1 < lines.length) {
            const nxt = lines[i + 1].text;
            if (specRowFrom(nxt) || looksLikeHeading(nxt) || HEADER_LABEL_RE.test(nxt.trim()) ||
                /^THE MACHINE IS COMPOSED/i.test(nxt)) break;
            const cont = lines[++i].text.trim();
            const flat = (t) => t.replace(/\s+/g, " ").trim();
            if (!flat(row.value).includes(flat(cont))) row.value += "\n" + cont;
          }
          out.specRows.push(row);
          continue;
        }
      }

      const spec = specRowFrom(raw);
      if (spec) {
        zone = "spec";
        // A wrapped spec value continues on lines that are not themselves a row —
        // the electrical rows run three lines deep on the Homer decks.
        while (i + 1 < lines.length) {
          const nxt = lines[i + 1].text;
          if (
            specRowFrom(nxt) ||
            looksLikeHeading(nxt) ||
            HEADER_LABEL_RE.test(nxt.trim()) ||
            /^THE MACHINE IS COMPOSED/i.test(nxt)
          ) break;
          // ⚠ LOOK TWO AHEAD. A stray line whose OWN label is on the next line is
          //   the tall-text-box case above; absorbed here it would be attached to
          //   the row before it instead, which is how `Max. Fabric width` ended up
          //   carrying the electrical value on both Homer specimens.
          if (i + 2 < lines.length && specRowFrom(lines[i + 2].text)) break;
          // ⚠ THE DECK DRAWS THE ELECTRICAL BLOCK TWICE, in two overlapping text
          //   boxes at slightly different positions, so the same two lines come
          //   back again after the dryer line. They are not adjacent, so the
          //   whole-document dedupe above cannot see them. A continuation line
          //   already inside this value is the same artefact.
          const cont = lines[i + 1].text.trim();
          i++;
          // Whitespace-insensitive: the two copies of the overlapping box do not
          // agree on their internal column gaps, so one carries a tab the other
          // does not and a literal comparison never matches.
          const flat = (t) => t.replace(/\s+/g, " ").trim();
          if (!flat(spec.value).includes(flat(cont))) spec.value += "\n" + cont;
        }
        out.specRows.push(spec);
        continue;
      }
      /*
        ⚠ THE HEADER ZONE DOES NOT FALL THROUGH TO THE SECTION RULE. A customer's
          address is typed in capitals on most of these decks — `M I D C,
          DOMBIVALI EAST, DIST - THANE-421203` — so letting it reach the heading
          rule opens a bogus section and swallows the whole specification table
          into its body. The header ends only at something that genuinely starts
          the document proper: the composition, the money, or a KNOWN clause title.
      */
      const startsBody =
        MONEY_RE.test(text) || knownTitles.has(titleKey(text)) || /^THE MACHINE IS COMPOSED/i.test(text);
      if (!startsBody) {
        out.headerFields.push({ label: "", value: text.replace(/\t/g, " ") });
        continue;
      }
      zone = MONEY_RE.test(text) ? "supply" : "sections";
      i--;
      continue;
    }

    if (zone === "composition") {
      if (looksLikeHeading(text)) {
        zone = "supply";
        out.supplyDescription.push(text);
        continue;
      }
      if (MONEY_RE.test(text)) {
        zone = "supply";
        i--;
        continue;
      }
      out.composition.push(text);
      continue;
    }

    if (zone === "supply") {
      if (MONEY_RE.test(text)) {
        const flat = text.replace(/\t/g, " ");
        const m = /^(.*?)((?:USD|INR|\$|₹)?\s*[\d,]+\.?\d*)\s*$/.exec(flat);
        if (m && m[1].trim()) out.money.push({ label: m[1].trim(), value: m[2].trim() });
        else out.money.push({ label: flat, value: "" });
        continue;
      }
      if (TERM_LABELS.includes(lower)) {
        zone = "terms";
        i--;
        continue;
      }
      if (looksLikeHeading(text) && out.money.length > 0) {
        zone = "sections";
        i--;
        continue;
      }
      out.supplyDescription.push(text);
      continue;
    }

    if (zone === "terms") {
      const flat = text.replace(/\t/g, " ");
      const m = /^([^:]{2,40}):\s*(.*)$/.exec(flat);
      if (m && TERM_LABELS.includes(m[1].trim().toLowerCase())) {
        out.terms.push({ label: m[1].trim(), value: m[2].trim() });
        continue;
      }
      /*
        ⚠ THE BANK BLOCK IS PART OF THE TERM ABOVE IT, NOT A NEW CLAUSE. Under
          `Bank Details:` come `Bank: AXIS BANK`, `Branch: SACHIN`, `A/C no. …`
          and `IFSC: UTIB0003360` — and `IFSC: UTIB0003360` is entirely capitals,
          so the heading rule claimed it and every paper reported a phantom
          section called "IFSC: UTIB0003360". A short `Label: value` line inside
          the terms block continues the term.
      */
      if (out.terms.length && /^[A-Za-z][A-Za-z./ ]{1,20}[:.]\s*\S/.test(flat)) {
        out.terms[out.terms.length - 1].value += "\n" + text;
        continue;
      }
      if (looksLikeHeading(text)) {
        zone = "sections";
        i--;
        continue;
      }
      if (out.terms.length) out.terms[out.terms.length - 1].value += "\n" + text;
      else out.unparsed.push({ page: lines[i].page, text });
      continue;
    }

    // ── sign-off ───────────────────────────────────────────────────────────
    if (
      /^(m\/s\.?\s+orange|orange o tec pvt)/i.test(text) ||
      /^-{5,}/.test(text) ||
      /^(prepared by|approved by|checked by|authoriz|authoris)/i.test(text)
    ) {
      zone = "signoff";
      out.signoff.push(text);
      continue;
    }
    if (zone === "signoff") {
      /*
        🔴 THE SIGN-OFF IS NOT ALWAYS THE END OF THE CONTRACT, and assuming it was
           swallowed a whole paper. Real OC 124 (Clothera, 2026.27) prints the
           "M/s ORANGE O TEC PVT LTD." bank block at the foot of page 1 and then
           carries on for four more pages of clauses. Because the sign-off zone
           was terminal, that contract parsed to **one** section instead of nine,
           every real clause was reported as "on the real contract and in no
           template", and the header date surfaced as a missing clause. One paper
           laid out differently produced a page of invented findings.

        ⚠ ONLY A KNOWN CLAUSE TITLE BREAKS OUT. Any heading-shaped line would let
          a bank label or an address line reopen the body; a title the estate
          actually uses is evidence the contract has resumed.
      */
      if (looksLikeHeading(text) && knownTitles.has(titleKey(text))) {
        zone = "sections";
        i--;
        continue;
      }
      out.signoff.push(text);
      continue;
    }

    // ── sections ───────────────────────────────────────────────────────────
    if (looksLikeHeading(text)) {
      // Longest known run first: a two-line wrapped heading must beat its own
      // first line, or the second half lands in the body.
      let matched = null;
      for (let len = 3; len >= 1; len--) {
        if (i + len > lines.length) continue;
        const parts = lines.slice(i, i + len).map((l) => l.text.trim());
        if (len > 1 && !parts.every((p) => looksLikeHeading(p))) continue;
        const joined = parts.join(" ");
        if (knownTitles.has(titleKey(joined))) {
          matched = { joined, len };
          break;
        }
      }
      if (matched) {
        section = { title: matched.joined, known: true, body: [] };
        out.sections.push(section);
        i += matched.len - 1;
        zone = "sections";
        continue;
      }
      /*
        ⚠ A CAPITALISED LINE THAT FINISHES THE SENTENCE ABOVE IT IS NOT A HEADING.
          The K32 consumables clause ends with a note that wraps —
          "…DUE TO THE WATER ENTERING THE AIR" / "PIPE WILL NOT BE COVERED UNDER
          WARRANTY PERIOD." — and the second line is 100% capitals. Read as a
          heading it splits the very clause this audit exists to find into two,
          and the second half loses its body.

          🔴 BOTH TELLS ARE REQUIRED, NOT EITHER. With `||` this rule ate the
             known-positive control: CANCELLATION's last line ends without a full
             stop, so "the line above did not finish" was true and
             `HOMER K32 CONSUMABLES PARTS LIST…` was appended to CANCELLATION's
             body instead of being reported as an unknown clause. A continuation
             both finishes a sentence AND follows an unfinished one; a heading
             does neither.
      */
      if (section) {
        const prev = section.body[section.body.length - 1] ?? "";
        const continues = /[.;,]$/.test(text) && prev !== "" && !/[.:;]$/.test(prev);
        if (continues) {
          section.body.push(text);
          continue;
        }
      }
      // Unknown. Join only with following capitalised lines that are themselves
      // unknown, so a wrapped new heading survives without swallowing a known one.
      const parts = [text];
      while (
        i + 1 < lines.length &&
        parts.length < 3 &&
        looksLikeHeading(lines[i + 1].text) &&
        !knownTitles.has(titleKey(lines[i + 1].text.trim()))
      ) {
        parts.push(lines[++i].text.trim());
      }
      section = { title: parts.join(" "), known: false, body: [] };
      out.sections.push(section);
      zone = "sections";
      continue;
    }

    if (section) section.body.push(text);
    else out.unparsed.push({ page: lines[i].page, text });
  }

  return out;
}

/** The parse as a human-readable page, so a person can check what it read. */
export function parseToText(p, meta = {}) {
  const L = [];
  L.push("# " + (meta.title ?? "parsed order confirmation"));
  for (const [k, v] of Object.entries(meta)) if (k !== "title") L.push(k + ": " + v);
  L.push("", "HEADING: " + p.heading, "OC NO:   " + (p.ocNo ?? "(none on the paper)"), "");
  L.push("## HEADER FIELDS");
  for (const h of p.headerFields) L.push("  " + (h.label || "(unlabelled)") + " = " + h.value);
  L.push("", "## INTRO", "  " + (p.intro ?? "(none)"), "");
  L.push("## SPEC ROWS (" + p.specRows.length + ")");
  for (const r of p.specRows) L.push("  " + r.label + " = " + r.value.replace(/\n/g, " / "));
  L.push("", "## COMPOSITION (" + p.composition.length + " lines)");
  for (const c of p.composition) L.push("  - " + c);
  L.push("", "## PRICED SUPPLY BLOCK");
  for (const s of p.supplyDescription) L.push("  " + s);
  L.push("", "## MONEY");
  for (const m of p.money) L.push("  " + m.label + "  |  " + m.value);
  L.push("", "## TERMS");
  for (const t of p.terms) L.push("  " + t.label + ": " + t.value.replace(/\n/g, " / "));
  L.push("", "## SECTIONS (" + p.sections.length + ")");
  for (const s of p.sections) {
    L.push("  " + (s.known ? "[known]  " : "[UNKNOWN]") + " " + s.title + "   (" + s.body.length + " body lines)");
    for (const b of s.body) L.push("        " + b);
  }
  L.push("", "## SIGN-OFF");
  for (const s of p.signoff) L.push("  " + s);
  if (p.unparsed.length) {
    L.push("", "## /!\\ UNPLACED (" + p.unparsed.length + ") - read these; the parser could not band them");
    for (const u of p.unparsed) L.push("  p" + u.page + "  " + u.text);
  }
  return L.join("\n");
}
