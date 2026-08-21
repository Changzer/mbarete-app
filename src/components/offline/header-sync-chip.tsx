"use client";

import { useState } from "react";
import { useOutbox } from "@/components/offline/outbox";
import { OutboxQueue } from "@/components/offline/outbox-queue";
import { SyncStatusChip, syncStepFor } from "@/components/offline/sync-status-chip";

/**
 * The header pill. It exists only when the app owes the server something or
 * cannot reach it — on a connected day the header simply has nothing there,
 * which is itself the strongest "everything is through" signal available.
 *
 * Tapping it opens the phone's queue: the one place a stuck capture can be
 * seen, retried, or deliberately given up on.
 */
export function HeaderSyncChip() {
  const outbox = useOutbox();
  const [queueOpen, setQueueOpen] = useState(false);

  const step = outbox ? syncStepFor(outbox) : null;
  if (!outbox || !step) return null;

  return (
    <>
      <button
        type="button"
        data-testid="header-sync-chip"
        onClick={() => setQueueOpen(true)}
        disabled={outbox.pending === 0}
        className="press focus-ring flex h-11 max-w-[52vw] items-center rounded-full disabled:cursor-default"
      >
        <SyncStatusChip step={step} count={outbox.pending} />
      </button>
      <OutboxQueue open={queueOpen} onOpenChange={setQueueOpen} />
    </>
  );
}
