# Field capture

The market screen: photograph a product and whatever was negotiated, keep
its supplier, and move to the next product without typing. This document
is the design as built, what the code guarantees and what it does not, the
checks that only a real phone can make, and how to run a short market test.

Screen: `/catalog/capture` (the floating button on the catalog, on phones).
Review: `/catalog/drafts`, grouped by booth visit. The detailed form at
`/catalog/new` is unchanged and remains the desk tool.

## The shape of it

| Thing | What it is | Where it lives |
|---|---|---|
| Capture | One product (or one card) photographed at a booth. Minted an id (`cap-…`) before its first photo. | Phone store `captures`; server `capture_drafts.client_id` |
| Photo | The unit of durability. Written to the phone the moment it comes back from the camera. | Phone store `photos`; server `capture_draft_images` |
| Visit | The run of captures at one supplier's stand. Minted on the phone (`vis-…`) before anyone knows who the supplier is. | Phone store `visits`; server `capture_visits` |
| Addendum | A photo added to a capture after it was sealed. Its own id (`add-…`), its own delivery. | Phone store `addenda`; server `capture_draft_images.client_addendum_id` |

Interactions on the screen:

- **Take photo / Add photos** — the system camera or the library. Each photo
  is written to IndexedDB before its tile says *Saved*.
- **Next product** — seals the capture into the upload queue and starts a
  new one under the same visit. Disabled until every tile is *Saved*.
- **Supplier bar** — the visit. Shows the supplier if one was chosen on the
  phone, "Card photographed" if a card was taken this visit, otherwise
  "Supplier not set". *Set supplier* picks from the existing suppliers.
  *Change supplier* starts a new visit for everything from here on.
- **Card** — photographs a card as a contact capture under the visit. Not
  required: a card visible inside a product photo is identified at review.
- **Add photo to previous product** — an addendum for the last sealed
  capture, whether it is still waiting or already uploaded.
- **Note** — one optional line for something said and not photographed.
- **Status line** — *Saved on this device / n waiting / All uploaded /
  Offline*, the last photo's persistence time, and a storage warning when
  the browser would not promise to keep the data.

Boundaries, as agreed:

- Next product keeps the current visit.
- Change supplier seals the current product under its **original** visit
  and starts a new context for what follows.
- Leaving the screen keeps the open product on the phone, unsealed.
  Returning restores it, with its booth context, under a banner.
- A supplier assigned by mistake is corrected at review: clear the visit's
  supplier (every capture that follows the visit reverts) or set a
  different one on a single capture.

## What the code guarantees

**On the phone**

- A photo is reported *Saved* only after its IndexedDB transaction
  committed. The original bytes are written first (tens of milliseconds
  for an 8 MB frame in the automated run); compression runs afterwards
  and replaces the bytes in a second commit. If the tab dies between the
  two, the original is what uploads — bigger, not lost.
- The photo and its capture's count are written in one transaction, so a
  sealed capture never uploads short.
- A sealed capture's payload is frozen. Once it may have been sent, no
  photo is added to it and nothing about it is rewritten; new evidence is
  an addendum with its own id. A lost acknowledgement therefore never
  produces two versions of one capture on the server.
- Every row is scoped to `company:user`. Another account on the same phone
  neither sees nor uploads them. The v2 queue store from the old form is
  untouched by the upgrade and still drains.
- Persistent storage is requested on secure origins; a denial is shown,
  not enforced.

**Delivery**

- Captures go through `/api/drafts` with their client id; the server's
  unique constraint answers a replay with the existing draft. Addenda go
  through `/api/drafts/photos` with their own id and the same rule.
- A 2xx counts only with the endpoint's own body (captive portals answer
  200 to anything). Unreachable retries forever; 401/403 waits for a
  sign-in; 4xx the server means parks the item for a person; an addendum
  for a capture that has not arrived yet (409) waits its turn.
- The phone lets go of a photo only after "sent" is on disk.

**On the server**

- A capture that names a visit creates the visit row in the same
  transaction as the draft, so the supplier decision always has somewhere
  to land.
- A capture's supplier is its own, else its visit's — resolved at read
  time, never copied. A supplier approved for the visit today applies to
  the captures that arrive from a phone tomorrow.
- A supplier the phone already knew is recorded on the visit only when the
  visit has none; a reviewer's decision is never overwritten by a late
  delivery.
- Product promotion is one transaction: product row, first supplier quote,
  image rows, the draft's photos moving across, and the draft's
  settlement. The draft row is locked for the duration, and a second save
  of the same review tab finds it already imported and lands where the
  first did. Files are cleaned up outside the transaction.
- Nothing invents commercial values. A capture with no readable MOQ stays
  a draft with MOQ unknown; the form still asks a person before a product
  exists. Making finished products accept unknown quantities is deliberately
  out of scope (it touches order calculations, snapshots and exports).
- The AI names the fields it doubted (`uncertain`) and is told that a bare
  quantity with no MOQ marking is not an MOQ. Review shows "Check: …"
  first. Only the contact form ever extracts a QR code; product captures
  never treat one as a contact method.

**What it does not guarantee**

- Uploads run only while the app is in the foreground. Safari has no
  background sync; the status line says what is still waiting.
- Local storage is not permanent. Safari may purge script storage for a
  site unused for seven days; private browsing has no storage at all (the
  screen says so and refuses to pretend). The honest promise is: safe on
  this phone until uploaded, while the app keeps being used.
- Photos are not all 300 KB. A noisy 8 MB frame compressed to 1.1 MB in
  the automated run; real photos land far smaller. Quota is not the
  constraint for a day at the market, but the status line shows sizes.
- WeChat's in-app browser has its own storage. A capture made there is not
  visible from Safari or Chrome. Use the real browser or the home-screen
  app.

## Automated results (2026-09-05, `npm run test:capture`)

All seven scenarios pass against the production build and the vision stub:

1. Three photos for one product, each tile *Saved* on its own commit; Next
   product keeps the visit; the second product left without Next is
   restored after a reload with its photo and booth; both reach the server
   with the note and the right photo counts; the visit row exists.
2. Two products then a card: the card attaches to the same visit; Change
   supplier mints a new visit, the counter restarts, the old booth's rows
   are untouched.
3. Five captures of one visit: two arrive, the supplier is approved on the
   review page, three arrive later — all five resolve to it; an explicit
   override on one wins; clearing the visit reverts the four that follow it.
4. The first delivery reaches the server and the response is dropped: the
   retry replays the same id and exactly one draft exists.
5. Offline: a product and an addendum for it are stored; back online both
   arrive (two images, one with an addendum id); a second addendum after
   delivery lands on the same draft; a replayed addendum answers duplicate.
6. A v2 queue row written before the upgrade delivers; a capture under
   another account's scope on the same phone never does.
7. A supplier read off a capture photo and approved creates one supplier
   and attaches it to the visit; the photo stays the draft's own.

Also green: `tsc`, lint, 252 unit tests (including the capture model and
the uncertain-field parsing), the golden-path e2e, the tenant isolation
check (now covering `capture_visits`), migration 0025 on a local Postgres.

Measured, phone-sized JPEG (8.5 MB, 4000×3000), Chromium on the rig:

| Step | Time |
|---|---|
| Original committed (tile says *Saved*) | 68–188 ms |
| Compression, after the tile | ~1.5 s, 8533 → 1113 KB |
| Stub AI read, server side | not on the capture path |

Taps per product: Take photo (1) + shutter (1, system camera) per photo,
Next product (1). No typing.

## Device checks (not provable in a browser rig)

Run on the real phones before the market test, and note the result:

- [ ] iPhone Safari: Take photo opens the camera, returns to the page,
      tile shows *Saving* then *Saved*. Repeat ten times without leaving
      the screen.
- [ ] iPhone: switch to WeChat for two minutes, return. The open product
      and its tiles are still there; a photo taken now lands on it.
- [ ] iPhone: force-close Safari, reopen the app offline. The unfinished
      product is restored under the banner; "waiting" count matches.
- [ ] iPhone under memory pressure (several heavy apps open): take five
      photos in a row; every tile ends *Saved*; none *Not saved*.
- [ ] Android Chrome: the same four checks.
- [ ] Home-screen (installed) app on both: the persistent-storage warning
      disappears (installed apps get persistent storage).
- [ ] Private tab: the screen shows the private-mode message and refuses
      to pretend to save.
- [ ] Airplane mode for a whole booth, then back online at the door: the
      status line goes from *Offline* to *n waiting* to *All uploaded*
      without any tap.
- [ ] Real photos of a card beside a product: *Identify from a photo*
      reads the name and booth; small Chinese text and handwritten prices
      survive compression (check the stored image on the review page).

## A short market test

One buyer, one hall, one morning. Two phones if possible: one on the
capture screen, one on the old form, alternating booths.

1. Ten consecutive products at one supplier. Time from *Saved* on one
   product to the shutter of the next. Count taps.
2. A product needing four photos. Count forced waits.
3. Photograph the card only after the fifth product. At review, use
   *Identify from a photo* on a product photo that has the card in frame;
   confirm every product of the visit resolves to the supplier.
4. Change supplier and repeat two products.
5. Airplane mode for one booth. Confirm nothing was lost and nothing
   duplicated once back online.
6. Switch to WeChat mid-booth and come back.
7. That evening: review time per capture, how many needed the form
   opened, how many "Check:" flags were right.

Success is fewer interruptions with correct supplier provenance and no
lost or duplicated captures — not fewer taps followed by more review work.

## Tradeoffs made

- One photo per addendum. Keeps the idempotency id on the image row and
  the delivery trivially retry-safe; three extra photos are three taps.
- Sent captures stay on the phone for a week (rows only, photos released)
  so "Add photo to previous" works after upload and the booth counter is
  right. They are pruned on the next open.
- No product-level edit of a queued capture. Once sealed, corrections are
  addenda or review. A full offline editor was out of scope.
- The visit's supplier chosen on the phone is advisory: the server keeps
  it only when the visit has no decision yet, so review always wins.
- Identify-from-photo spends one AI read of the card budget and is a
  reviewer's action, never automatic.
