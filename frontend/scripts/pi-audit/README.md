# pi-audit · does our Performa Invoice match the real one?

The invoice half of [`../oc-audit`](../oc-audit). That one drives `buildOcPdf` with facts read off
each real **contract**; this one reads back the **invoices the UI actually produced** and sets them
against the client's own.

🔴 **THE STORED PDF IS THE GROUND TRUTH, not the frozen payload and not the deal row.** The payload
is a diffing aid; what the customer receives is the file. So `pull.mjs` downloads what Generate
wrote and reads it with pdf.js — **never string-search a jsPDF file**, text plainly on the page does
not appear in the raw bytes.

This is also how the vintage question gets answered. "Was this paper made before or after the fix?"
is settled by *reading it*, not by trusting a timestamp: when OCPI-46 ran, the three invoices made
on 3 Sep still read `Date – 03 Sept 2026` and the eight made on 4 Sep read `04/09/2026`, which is
what proved the OCPI-36 fixes had landed.

## Running it

```bash
cd frontend

node scripts/pi-audit/pull.mjs    # download the 11 generated PIs, extract their text
node scripts/pi-audit/refs.mjs    # extract the client's own PI for each
node scripts/pi-audit/diff.mjs    # align the commercial block, theirs | ours
node scripts/pi-audit/prove.mjs   # render one PI from CURRENT code, without saving
```

Everything lands in `%TEMP%/claude/pi-audit/` — `ours/`, `theirs/`, `proof/`. **Nothing is written
into the repo.**

### The papers are a setting, not a path

`Misc/` is gitignored: these are real signed customer contracts and they are deliberately not in the
repo. `refs.mjs` defaults to the folder in a full working copy and takes `OCPI_PAPERS` otherwise —
which is what you need from the `oo-master` worktree, where `Misc/` does not exist at all:

```bash
OCPI_PAPERS="…/Misc/Bushra Reports/OCPI/2026.27 OC&PI" node scripts/pi-audit/refs.mjs
```

⚠ Needs `frontend/.env.local` for the Supabase keys, and
`~/.claude/projects/…/test-credentials.local.json` to sign in — `pull.mjs` reads real deals under
RLS.

## What each one is for

| | |
|---|---|
| `pull.mjs` | Downloads the **latest version** of each deal's `pi_pdf_path` from `fms-ocpi-docs` and writes the PDF plus its extracted lines. Raises nothing, saves nothing, burns no serial. |
| `refs.mjs` | Extracts the client's own invoice for each. **The pairings are hand-made and must stay that way** — see below. |
| `diff.mjs` | Aligns only the parts that carry a commitment: subject, description cell, money, `Note:`, and every Terms & Conditions bullet. |
| `prove.mjs` | Renders one PI from the working tree through the module's own `piPdfBlob` and reads it back. **It renders, it does not save** — no version row, no storage write, no serial. This is how a fix gets proved on a page rather than on the edited source. |

## Two traps this harness exists to avoid

⚠ **THE FILE NAMES LIE.** Folder 106's only PDF carries no `OC`/`PI` marker in its name at all and
*is* the invoice; folder 109's reads like a contract and is also an invoice. Every pairing in
`refs.mjs` was made by **opening the file and reading its heading**. An earlier sweep that globbed
`*PI.pdf` found 23 papers where there are 56 — it missed a third of the evidence. If you add a row,
open the file first.

⚠ **THE LETTERHEAD IS EXCLUDED FROM THE DIFF, DELIBERATELY.** Theirs is text; ours is artwork, so it
does not extract. Comparing it would bury every real finding under a page of noise about an address
block that is identical on paper. `diff.mjs`'s `isChrome` is what drops it.

## Settling a difference

Where the real papers **agree** and we differ, it is a defect — fix it. Where they **disagree among
themselves**, count and follow the majority; do not pick on preference. Both years were swept this
way for OCPI-36 and OCPI-46:

| | |
|---|---|
| `Orange O Tec Pvt Ltd` in prose | 48 of 52 → fixed |
| no full stop after `For …` | 27 of 27 → fixed |
| `+18%` rather than `+ 18%` | 29 vs 8 → fixed |
| `03 Sept 2026` as a date | **0 of 56** → fixed |
| `TO,` vs `To,`, note numbering | genuinely split → left alone |

Written up in `OCPI.md` under **OCPI-36** (the first two deals) and **OCPI-46** (the eleven
re-entered contracts).
