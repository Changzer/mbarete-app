# Follow-up board (跟单)

`/followup` — where an order's suppliers are followed from deposit to the
warehouse, and a shipped order's export paperwork until it is complete.

## Cards

- **One card per supplier on a confirmed order.** Suppliers come from the
  order lines' saved supplier (`order_items.supplier_id_snapshot`), never
  from the live catalog. Lines with no saved supplier share one red
  "No supplier recorded" card; setting the supplier on the product and
  running *Update from catalog* on the order moves them onto a real card.
- **One shipment card per shipped order.** Supplier cards leave the board
  when the order ships; the order then travels as one.
- Cards are created on demand (`ensureFollowupCards`, run when the board
  opens) — idempotent through the `(order_id, kind, supplier)` unique index.
  Confirming an order, or editing a confirmed one to add a supplier, shows
  up the next time anyone opens the board. Orders confirmed before this
  feature arrive in *Deposit due*: move them to where they really are once.
- A supplier taken off an order keeps its card and history in the database
  but leaves the board; it comes back if the supplier is added again.

## Stages

`deposit → production → qc → to_warehouse → at_warehouse`, moved by the
card's buttons or by dragging. Moving a card clears its typed next step and
date (they belonged to the stage being left); the owner stays. The board
never ships an order: *At warehouse* shows how many of the order's
suppliers are in and links to the order page, where *Mark as Shipped* lives
with its confirmation.

## Next step and who

Each card has one next step, an optional due date and one person. A blank
step shows the stage's default action ("Pay the deposit", "Follow up on
production"…), so a fresh card says something without anyone typing. The
first owner is whoever created the order.

- **Needs attention**: a next step past its date, a flagged problem, or the
  no-supplier card. A missing date is never "overdue".
- **Waiting on me / on {name}**: cards whose owner is that person and that
  have something pending.
- Dates are read against the viewer's own calendar day.

## Task bell

The bell in the header (every page, phone included, when the orders module
is on) lists what is waiting on you: cards whose next step is yours — the
same set as *Waiting on me* — and open checklist items given to you. It is
read from the board, so a step done, moved on or handed to someone else
leaves the bell with nothing to dismiss. A task opens its card.

- **New**: a step or item someone else set for you, or a card someone else
  moved to a new stage while you hold it, since you last opened the bell.
  Your own changes and the cards you get by creating an order are never new.
  Each card and item records who set it and when (`next_assigned_by/at`,
  `assigned_by/at`); `users.tasks_seen_at` is when you last opened the bell.
- **The number** counts tasks that are new or overdue. Opening the bell
  marks what it showed as seen (up to the instant the list was read, so a
  task handed over a second later still rings); overdue ones keep counting
  until they are done or re-dated.
- The bell reads `/api/tasks` on each page, every minute while the tab is in
  view, and fresh on opening. A Route Handler, not a Server Action: a
  background read must not queue behind someone's save on the board.

## Feed

Updates (text plus up to six photos or files, stored as gated company
documents) and events — stage moves, next-step changes, problems, checklist
changes, and the order's own confirm/ship/reopen — in one chronological
feed. Removing an update keeps a "removed" line. Posts carry a browser-made
key, so a retried post saves once.

## Concurrency

Stage, next step and problem are guarded by the card's `version`: a stale
panel's save is refused (`conflict`), the panel re-reads the card and shows
the newer values. Checklist ticks are set-to-value, so a double click or a
retry cannot flip them back.

## Shipment paperwork

The shipment card reads the rebate dossier (`src/lib/dossier.ts`) on the
same order: the same nineteen items, ticked when their file is uploaded on
the order page, grouped by who sends them. It stays on the board until the
dossier is complete, then for two weeks after shipping.

## Not yet

- Translating updates between Chinese and English.
- Payments attributed to a supplier (each card's "paid X of Y").
- One fapiao box per factory on the shipment card (needs documents tagged
  with the supplier they came from).
