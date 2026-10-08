/**
 * Constants shared by schedule.ts, categories.ts and flow.ts.
 *
 * ⚠ KEEP THIS FILE IMPORT-FREE. schedule.ts and categories.ts each need the other's
 *   constants; importing them from each other made a cycle in which categories.ts read
 *   SURAT_GUID before schedule.ts had set it, and the whole app failed to load.
 */

/** Enterprises Surat's company guid in ConnectWave and Central Masters. */
export const SURAT_GUID = "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e";

/** Otec Surat — only on the Closing stock page; the retest flow itself is Enterprises Surat's. */
export const OTEC_SURAT_GUID = "a4e100d1-3b6f-4193-876a-c754f1a74552";

/** The tab for inks with no Ink type in Bushra Central Master or Central Masters. */
export const NOT_CATEGORISED = "Not categorised";
