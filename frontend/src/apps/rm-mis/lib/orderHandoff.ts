/**
 * RM IMS → PURCHASE FMS hand-off. The SAME hand-off as Ink IMS (see ink-mis/lib/orderHandoff.ts):
 * the purchase raise forms read one storage key and one `?ink=` link for both sheets, and RM IMS
 * marks its orders `sheet: "rm"` so the form's banner and note say where they came from.
 */
export * from "../../ink-mis/lib/orderHandoff";
