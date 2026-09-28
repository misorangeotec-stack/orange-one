/*
  OCPI-31 + OCPI-33 · THE DEAL DECIDES WHAT THE TEMPLATE SELLS
  ───────────────────────────────────────────────────────────────────────────
  Found 02-Sep-2026 by OCPI-12's print audit, by reading rendered pages.

  🔴 A CONTRACT FOR A MACHINE WITH NO DRYER WENT ON SELLING A DRYER. OCPI-8
     gated the DEAL-DERIVED dryer block correctly — on a dryer category meaning
     "none", the four dryer rows are absent from both papers. What was never
     gated is the MACHINE TEMPLATE'S OWN WORDING, which is where the dryer is
     actually described. On a no-dryer K64 the order confirmation still printed
     two dryer spec rows and, in the line above the signature block under
     TOTAL NET AMOUNT OF THE SUPPLY:

         …WITH 64 PRINTHEADS AND CENTERING SYSTEM & DRYER (Model No: …)

     The customer signed for a supply naming a dryer the deal did not include.

  🔴 AND THE FOREX CLAUSE PRINTED ON RUPEE CONTRACTS. quotationPdf.ts prints the
     dollar clause on a USD deal alone and says why — "a rupee customer used to
     be shown, and asked to agree to, a term that could not apply to them" — and
     the order confirmation carried it on every deal, because it is literal text
     inside the machine's own SALE CONDITIONS. The two papers of one rupee deal
     disagreed on exactly the point the summary sheet had been corrected for.

  Both are ONE bug: a condition the code already knows about, written as
  unconditional text. They get one mechanism — an inline [[if …]] in the
  template, resolved by lib/conditions.ts in the same pass as {{tokens}}.

  ⚠ THE PARSER SHIPS FIRST, AND THIS FILE IS USELESS — WORSE THAN USELESS —
    WITHOUT IT. [[ and ]] are not in pdfBrand's glyph fallback and Poppins
    carries both, so against an older frontend these markers print CRISPLY on a
    customer's contract. Same ordering OCPI-18 had to respect for
    {{delivery_date}}: "THIS TOKEN HAD TO EXIST BEFORE THE MIGRATION RAN."

  ⚠ NOTHING IS DROPPED, ADDED OR RETYPED. Every statement is an UPDATE guarded
    on the exact current value, so it applies once, to the row it was written
    for, or not at all. Re-running is a no-op; the assertions read the final
    state rather than a row count, so they hold either way.

  ⚠ THE WORDING IS EACH MACHINE'S OWN. Four machines carry the forex clause and
    they word it three different ways — "Forex Impact Clause:", "Forex Clause
    Impact:", and one unlabelled trailing sentence. A single token would have
    flattened four wordings into one, which is a content change to a signed
    document beyond the fix; the wrapper leaves every word where it was.

  ⚠ HAND-AUTHORED, LINE BY LINE, BECAUSE A SWEEP WOULD BE WRONG. Rocket's SCOPE
    OF SUPPLY also says "Dryer conveyor length: 30–32 meters" and "dryer exit
    adopt frequency inverter driving" ABOUT THE PRINTER ITSELF, and its
    Install Power row folds the dryer into a total — "145 Kw ( Dryer & rotary110
    Kw)" — which no conditional can divide. Those are left alone.

  ⚠ SUBLIMATION IS NOT TOUCHED. P8D and P8S name a dryer in their spec rows and
    composition, but their category carries no dryer at all, so the condition
    would be constant-false on every deal they can ever have — a deletion
    wearing a condition's clothes. Whether that dryer is part of the machine is
    a question for the client, raised separately.

  ⚠ TWO MACHINES HAD THE MIRROR DEFECT and are fixed with [[if !dryer]]: JPK's
    "(Without Dryer)" and MP5000's "without dryer" were UNCONDITIONAL, so a
    Direct deal that did include a dryer denied one. JPK's only deal has an
    Indian dryer.

  Verified before this file was written, against these exact strings: the real
  buildOcPdf rendered nine order confirmations from the live rows, read back
  with pdf.js. With every wrapper open, all 631 template strings are
  byte-identical to today.
*/

-- MP5000
update public.fms_ocpi_machines set
      supply_description = $mig$INK-JET PRINTING MACHINE MODEL MS-JP7 -{{head_count}} PRINTING HEADS[[if !dryer]] without dryer[[/if]]– Printing width 180cm, complete with the following accessories.$mig$
  where name = $mig$MP5000$mig$
    and supply_description = $mig$INK-JET PRINTING MACHINE MODEL MS-JP7 -{{head_count}} PRINTING HEADS without dryer– Printing width 180cm, complete with the following accessories.$mig$;

-- Fab Pro 2I
update public.fms_ocpi_machines set
      supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS[[if dryer]] & WITH DRYER[[/if]] (LARGE FORMAT INKJET PRINTER)$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 2i"},{"label":"Number of installable rows","value":"Two"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"16 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\n[[if dryer]]Dryer：AC 380V+-10% Three Phase 25A(10 Kw)[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb
  where name = $mig$Fab Pro 2I$mig$
    and supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 2i"},{"label":"Number of installable rows","value":"Two"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"16 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\nDryer：AC 380V+-10% Three Phase 25A(10 Kw)"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb;

-- Fab Pro 1I
update public.fms_ocpi_machines set
      supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS[[if dryer]] & WITH DRYER[[/if]] (LARGE FORMAT INKJET PRINTER)$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 1i"},{"label":"Number of installable rows","value":"one"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"8 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\n[[if dryer]]Dryer：AC 380V+-10% Three Phase 25A(10 Kw)[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb
  where name = $mig$Fab Pro 1I$mig$
    and supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 1i"},{"label":"Number of installable rows","value":"one"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"8 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\nDryer：AC 380V+-10% Three Phase 25A(10 Kw)"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb;

-- Fab Pro 3I
update public.fms_ocpi_machines set
      supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS[[if dryer]] & WITH DRYER[[/if]] (LARGE FORMAT INKJET PRINTER)$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 3i"},{"label":"Number of installable rows","value":"Two"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"16 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\n[[if dryer]]Dryer：AC 380V+-10% Three Phase 25A(10 Kw)[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb
  where name = $mig$Fab Pro 3I$mig$
    and supply_description = $mig$DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Fab Pro 3i"},{"label":"Number of installable rows","value":"Two"},{"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},{"label":"Number of installable printing heads","value":"16 Heads"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Blanket width","value":"1900 mm"},{"label":"Max. Media width","value":"1850 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\nDryer：AC 380V+-10% Three Phase 25A(10 Kw)"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},{"label":"Rip software","value":"Neostampa"}]$mig$::jsonb;

-- Position Printer
update public.fms_ocpi_machines set
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"POSITION PRINTER (MODEL NO. DA188SLP)"},{"label":"Number of installable rows","value":"2"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"16"},{"label":"Max. Printing width","value":"1850 mm"},{"label":"Max. Fabric width","value":"1900 mm"},{"label":"Electrical Voltage","value":"Printer：AC380V three-phase｜15kW｜50Hz/60Hz\nBelt Heater：AC380V three phase｜15 kW｜50Hz/60Hz\n[[if dryer]]Dryer：AC380V three phase｜16 kW｜50Hz/60Hz[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜1m³/hr (Dry, No Oil or No Vapour)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"15 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"[[if dryer]]Electric and Gas[[/if]]"}]$mig$::jsonb
  where name = $mig$Position Printer$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"POSITION PRINTER (MODEL NO. DA188SLP)"},{"label":"Number of installable rows","value":"2"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"16"},{"label":"Max. Printing width","value":"1850 mm"},{"label":"Max. Fabric width","value":"1900 mm"},{"label":"Electrical Voltage","value":"Printer：AC380V three-phase｜15kW｜50Hz/60Hz\nBelt Heater：AC380V three phase｜15 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜1m³/hr (Dry, No Oil or No Vapour)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"15 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"Electric and Gas"}]$mig$::jsonb;

-- Homer K24
update public.fms_ocpi_machines set
      supply_description = $mig$LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINT HEADS[[if dryer]] AND CHINES DRYER[[/if]] (Model No: {{machine_model_no}})$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K24"},{"label":"Number of installable rows","value":"3"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"24"},{"label":"Max. Printing width","value":"1900 mm"},{"label":"Max. Fabric width","value":"1920 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer 34A (7.4 kW) + Belt Drying 25A (5.2 Kw)｜50Hz/60Hz\n[[if dryer]]Dryer：AC380V +- 10% three phase｜25A (15.9 Kw)｜50Hz/60Hz[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"[[if dryer]]Electric[[/if]]"}]$mig$::jsonb
  where name = $mig$Homer K24$mig$
    and supply_description = $mig$LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINT HEADS AND CHINES DRYER (Model No: {{machine_model_no}})$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K24"},{"label":"Number of installable rows","value":"3"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"24"},{"label":"Max. Printing width","value":"1900 mm"},{"label":"Max. Fabric width","value":"1920 mm"},{"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer 34A (7.4 kW) + Belt Drying 25A (5.2 Kw)｜50Hz/60Hz\nDryer：AC380V +- 10% three phase｜25A (15.9 Kw)｜50Hz/60Hz"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"Electric"}]$mig$::jsonb;

-- Homer K32
update public.fms_ocpi_machines set
      supply_description = $mig$STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS[[if dryer]] WITH DRYER[[/if]][[if centering]] WITH CENTRING DEVICE[[/if]].$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K32"},{"label":"Number of installable rows","value":"4"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"32"},{"label":"Max. Printing width","value":"1900 mm"},{"label":"Max. Fabric width","value":"1920 mm"},{"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\n[[if dryer]]Dryer：AC380V three phase｜16 kW｜50Hz/60Hz[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"[[if dryer]]Dual Dryer[[/if]]"}]$mig$::jsonb
  where name = $mig$Homer K32$mig$
    and supply_description = $mig$STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS WITH DRYER WITH CENTRING DEVICE.$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K32"},{"label":"Number of installable rows","value":"4"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"32"},{"label":"Max. Printing width","value":"1900 mm"},{"label":"Max. Fabric width","value":"1920 mm"},{"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"Dual Dryer"}]$mig$::jsonb;

-- K64
update public.fms_ocpi_machines set
      supply_description = $mig$DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS[[if centering]] AND CENTERING SYSTEM[[/if]][[if dryer]] & DRYER[[/if]] (Model No: HM1800B-TK64-A1)$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K64"},{"label":"Number of installable rows","value":"8"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"64"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Fabric width","value":"1800 mm"},{"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\n[[if dryer]]Dryer：AC380V three phase｜16 kW｜50Hz/60Hz[[/if]]"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"[[if dryer]]Oil + Electric[[/if]]"}]$mig$::jsonb
  where name = $mig$K64$mig$
    and supply_description = $mig$DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS AND CENTERING SYSTEM & DRYER (Model No: HM1800B-TK64-A1)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"Homer K64"},{"label":"Number of installable rows","value":"8"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"64"},{"label":"Max. Printing width","value":"1800 mm"},{"label":"Max. Fabric width","value":"1800 mm"},{"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},{"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},{"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},{"label":"Installed electrical power","value":"30 KW"},{"label":"Rip software","value":"Neostampa"},{"label":"Dryer","value":"Oil + Electric"}]$mig$::jsonb;

-- JPK
update public.fms_ocpi_machines set
      supply_description = $mig$Total amount of the supply MS JPK EVO V4[[if !dryer]] (Without Dryer)[[/if]]$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"MS-JPK-evo V4"},{"label":"Number of installable rows","value":"4"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"32"},{"label":"Number of colors","value":"8"},{"label":"Max. printing width","value":"1800 mm"},{"label":"Max. fabric width","value":"1820 mm"},{"label":"Electrical Voltage","value":"400 V - 50 Hz-Ill"},{"label":"Compressed Air consumption","value":"approx. max 150 l/min - 7 bar"},{"label":"Water Consumption","value":"clean and filtered — approx. max.\nConsumption 200-800 I/h — 2 bar-"},{"label":"Installed electrical power","value":"40 kVA for the printer\n[[if dryer]]50 kVA for the dryer[[/if]]"},{"label":"RIP software","value":"Included"},{"label":"Designing software","value":"Not Included"},{"label":"PC for the rip","value":"Not Included"}]$mig$::jsonb
  where name = $mig$JPK$mig$
    and supply_description = $mig$Total amount of the supply MS JPK EVO V4 (Without Dryer)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model","value":"MS-JPK-evo V4"},{"label":"Number of installable rows","value":"4"},{"label":"Number of installed printing heads","value":"{{head_count}}"},{"label":"Number of installable printing heads","value":"32"},{"label":"Number of colors","value":"8"},{"label":"Max. printing width","value":"1800 mm"},{"label":"Max. fabric width","value":"1820 mm"},{"label":"Electrical Voltage","value":"400 V - 50 Hz-Ill"},{"label":"Compressed Air consumption","value":"approx. max 150 l/min - 7 bar"},{"label":"Water Consumption","value":"clean and filtered — approx. max.\nConsumption 200-800 I/h — 2 bar-"},{"label":"Installed electrical power","value":"40 kVA for the printer\n50 kVA for the dryer"},{"label":"RIP software","value":"Included"},{"label":"Designing software","value":"Not Included"},{"label":"PC for the rip","value":"Not Included"}]$mig$::jsonb;

-- Rocket
update public.fms_ocpi_machines set
      supply_description = $mig$STANDARD DIGITAL DIRECT-TO-FABRIC TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES KYOCERA EX600 RC PRINTHEAD[[if dryer]] WITH DRYER[[/if]] (MODEL: HMSINGLEPASS 1800-ROCKET-K) (HSN Code: 84433910)$mig$,
      spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model Number","value":"HMSINGLEPASS 1800-ROCKET-K"},{"label":"Printing Width","value":"1515 mm"},{"label":"Working width","value":"1800 MM"},{"label":"Fabric Width","value":"1800 MM"},{"label":"Production Speed","value":"40 to 80 MPM"},{"label":"Fabric type","value":"Woven, 80-300 GSM"},{"label":"Print Ink Material","value":"Reactive"},{"label":"Dryer","value":"[[if dryer]]Heating by Thermic Oil[[/if]]"},{"label":"Working temperature","value":"20 to 26 C"},{"label":"Humidity","value":"45-60 % (No condensation)"},{"label":"Number of installed printing heads","value":"{{head_count}} for 1515 mm printing width"},{"label":"Max. Accuracy","value":"1200*2400DPI"},{"label":"Number of installable printing heads","value":"272"},{"label":"Printing Head","value":"Industrial-grade piezoelectric nozzle (Kyocera, Japan)"},{"label":"Number of installable rows","value":"4 module 8 Colours"},{"label":"Rotary attachment","value":"Jilong, 4 rotary attachment."},{"label":"RIP software","value":"Neostampa"},{"label":"Install Power","value":"145 Kw ( Dryer & rotary110 Kw)\nAC380V±10%, 3-Phrase| 50Hz/60 Hz"},{"label":"Water","value":"0.5 to 1 m3/Hr"},{"label":"Air","value":"0.15 m3/Hr"}]$mig$::jsonb,
      composition = $mig$["Motorized Winder and Unwinder","Fabric Opening Device","Conveyor Belt System","Fabric Pressing Cylinder","Printing Head Module","Height Adjustment of Printing Carriage","Ink Circulation System","Degassing & Negative Pressure System","Ink Supply System","Rotary Printing Attachment","[[if dryer]]Dryer System[[/if]]","Electronic Parts"]$mig$::jsonb
  where name = $mig$Rocket$mig$
    and supply_description = $mig$STANDARD DIGITAL DIRECT-TO-FABRIC TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES KYOCERA EX600 RC PRINTHEAD WITH DRYER (MODEL: HMSINGLEPASS 1800-ROCKET-K) (HSN Code: 84433910)$mig$
    and spec_rows = $mig$[{"label":"No. of Machine Supply","value":"{{machine_count}}"},{"label":"Model Number","value":"HMSINGLEPASS 1800-ROCKET-K"},{"label":"Printing Width","value":"1515 mm"},{"label":"Working width","value":"1800 MM"},{"label":"Fabric Width","value":"1800 MM"},{"label":"Production Speed","value":"40 to 80 MPM"},{"label":"Fabric type","value":"Woven, 80-300 GSM"},{"label":"Print Ink Material","value":"Reactive"},{"label":"Dryer","value":"Heating by Thermic Oil"},{"label":"Working temperature","value":"20 to 26 C"},{"label":"Humidity","value":"45-60 % (No condensation)"},{"label":"Number of installed printing heads","value":"{{head_count}} for 1515 mm printing width"},{"label":"Max. Accuracy","value":"1200*2400DPI"},{"label":"Number of installable printing heads","value":"272"},{"label":"Printing Head","value":"Industrial-grade piezoelectric nozzle (Kyocera, Japan)"},{"label":"Number of installable rows","value":"4 module 8 Colours"},{"label":"Rotary attachment","value":"Jilong, 4 rotary attachment."},{"label":"RIP software","value":"Neostampa"},{"label":"Install Power","value":"145 Kw ( Dryer & rotary110 Kw)\nAC380V±10%, 3-Phrase| 50Hz/60 Hz"},{"label":"Water","value":"0.5 to 1 m3/Hr"},{"label":"Air","value":"0.15 m3/Hr"}]$mig$::jsonb
    and composition = $mig$["Motorized Winder and Unwinder","Fabric Opening Device","Conveyor Belt System","Fabric Pressing Cylinder","Printing Head Module","Height Adjustment of Printing Carriage","Ink Circulation System","Degassing & Negative Pressure System","Ink Supply System","Rotary Printing Attachment","Dryer System","Electronic Parts"]$mig$::jsonb;

-- Position Printer · cancellation
update public.fms_ocpi_machine_sections set
      body = $mig$Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.

All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time.

We request you to submit the copy of duly signed order confirmation by you to us for acceptance.

Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.

Loading & Unloading of Machine at Customers Premises, Insurance will be bare by Customer.

[[if usd]]If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note.[[/if]]$mig$
  where id = $mig$415c2069-c488-48b4-b1b3-5b11a1541345$mig$::uuid
    and body = $mig$Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.

All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time.

We request you to submit the copy of duly signed order confirmation by you to us for acceptance.

Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.

Loading & Unloading of Machine at Customers Premises, Insurance will be bare by Customer.

If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note.$mig$;

-- Rocket · scope_of_supply
update public.fms_ocpi_machine_sections set
      body = $mig$Motorized Winder and Unwinder
The machine is equipped with a fully motorized winder and unwinder system with synchronized drive control. It incorporates an advanced closed-loop tension control system, ensuring stable and uniform fabric tension at both entry and exit. This system supports handling of various fabric types (light to heavy GSM) without distortion, wrinkles, or elongation, ensuring smooth feeding into the printing zone.

Fabric Opening Device
The fabric opening system includes precision-engineered tension bars with adjustable incidence angles to control fabric tension dynamically. It is equipped with a spreading roller for uniform width control and a bent (banana) bar for wrinkle removal. The operator can switch between these based on fabric characteristics, ensuring proper alignment, crease removal, and consistent fabric presentation before printing.

Conveyor Belt System
The conveyor system is designed for high stability and precision fabric transport. Dryer conveyor length: 30–32 meters. Blanket length: 21.9 meters. Blanket width: 2100 mm. Make: Hebasit. Open jointed blanket for optimum fitting at sight; fitting will be done by a qualified engineer of Homer. The blanket is made of high-temperature-resistant material, ensuring durability and dimensional stability. The integrated blanket washing unit consists of a driven rotary brush system, cleaning and drying sponge rollers, and wipers for water residue removal. This ensures continuous cleaning, improved adhesion, and extended blanket life, which is critical for high-quality digital printing.

Fabric Pressing Cylinder
An adjustable pneumatic pressure system is provided for the fabric pressing cylinder. This ensures uniform fabric adhesion to the conveyor belt, elimination of air gaps between fabric and blanket, and stable fabric movement during high-speed printing. This directly improves print sharpness, registration, and consistency.

Printing Head Module
The machine is equipped with high-performance industrial printheads. Model: KYOCERA RC MODEL EX600RC. Max. Accuracy: 1200*2400DPI. Total Heads: 224 pcs (1515mm). Configuration: 4 stations, 8 colours. Heads distribution: 2 colours each station, 2 row heads each colour. Digital printing unit: the machine reserves an appropriate position for installing the digital printing unit. This space is sealed with a profile structure and equipped with two 5p air conditioners and high-power humidifiers (sealed space structure and humidifier, air conditioning at customer care). Advanced technology to achieve high-resolution output, high-speed production capability and precision drop control. The system supports variable drop technology for better colour gradation and ink efficiency.

Height Adjustment of Printing Carriage
The printing carriage includes an automated height adjustment mechanism to accommodate different fabric thicknesses. It ensures optimal head-to-fabric gap, prevention of head strikes, and consistent print quality across varying materials. The system is integrated with a centralized electrical control cabinet for precise operation and safety interlocks.

Ink Circulation System
A continuous ink circulation system is provided to maintain constant ink movement across the printheads. This system prevents pigment sedimentation, reduces nozzle clogging, and maintains uniform ink temperature and viscosity. It ensures consistent jetting performance and minimizes downtime.

Degassing & Negative Pressure System
The machine is equipped with a high-flow, high-speed degassing unit to remove micro air bubbles and an automatic negative pressure control system. This combination ensures a stable meniscus at nozzle level, accurate ink droplet formation, and prevention of ink leakage or air suction, resulting in consistent print quality and improved head life.

Ink Supply System
The machine includes standard 15-litre ink tanks for each colour and provision for a centralized bulk ink supply system up to 1-ton capacity. This allows continuous ink feeding without interruption, reduced manual refilling and improved production efficiency. The system is designed for compatibility with large-scale industrial operations.

Rotary Printing Attachment
The system is integrated with 4 rotary printing units from Jilong, a globally recognized brand, enabling hybrid printing capability: a total of 4 rotary stations, 3 magnetic rotary units and 1 squeeze bar unit (for metallic/foil applications like silver & gold). Configuration: 2 rotary units before digital printing and 2 rotary units after digital printing. Screen repeat options offered: 640 mm / 726 mm / 819 mm / 914 mm / 1018 mm / 1206 mm. Endring width: 62 mm. Screen + endring length: 2060 mm. Magnet rod and length: 1898 mm, small head smooth face. Colour type pump: JB76. This enables pre-treatment or base printing, special effects and foil applications, and enhanced design flexibility.

[[if dryer]]Dryer System[[/if]]
[[if dryer]]The machine is equipped with a multi-stage drying system: 4 independent drying chambers, an oil-based heating system for uniform temperature distribution, and a single conveyor with 3-pass fabric movement. This ensures efficient moisture evaporation, proper ink fixation and uniform drying across the fabric width. The multi-pass system increases drying efficiency without increasing machine footprint.[[/if]]

Electronic Parts
PLC: Siemens. Blanket servo driver: KEBA. Screen servo driver: KEBA. Blanket driving motor: DMT directly driving motor. Screen head driving motor: DMT directly driving motor. Pneumatic: imported international brand. Touch screen: Weview.

Other important technical specification
Open-style designed net support, magnetic scrape. The computer distributed control system based on CAN-BUS is adopted, and the circular network independent drive and automatic matching servo control system are adopted. Glue device: thermal glue device (1 pc φ20 magnet rod). Drive logical controlling: adopts SIEMENS PLC; fabric feeding, over feeding and dryer exit adopt frequency inverter driving. Adopts HMI operation table, display and file various information (speed, temperature, registration parameter, magnetic squeegee pressure, running status, etc.). Low-voltage equipment: France SCHNEIDER products.$mig$
  where id = $mig$166f775f-e1ee-4be1-9e59-304e26769cce$mig$::uuid
    and body = $mig$Motorized Winder and Unwinder
The machine is equipped with a fully motorized winder and unwinder system with synchronized drive control. It incorporates an advanced closed-loop tension control system, ensuring stable and uniform fabric tension at both entry and exit. This system supports handling of various fabric types (light to heavy GSM) without distortion, wrinkles, or elongation, ensuring smooth feeding into the printing zone.

Fabric Opening Device
The fabric opening system includes precision-engineered tension bars with adjustable incidence angles to control fabric tension dynamically. It is equipped with a spreading roller for uniform width control and a bent (banana) bar for wrinkle removal. The operator can switch between these based on fabric characteristics, ensuring proper alignment, crease removal, and consistent fabric presentation before printing.

Conveyor Belt System
The conveyor system is designed for high stability and precision fabric transport. Dryer conveyor length: 30–32 meters. Blanket length: 21.9 meters. Blanket width: 2100 mm. Make: Hebasit. Open jointed blanket for optimum fitting at sight; fitting will be done by a qualified engineer of Homer. The blanket is made of high-temperature-resistant material, ensuring durability and dimensional stability. The integrated blanket washing unit consists of a driven rotary brush system, cleaning and drying sponge rollers, and wipers for water residue removal. This ensures continuous cleaning, improved adhesion, and extended blanket life, which is critical for high-quality digital printing.

Fabric Pressing Cylinder
An adjustable pneumatic pressure system is provided for the fabric pressing cylinder. This ensures uniform fabric adhesion to the conveyor belt, elimination of air gaps between fabric and blanket, and stable fabric movement during high-speed printing. This directly improves print sharpness, registration, and consistency.

Printing Head Module
The machine is equipped with high-performance industrial printheads. Model: KYOCERA RC MODEL EX600RC. Max. Accuracy: 1200*2400DPI. Total Heads: 224 pcs (1515mm). Configuration: 4 stations, 8 colours. Heads distribution: 2 colours each station, 2 row heads each colour. Digital printing unit: the machine reserves an appropriate position for installing the digital printing unit. This space is sealed with a profile structure and equipped with two 5p air conditioners and high-power humidifiers (sealed space structure and humidifier, air conditioning at customer care). Advanced technology to achieve high-resolution output, high-speed production capability and precision drop control. The system supports variable drop technology for better colour gradation and ink efficiency.

Height Adjustment of Printing Carriage
The printing carriage includes an automated height adjustment mechanism to accommodate different fabric thicknesses. It ensures optimal head-to-fabric gap, prevention of head strikes, and consistent print quality across varying materials. The system is integrated with a centralized electrical control cabinet for precise operation and safety interlocks.

Ink Circulation System
A continuous ink circulation system is provided to maintain constant ink movement across the printheads. This system prevents pigment sedimentation, reduces nozzle clogging, and maintains uniform ink temperature and viscosity. It ensures consistent jetting performance and minimizes downtime.

Degassing & Negative Pressure System
The machine is equipped with a high-flow, high-speed degassing unit to remove micro air bubbles and an automatic negative pressure control system. This combination ensures a stable meniscus at nozzle level, accurate ink droplet formation, and prevention of ink leakage or air suction, resulting in consistent print quality and improved head life.

Ink Supply System
The machine includes standard 15-litre ink tanks for each colour and provision for a centralized bulk ink supply system up to 1-ton capacity. This allows continuous ink feeding without interruption, reduced manual refilling and improved production efficiency. The system is designed for compatibility with large-scale industrial operations.

Rotary Printing Attachment
The system is integrated with 4 rotary printing units from Jilong, a globally recognized brand, enabling hybrid printing capability: a total of 4 rotary stations, 3 magnetic rotary units and 1 squeeze bar unit (for metallic/foil applications like silver & gold). Configuration: 2 rotary units before digital printing and 2 rotary units after digital printing. Screen repeat options offered: 640 mm / 726 mm / 819 mm / 914 mm / 1018 mm / 1206 mm. Endring width: 62 mm. Screen + endring length: 2060 mm. Magnet rod and length: 1898 mm, small head smooth face. Colour type pump: JB76. This enables pre-treatment or base printing, special effects and foil applications, and enhanced design flexibility.

Dryer System
The machine is equipped with a multi-stage drying system: 4 independent drying chambers, an oil-based heating system for uniform temperature distribution, and a single conveyor with 3-pass fabric movement. This ensures efficient moisture evaporation, proper ink fixation and uniform drying across the fabric width. The multi-pass system increases drying efficiency without increasing machine footprint.

Electronic Parts
PLC: Siemens. Blanket servo driver: KEBA. Screen servo driver: KEBA. Blanket driving motor: DMT directly driving motor. Screen head driving motor: DMT directly driving motor. Pneumatic: imported international brand. Touch screen: Weview.

Other important technical specification
Open-style designed net support, magnetic scrape. The computer distributed control system based on CAN-BUS is adopted, and the circular network independent drive and automatic matching servo control system are adopted. Glue device: thermal glue device (1 pc φ20 magnet rod). Drive logical controlling: adopts SIEMENS PLC; fabric feeding, over feeding and dryer exit adopt frequency inverter driving. Adopts HMI operation table, display and file various information (speed, temperature, registration parameter, magnetic squeegee pressure, running status, etc.). Low-voltage equipment: France SCHNEIDER products.$mig$;

-- K64 · sale_conditions
update public.fms_ocpi_machine_sections set
      body = $mig$Transport Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Payment terms: {{payment_terms}}
Insurance: Product Insurance borne by Customer.
[[if usd]]Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note[[/if]]

Bank Details:
{{bank_block}}$mig$
  where id = $mig$b4ccd579-7520-438a-91db-0cfb9b98e73c$mig$::uuid
    and body = $mig$Transport Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Payment terms: {{payment_terms}}
Insurance: Product Insurance borne by Customer.
Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note

Bank Details:
{{bank_block}}$mig$;

-- KoloRado Alpha 3 — 12 heads · sale_conditions
update public.fms_ocpi_machine_sections set
      body = $mig$Transport Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Payment Terms: {{payment_terms}}
[[if usd]]Forex Clause Impact: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note[[/if]]
Insurance: Product Insurance is Borne by Customer.

Bank Details:
{{bank_block}}$mig$
  where id = $mig$bd35c33b-a47b-4bda-9228-f04ed9fd246a$mig$::uuid
    and body = $mig$Transport Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Payment Terms: {{payment_terms}}
Forex Clause Impact: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note
Insurance: Product Insurance is Borne by Customer.

Bank Details:
{{bank_block}}$mig$;

-- Rocket · sale_conditions
update public.fms_ocpi_machine_sections set
      body = $mig$Trade Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Terms of Payment: {{payment_terms}}
Validity of Order Confirmation: {{quotation_validity_days}} days
Insurance: Borne by the customer.

Note: INK'S & HEAD'S, Custom Duty & Transportation charges will be paid by Customer.

[[if usd]]Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note.[[/if]]

Bank Details:
{{bank_block}}$mig$
  where id = $mig$a7a1637e-d4e8-41fc-8162-d139735c0b77$mig$::uuid
    and body = $mig$Trade Terms: {{trade_term}}
Tentative Machine Delivery Date: {{delivery_date}}
Applicable from the date of signing of this contract.
Terms of Payment: {{payment_terms}}
Validity of Order Confirmation: {{quotation_validity_days}} days
Insurance: Borne by the customer.

Note: INK'S & HEAD'S, Custom Duty & Transportation charges will be paid by Customer.

Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note.

Bank Details:
{{bank_block}}$mig$;

do $$
declare
  v_supply   int;
  v_specrow  int;
  v_specline int;
  v_bullet   int;
  v_secdry   int;
  v_forex    int;
  v_stray    int;
begin
  -- Every count this migration claims, read back off the rows it wrote.
  --
  -- ⚠ MARKERS, NOT ROWS. K64 and Homer K32 each carry TWO wrappers in one supply
  --   line — a dryer and a centering device — so nine machines hold eleven
  --   wrappers, and counting rows would have passed this file while two of the
  --   edits were missing.
  select coalesce(sum((length(supply_description) - length(replace(supply_description, '[[if ', ''))) / 5), 0)
    into v_supply
    from public.fms_ocpi_machines
   where has_template and supply_description is not null;

  select count(*) into v_specrow
    from public.fms_ocpi_machines m, jsonb_array_elements(m.spec_rows) r
   where m.has_template and (r->>'value') like '[[if dryer]]%' and (r->>'value') like '%[[/if]]'
     and (r->>'label') = 'Dryer';

  select count(*) into v_specline
    from public.fms_ocpi_machines m, jsonb_array_elements(m.spec_rows) r
   where m.has_template and (r->>'value') like '%[[if %' and (r->>'label') <> 'Dryer';

  select count(*) into v_bullet
    from public.fms_ocpi_machines m, jsonb_array_elements_text(m.composition) b
   where m.has_template and b like '%[[if %';

  select count(*) into v_secdry
    from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
    lateral unnest(string_to_array(s.body, E'\n')) ln
   where m.has_template and ln like '[[if dryer]]%';

  select count(*) into v_forex
    from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
    lateral unnest(string_to_array(s.body, E'\n')) ln
   where m.has_template and ln like '[[if usd]]%';

  if v_supply  <> 11 then raise exception 'supply lines marked = %, expected 11', v_supply; end if;
  if v_specrow <> 5 then raise exception 'whole Dryer spec rows marked = %, expected 5', v_specrow; end if;
  if v_specline <> 8 then raise exception 'spec value lines marked = %, expected 8', v_specline; end if;
  if v_bullet  <> 1 then raise exception 'composition bullets marked = %, expected 1', v_bullet; end if;
  if v_secdry  <> 2 then raise exception 'dryer section lines marked = %, expected 2', v_secdry; end if;

  -- 🔴 THE ONE THE BRIEF INSISTED ON. Searching for "Forex Impact" finds two of
  --    the four; the wording differs on the others. Four, or this migration has
  --    left a rupee contract carrying a dollar clause.
  if v_forex <> 4 then raise exception 'forex clauses marked = %, expected 4', v_forex; end if;

  -- No opening marker anywhere without its closing one, in any template field.
  select count(*) into v_stray from (
    select m.supply_description t from public.fms_ocpi_machines m where m.has_template
    union all select m.intro_text from public.fms_ocpi_machines m where m.has_template
    union all select r->>'value' from public.fms_ocpi_machines m, jsonb_array_elements(m.spec_rows) r where m.has_template
    union all select b from public.fms_ocpi_machines m, jsonb_array_elements_text(m.composition) b where m.has_template
    union all select s.body from public.fms_ocpi_machine_sections s
       join public.fms_ocpi_machines m on m.id = s.machine_id where m.has_template
  ) x
   where (length(t) - length(replace(t, '[[if ', ''))) / 5
      <> (length(t) - length(replace(t, '[[/if]]', ''))) / 7;
  if v_stray <> 0 then raise exception '% template strings have unbalanced [[if]] markers', v_stray; end if;

  raise notice 'OCPI-31/33 · % supply lines, % whole dryer rows, % spec lines, % bullets, % dryer section lines, % forex clauses',
    v_supply, v_specrow, v_specline, v_bullet, v_secdry, v_forex;
end $$;
