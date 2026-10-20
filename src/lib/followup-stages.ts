/**
 * The follow-up board's stages and feed entry kinds, dependency-free so the
 * schema, the server and the browser bundle can all import them.
 */
export const FOLLOWUP_STAGES = ["deposit", "production", "qc", "to_warehouse", "at_warehouse"] as const;
export type FollowupStage = (typeof FOLLOWUP_STAGES)[number];

export const FOLLOWUP_ENTRY_KINDS = [
  "comment",
  "stage",
  "next_step",
  "problem",
  "check_added",
  "check_done",
  "check_undone",
  "check_removed",
] as const;
export type FollowupEntryKind = (typeof FOLLOWUP_ENTRY_KINDS)[number];
