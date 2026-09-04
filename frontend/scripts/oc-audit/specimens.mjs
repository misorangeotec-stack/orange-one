/**
 * specimens.mjs — which real papers are compared, and what is copied off them.
 *
 * ⚠ `2026.27` IS THE ANSWER KEY. It holds the latest contracts, and where both
 *   years cover a machine the newer paper decides — an older-only difference is
 *   historical drift, not a gap in the template. Two specimens deliberately come
 *   from `2025.26` and both say why in `note`.
 *
 * 🔴 TWO OF THESE ARE CONTROLS AND THE AUDIT IS WORTHLESS WITHOUT BOTH.
 *    · Homer K24 (123) was compared by hand and MATCHES. If the run reports a
 *      structural gap on it, the run is broken and nothing else it says can be
 *      believed.
 *    · Homer K32 (78) carries `HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER
 *      UNDER WARRANTY` — eleven parts and two notes that are in no template. If
 *      the run does NOT find it, the run cannot see anything and a clean report
 *      would be a lie.
 *    A run with only the first control cannot tell "the papers match" apart from
 *    "the comparison does nothing".
 */

const Y25 = "2025.26 OC&PI/";
const Y26 = "2026.27 OC&PI/";

export const SPECIMENS = [
  {
    id: "K24",
    machine: "Homer K24",
    year: "2026.27",
    control: "clean",
    file: Y26 + "123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 NAKUL SIR/123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 OC.pdf",
    note: "Known-clean control, hand-verified. Also carries 7 of K64's 9 clauses byte-identically.",
  },
  {
    id: "P8S",
    machine: "P8S",
    year: "2026.27",
    file: Y26 + "126- PRABAL DIGITAL FABRIC STUDIO  P8S  NAKUL SIR/126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf",
    note: "The most recent P8S contract — 31-Aug-2026.",
  },
  {
    id: "ALPHA2-1.9",
    machine: "KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)",
    year: "2026.27",
    file: Y26 + "110 -Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam/Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam OC.pdf",
    note: "The busiest model in the 2026.27 folder.",
  },
  {
    id: "ALPHA2-1.8",
    machine: "KoloRado Alpha II — 1.8 m, 8 heads",
    year: "2026.27",
    file: Y26 + "111 -  VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel/VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel OC.pdf",
    note: "The 1.8 variant is its own master row with its own template.",
  },
  {
    id: "ALPHA15",
    machine: "Kolorado Alpha 15",
    year: "2026.27",
    file: Y26 + "125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 NAKUL SIR/125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 OC.pdf",
    note: "The most recent Alpha 15 contract.",
  },
  {
    id: "K32",
    machine: "Homer K32",
    year: "2025.26",
    control: "positive",
    file: Y25 + "78-JAY CHEMICAL -K32 (32h) -(Ayush  Sir)/78-JAY Chemical - K32 (H32)  - OC.pdf",
    note: "Known-positive control. K32 has no 2026.27 contract, which is why the older year is read for this one.",
  },
  {
    id: "PENGDA800",
    machine: "Pengda PD-1700XD-800",
    year: "2025.26",
    expectNoTemplate: true,
    file: Y25 + "94-OMKARA DIGITAL-PENGDA 800 DIA-UMESH/94-OMKARA DIGITAL-PENGDA 800 DIA-OC.pdf",
    note: "The machine has NO template (has_template = false) — the deck arrived 02-Sep-2026. The comparison is against the deck's target, so 'what is missing' is answered against a real contract rather than only against a deck.",
  },
];

/**
 * K64 — the best seller, and there is no order confirmation for it anywhere.
 *
 * 🔴 SWEPT AND SETTLED, NOT ASSUMED: every PDF and every Word/PowerPoint file in
 *    both years was searched for K64 content. It appears in two folders — 109
 *    Laxmipati and 120 Modi — and both are Performa Invoices with no contract
 *    body. The WORKLIST entry lists K64 among the machines with a real OC; it
 *    does not have one.
 *
 * So K64 is covered three ways, each labelled for exactly what it is worth, and
 * the report says plainly what none of them can answer: whether a real K64
 * contract carries a clause its deck omits — which is how the K32 list was lost.
 */
export const K64_ROUTES = {
  machine: "K64",
  inheritsFrom: "Homer K24",
  deck: "31-08-2026/K64.pptx",
  pis: [
    Y26 + "109- LAXMIPATI SAREE  K64 PURAV  JI/109- LAXMIPATI SAREE  K64 PURAV  JI 25 aug.pdf",
    Y26 + "120 - MODI DYEING & PRINTING PVT LTD  K64 - PURVA SIR/MODI DYEING & PRINTING PVT LTD  K64 PI.pdf",
  ],
};

/**
 * Differences that are DELIBERATE, each with the reason quoted from the record.
 *
 * ⚠ THE SHAPE IS `COMPOSES_INTO` FROM `ocpi-field-map.mjs`: a declared table, and
 *   adding a row is a CLAIM. The audit asserts every entry carries a non-empty
 *   `because`, and reports any entry that never matched anything — a stale
 *   exemption silently suppressing a real finding is the failure this guards.
 *
 * ⚠ `machines` NARROWS THE EXEMPTION. The print-head price sentence only ever
 *   existed on the Homer decks; the Alpha and Sub Pro machines carry a plain
 *   WARRANTY clause with no price in it. An unrestricted exemption would excuse a
 *   missing price on a machine that never had one.
 */
export const DELIBERATE = [
  {
    id: "B-01",
    what: "Shipment / delivery term wording",
    realSays: "Shipment Terms: 30 Days after Order Confirmation  (and 'Delivery terms: NN Days After Order Confirmation')",
    oursSays: "Tentative Machine Delivery Date: <date> / Applicable from the date of signing of this contract.",
    because:
      "OCPI-18, on the client's instruction — a counted-days term was replaced by a dated one. Every real OC still shows the old wording. Do not restore `delivery_days`.",
    matches: (t) => /\b(shipment|delivery)\s*terms?\b/i.test(t) || /days\s+after\s+order\s+confirmation/i.test(t),
  },
  {
    id: "B-02",
    what: "Post-warranty print-head price",
    realSays: "After 18 months New Print Head price will be @ INR 2,35,000 plus GST",
    oursSays: "the same sentence, rewritten to need no figure",
    because:
      "Stage J.1 retired `{{post_warranty_head_price}}` because an unfilled placeholder printed a ruled blank. RE-CONFIRMED 02-09-2026 with the evidence in front of Ritesh Bhai: the figure is typed per deal and disagrees with itself — the same Homer K24 was quoted Rs 2,25,000 (folder 91), Rs 2,35,000 (123) and Rs 2,50,000 (93, 95). He chose to leave it out.",
    machines: ["Homer K24", "Homer K32", "K64"],
    matches: (t) => /new print head price|print head price will be|plus gst/i.test(t),
    /*
      🔴 THE NARROW MACHINE LIST FOUND SOMETHING THE WORK LIST HAD WRONG. That
         entry states "Only the Homer machines carry this clause at all; the Alpha
         and Sub Pro decks have a plain WARRANTY section with no head price. Do
         not go looking for the sentence on machines that never had it."
         P8S is a Sub Pro, and its real contract (126, Prabal, 31-Aug-2026) says:
         "…date of shipment of machine 19th month onwards head price will be INR
         2,25,000.00 + GST + freight with 12 months warranty."
         Because this exemption is scoped to the three Homers, that sentence was
         NOT excused and is reported as a gap. An unrestricted exemption would
         have hidden it — which is the whole reason `machines` exists.
    */
    note: "⚠ The work list says only the Homer machines carry a head price. **P8S carries one too** — its real contract states INR 2,25,000 from the 19th month — and because this exemption is scoped to the Homers, that sentence is reported as a gap rather than excused. Ritesh Bhai's decision covered the Homer sentence; the Sub Pro one has not been put to him.",
  },
];

/**
 * The two decks supplied on 02-09-2026, for machines that carry no template.
 *
 * ⚠ `PENGDA 1000XD 800.pptx` IS NAMED FOR A MODEL IT DOES NOT DESCRIBE. Its own
 *   slide reads `Model: Pengda PD-1700XD-800` — the master row that has three real
 *   contracts against it (folders 87, 89, 94) and no template. The file name would
 *   have sent this to `Pengda PD-1700XD-1000`, which is the one Pengda that IS
 *   templated and has never been sold. Identified from the slide, not the name.
 */
export const NEW_DECKS = [
  {
    machine: "Pengda PD-1700XD-800",
    file: "PENGDA 1000XD 800.pptx",
    note: "Three real contracts exist for this machine — folders 87 (K3 Fabric), 89 (Jayswal) and 94 (Omkara) — and the module can produce none of them.",
  },
  {
    machine: "Mini Lario",
    file: "S  MINI LARIO 1-OC.pptx",
    note: "No real contract on file, so this deck is the only evidence. Its heading is OFFER QUOTE — and `doc_title` is read by neither renderer, because `docHeading(deal)` derives the title from the OC number alone, so that heading can never print (OCPI-12 finding 5 / OCPI-34).",
  },
];
