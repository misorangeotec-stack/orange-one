-- OCPI-39a · Rocket's country of origin — completing a line the previous
-- migration left half-drawn.
--
-- 🔴 THIS REPAIRS A STATE `20261107130000` CREATED. That migration filled
--    `hsn_code` for Rocket off its real Performa Invoice (folder 121). The PI
--    draws model, HSN, manufacturer and origin as one block and OMITS whatever
--    is blank — correct behaviour on ABSENT data, wrong-looking on INCOMPLETE
--    data. So Rocket's invoice began printing
--
--        (MODEL: HMSINGLEPASS 1800 ROCKETK) (HSN Code: 84433910)
--
--    and then silently dropping the origin bullet its real paper carries. Two
--    of the three lines is worse than none: a customs heading with no origin
--    beside it reads as an omission rather than a machine that has no origin on
--    record.
--
-- ⚠ READ OFF THE REAL PAPER, rendered with pdf.js, never from a deck:
--    `121 - MODI DYEING & PRINTING PVT LTD ROCKET PI.pdf` prints
--    " Country of Origin : HONG KONG , CHINA" as a bullet beneath the model and
--    HSN line. The value is stored EXACTLY as printed — including the space
--    before the comma — because it is byte-identical to the K64 rows already on
--    the master, and normalising one of them would make two machines disagree
--    about the same country.
--
-- ⚠ NO `manufacturer` IS SET. K64's papers carry "MFG: HAN GLORY (HONG KONG)
--   LIMITED"; Rocket's paper carries no MFG line at all. Filling it from K64's
--   would be inventing a fact about a different machine — the blank is the
--   honest answer and the renderer omits it.
--
-- ⚠ ADDITIVE AND IDEMPOTENT. Guarded on the cell being empty, so a value typed
--   by hand since is never overwritten and a re-run changes nothing. Frozen
--   revisions print from their stored payload and are unaffected.

update fms_ocpi_machines
   set country_of_origin = 'HONG KONG , CHINA', updated_at = now()
 where name = 'Rocket'
   and coalesce(trim(country_of_origin), '') = '';
