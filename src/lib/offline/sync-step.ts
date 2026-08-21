/**
 * The sync ladder: the one place that decides which rung a phone is standing
 * on, kept away from the components so both the header chip and the floating
 * status agree by construction rather than by two similar `if` chains.
 */
export type SyncStep =
  /** Server unreachable, nothing owed — the app is simply working locally. */
  | "offline"
  /** A capture has just landed on the phone. */
  | "savedLocal"
  /** Captures on the phone, waiting for a connection. */
  | "waiting"
  /** Delivering right now. */
  | "syncing"
  /** Everything is on the server. */
  | "synced"
  /** A delivery the server refused; always shown with a way to retry. */
  | "failed"
  /** Both sides changed; a person decides. */
  | "conflict"
  /** Fields are through, the photos are still going. */
  | "imagePending";

export type SyncCounts = {
  pending: number;
  blocked: number;
  syncing: boolean;
  needsSignIn: boolean;
  offline: boolean;
};

/**
 * Returns the rung to show, or null when there is nothing to say — which is
 * the normal connected state, and deliberately renders no chip at all rather
 * than a permanent green "Synced" the eye learns to skip.
 *
 * Order matters. A phone that is both offline and holding captures reads as
 * "waiting", because the count is the part the agent needs; bare "offline" is
 * for a phone that owes the server nothing.
 */
export function syncStepFor(state: SyncCounts): SyncStep | null {
  if (state.syncing) return "syncing";
  if (state.blocked > 0 || state.needsSignIn) return "failed";
  if (state.pending > 0) return "waiting";
  if (state.offline) return "offline";
  return null;
}
