/*
  OCPI-43 · The composed delivery term reads "Ex-Work <city>", not "Ex Factory <city>".

  🔴 A REVERSAL, NOT A CORRECTION. Settled with Ritesh Bhai on 02-09-2026 as
     "Ex Factory Surat", title case; reversed by him on 04-09-2026 once the OC
     audit put ours beside the real contracts -- folders 101, 122 and 127 all
     write "Ex-Work Surat", and so do the 17 deals already on file.

  ⚠ COMMENT ONLY. The term is composed in TypeScript (lib/fieldSpec.ts
    composeTradeTerm); the RPCs write p->>'trade_term' straight through and
    draftFromDeal never recomposes, so no stored value changes here and none
    should. A deal nobody edits keeps the exact string it was issued under.

  ⚠ delivery_factory_city's own comment stated the old format and would now be
    wrong. Nothing else in the schema names it.
*/
comment on column public.fms_ocpi_deals.delivery_factory_city is
  'OCPI-35 · Surat or Noida, asked only when delivery_via = EX Factory. Composes into trade_term as "Ex-Work <city>" (OCPI-43, 04-09-2026 — was "Ex Factory <city>"; reversed by Ritesh Bhai to match folders 101/122/127 and the 17 legacy deals). The pair is hardcoded in lib/fieldSpec.ts and is the SAME pair as the company branches in OCPI-25; that entry is where the two lists reconcile once it is unblocked.';

comment on column public.fms_ocpi_deals.trade_term is
  'OCPI-35/42/43 · The delivery term AS IT PRINTS — {{trade_term}} in the SALE CONDITIONS clause of all 21 templated machines, the PI''s "Trade Terms :" line and the summary sheet''s "Term of Delivery" row. COMPOSED in lib/fieldSpec.ts composeTradeTerm from delivery_via + its detail columns, never typed: "CIF <port>" / "Ex-Work <city>" / "FOB". On a High Seas deal borne by the CUSTOMER the customer''s own leg is appended; on a LOCAL deal the transport bearer is appended as "(Transportation bear by <Customer | selling entity>)" — the wording counted off the real contracts, OCPI-43. ⚠ Composed ON CHANGE ONLY: a deal nobody edits saves its stored value byte-identically, which is what protects the 17 rows holding a free-text "Ex-Work Surat" and the one holding "CIF Jebel Ali".';
