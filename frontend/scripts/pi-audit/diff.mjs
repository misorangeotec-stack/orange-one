/**
 * diff.mjs — align the commercial block of each pair.
 *
 * The chrome (letterhead, company paragraph, bank lines) is already settled
 * against 56 papers, and their letterhead is text while ours is artwork, so a
 * raw line diff would drown the real findings in noise. This pulls out only the
 * parts that carry a commitment: the subject, the description cell, the money,
 * the Note, and every Terms & Conditions bullet.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Extracted text and rendered PDFs go to TEMP, never into the repo. */
const TMP = join(process.env.TEMP ?? "/tmp", "claude", "pi-audit");
const OURS = join(TMP, "ours");
const THEIRS = join(TMP, "theirs");

const SLUGS = ["10", "11", "12", "15", "16", "17", "18", "19", "20", "21", "22"];
const FOLDER = { 10: 123, 11: 124, 12: 126, 15: 117, 16: 111, 17: 108, 18: 122, 19: 101, 20: 106, 21: 121, 22: 119 };
const MACHINE = {
  10: "Homer K24", 11: "KoloRado Alpha 3", 12: "P8S", 15: "Alpha 15", 16: "Alpha II 1.8",
  17: "Alpha II 1.9", 18: "P8S", 19: "P8S", 20: "Position Printer", 21: "Rocket", 22: "Homer K32",
};

const read = (f) => readFileSync(f, "utf8").split("\n").map((s) => s.replace(/\s+/g, " ").trim());

/** The footer repeats on every page of their papers and is artwork on ours. */
const isChrome = (l) =>
  /^Orange O Tec Pvt Ltd\.*$/i.test(l) ||
  /^Shed No\. A2\/7111/.test(l) ||
  /^Tel : ?7276861612/.test(l) ||
  /^$/.test(l);

function block(lines) {
  const out = { subject: [], desc: [], money: [], note: [], terms: [], sign: [] };
  let i = lines.findIndex((l) => /^SUBJECT\s*:/i.test(l));
  if (i < 0) i = lines.findIndex((l) => /Quantity\s+Description/i.test(l));
  if (i < 0) return out;

  for (; i < lines.length; i++) {
    const l = lines[i];
    if (isChrome(l)) continue;
    if (/^SUBJECT\s*:/i.test(l)) { out.subject.push(l); continue; }
    if (/Quantity\s+Description/i.test(l)) continue;
    if (/^(Machine|Dryer|Head|Total|Sub ?total|\+ ?\d+ ?% ?GST|GST|Consumab|Ink|Freight|Discount)/i.test(l) ||
        /\bINR\b|\bUSD\b|\bUS\$|\$/.test(l)) { out.money.push(l); continue; }
    if (/^Note\s*:/i.test(l) || (out.note.length && /^\d+\)/.test(l))) { out.note.push(l); continue; }
    if (/^Terms & Conditions/i.test(l)) { out.terms.push("--- Terms & Conditions ---"); continue; }
    if (out.terms.length) {
      if (/^(For\b|Authoriz|Authorised)/i.test(l)) { out.sign.push(l); continue; }
      out.terms.push(l); continue;
    }
    if (/^(For\b|Authoriz|Authorised)/i.test(l)) { out.sign.push(l); continue; }
    out.desc.push(l);
  }
  return out;
}

const pad = (s, n) => (s.length >= n ? s.slice(0, n - 1) + "…" : s + " ".repeat(n - s.length));
const W = 74;

for (const s of SLUGS) {
  const theirs = block(read(join(THEIRS, `oc-${s}-26-27.txt`)));
  const ours = block(read(join(OURS, `oc${s}-26-27.txt`)));

  console.log("\n" + "=".repeat(152));
  console.log(`  OTPL/OC/${s}/26-27   ·   folder ${FOLDER[s]}   ·   ${MACHINE[s]}`);
  console.log("=".repeat(152));
  console.log(`  ${pad("THEIRS (Bushra)", W)}| OURS`);
  console.log("  " + "-".repeat(W) + "+" + "-".repeat(W));

  for (const key of ["subject", "desc", "money", "note", "terms", "sign"]) {
    const a = theirs[key], b = ours[key];
    if (!a.length && !b.length) continue;
    console.log(`  ${pad("« " + key + " »", W)}| « ${key} »`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      console.log(`  ${pad(a[i] ?? "", W)}| ${b[i] ?? ""}`);
    }
    console.log("  " + "-".repeat(W) + "+" + "-".repeat(W));
  }
}
