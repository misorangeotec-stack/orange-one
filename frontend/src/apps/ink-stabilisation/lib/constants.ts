/**
 * Constants shared by schedule.ts, categories.ts and flow.ts.
 *
 * ⚠ KEEP THIS FILE IMPORT-FREE. schedule.ts and categories.ts each need the other's
 *   constants; importing them from each other made a cycle in which categories.ts read
 *   SURAT_GUID before schedule.ts had set it, and the whole app failed to load.
 */

/** Enterprises Surat's company guid in ConnectWave and Central Masters. */
export const SURAT_GUID = "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e";

/** The tab for inks with no Ink type in Bushra Central Master or Central Masters. */
export const NOT_CATEGORISED = "Not categorised";
