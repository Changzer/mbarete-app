# Live-action teaser — Seedance 2.5 prompt

The motion-graphics teaser in this folder is the in-house cut. This is its
live-action sibling: a 12s spot generated with **Seedance 2.5 (Dreamina)** inside
CapCut, showing a trade agent working the Yiwu aisles with the app.

CapCut caps the prompt at 2,000 characters — the text below is 1,941.

## Reference images

`assets/seedance-refs/` holds real captures from this app (produced by
`scripts/teaser/capture.mjs` against the seeded demo data), so the model renders
the actual UI instead of inventing one. Attach them rather than describing the
screens:

| File | Beat | Shows |
| --- | --- | --- |
| `m3-reading-photos.jpg` | Shot 2 | Add Product with the bottle thumbnail and the "Reading photos…" pill |
| `m4-form-filled.jpg` | Shot 2 | Filled form — `Board read as ¥12.5 / 48/box`, "AI-read — please verify" |
| `m5-catalog-with-new-product.jpg` | Shot 4 | Catalog scrolled to the mini fan, utensil set and the just-added 保温水杯 500ml |
| `product-shot-bottle-with-board.jpg` | Shot 2 | The bottle beside its handwritten ¥12.5 · 48/box board |

Every number in the prompt matches the seeded product: ¥12.50, MOQ 48, 48/ctn,
bilingual name `Vacuum Insulated Bottle 500ml` / `保温水杯 500ml`.

## Prompt

```text
Cinematic 12s commercial, live-action documentary realism, warm film grade, shallow depth of field. Same man in every shot: trade agent, 35, short beard, navy jacket, small backpack, walking Yiwu International Trade City — bright corridors of wholesale booths packed with housewares and gadgets, fluorescent lights, green Chinese aisle signs, buyers with rolling suitcases in soft bokeh. The phone always shows the real app UI from the attached screenshots: cream background, red accents, red seal logo.

Shot 1 (0-3s): smooth gimbal tracking shot beside him walking the busy aisle, scanning booths, motion-blurred background.

Shot 2 (3-6s): he stops at a drinkware booth, pulls out his smartphone. Over-the-shoulder close-up: the viewfinder frames a matte burnt-terracotta vacuum flask bottle beside a small handwritten price board "¥12.5 48/box". Thumb taps the shutter, white flash — the screen becomes the attached cream "Add Product" screen: photo thumbnail, "Reading photos…" spinner pill, then the form fields fill themselves and the red Save button is tapped, no typing.

Shot 3 (6-9s): quick montage at two more booths: he snaps a sage-green handheld mini fan on its base, then a terracotta silicone utensil set in a crock; after each click the phone flashes the same "Reading photos…" then filled-form screen, and a small cream product card pops off the phone into the air beside him. Whip cuts on each click.

Shot 4 (9-12s): close-up of the phone showing the attached bilingual Product Catalog list — his thumb scrolls slowly past the freshly added products, each card with photo, English and Chinese name and price; he pockets the phone, gives a small satisfied nod and walks on toward the bright end of the corridor, camera holding as he recedes into the busy market.

Style: warm cream and vermilion red palette, realistic market, UI faithful to the reference screenshots, 35mm look, gentle grain, no narration, no subtitles.
```

## Negative prompt

```text
garbled text, gibberish letters, distorted fingers, extra hands, changing face, warped phone screen, cartoonish, neon, watermark, subtitles
```

## Generating in splits

If you generate shot by shot instead of one 12s pass, repeat the opening
paragraph in every clip so the agent stays the same man, and attach `m3` + `m4`
with Shots 2–3 (plus the product photos) and `m5` with Shot 4.
