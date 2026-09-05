/**
 * refs.mjs — extract Bushra's own PI for each of the eleven re-entered contracts.
 *
 * ⚠ THE FILENAMES LIE, so every pairing below was made by opening the folder and
 *   reading the heading, not by globbing for "PI". Folder 106 is the proof: its
 *   only PDF carries no OC/PI marker in its name at all and IS the invoice.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Extracted text and rendered PDFs go to TEMP, never into the repo. */
const TMP = join(process.env.TEMP ?? "/tmp", "claude", "pi-audit");
const AUDIT = resolve(HERE, "..", "oc-audit");
const OUT = join(TMP, "theirs");

/**
 * Where the client's own papers live.
 *
 * 🔴 THEY ARE NOT IN THE REPO AND MUST NOT BE. `Misc/` is gitignored — these are
 *    real signed customer contracts. So this is a SETTING, not a constant: it
 *    defaults to the folder in a full working copy and can be pointed anywhere
 *    with `OCPI_PAPERS`.
 *
 * ⚠ AND IT CANNOT BE ASSUMED TO SIT BESIDE THE SCRIPT. Run from the `oo-master`
 *   worktree the default resolves to a directory that does not exist, and the
 *   first version of this reported eleven cheerful `MISSING` lines as though the
 *   files had been deleted. It now says what is actually wrong.
 */
const FOLDER = process.env.OCPI_PAPERS
  ? resolve(process.env.OCPI_PAPERS)
  : resolve(HERE, "..", "..", "..", "Misc/Bushra Reports/OCPI/2026.27 OC&PI");

if (!existsSync(FOLDER)) {
  console.error(
    `\nThe reference papers are not here:\n  ${FOLDER}\n\n` +
      `They are deliberately not in the repo (Misc/ is gitignored). Point this at\n` +
      `the folder that holds them:\n\n` +
      `  OCPI_PAPERS="…/Misc/Bushra Reports/OCPI/2026.27 OC&PI" node scripts/pi-audit/refs.mjs\n`,
  );
  process.exit(1);
}

const { readPdfLines, allLines } = await import(pathToFileURL(join(AUDIT, "pdfText.mjs")).href);

export const PAIRS = [
  { oc: "OTPL/OC/10/26-27", slug: "10", folder: "123", machine: "Homer K24",
    file: "123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 NAKUL SIR/123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 PI.pdf" },
  { oc: "OTPL/OC/11/26-27", slug: "11", folder: "124", machine: "KoloRado Alpha 3",
    file: "124 - CLOTHERA PRIVATE LIMITED 1.9 16 PH  NAKUL SIR/124 - CLOTHERA PRIVATE LIMITED 1.9 16 PH   PI.pdf" },
  { oc: "OTPL/OC/12/26-27", slug: "12", folder: "126", machine: "P8S",
    file: "126- PRABAL DIGITAL FABRIC STUDIO  P8S  NAKUL SIR/126- PRABAL DIGITAL FABRIC STUDIO  P8S pi.pdf" },
  { oc: "OTPL/OC/15/26-27", slug: "15", folder: "117", machine: "Kolorado Alpha 15",
    file: "117- AKLAVYA INDUSTRIES PVT.LTD ALPHA 15 NAKUL SIR/117- AKLAVYA INDUSTRIES PVT.PI.pdf" },
  { oc: "OTPL/OC/16/26-27", slug: "16", folder: "111", machine: "Alpha II 1.8 m",
    file: "111 -  VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel/VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel  pi.pdf" },
  { oc: "OTPL/OC/17/26-27", slug: "17", folder: "108", machine: "Alpha II 1.9 m",
    file: "108-MK FASHION ALPHA 2 1.9 - Khurshid Alam/MK FASHION ALPHA 2 1.9 - Khurshid Alam PI - 22.08.2026.pdf" },
  { oc: "OTPL/OC/18/26-27", slug: "18", folder: "122", machine: "P8S",
    file: "122 - VIJAY LAXMI P8S NAKUL SIR/VIJAYLAXMI DIGITAL PRINTS PI NAKUL SIR.pdf" },
  { oc: "OTPL/OC/19/26-27", slug: "19", folder: "101", machine: "P8S",
    file: "101 - YASHASVI DIGITAL FABRIC STUDIO P8S NAKUL SIR/101 - YASHASVI DIGITAL FABRIC STUDIO P8S PI.pdf" },
  { oc: "OTPL/OC/20/26-27", slug: "20", folder: "106", machine: "Position Printer",
    file: "106- NOOR DYEING  - PURAV  BHAI  POSITIONAL  PRINTER/106- NOOR DYEING  - PURAV  BHAI  POSITIONAL  PRINTER.pdf" },
  { oc: "OTPL/OC/21/26-27", slug: "21", folder: "121", machine: "Rocket",
    file: "121 - MODI DYEING & PRINTING PVT LTD  ROCKET  - PURVA SIR/MODI DYEING & PRINTING PVT LTD  ROCKET PI.pdf" },
  { oc: "OTPL/OC/22/26-27", slug: "22", folder: "119", machine: "Homer K32",
    file: "119 - MODI DYEING & PRINTING PVT LTD  K32 - PURVA SIR/MODI DYEING & PRINTING PVT LTD  K32  PI.pdf" },
];

{
  mkdirSync(OUT, { recursive: true });
  for (const p of PAIRS) {
    const full = join(FOLDER, p.file);
    if (!existsSync(full)) { console.log(`MISSING  ${p.folder}  ${p.file}`); continue; }
    const pages = await readPdfLines(full);
    const lines = allLines(pages).map((l) => l.text);
    writeFileSync(join(OUT, `oc-${p.slug}-26-27.txt`), lines.join("\n"), "utf8");
    console.log(`${p.oc}  folder ${p.folder}  ${lines.length} lines  ${p.machine}`);
  }
}
