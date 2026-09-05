# Teaser video pipeline

Everything needed to reproduce the screenshots and the 13.8s teaser video in
`videos/mbarete-teaser/` (built with [HyperFrames](https://github.com/heygen-com/hyperframes),
`npx skills add heygen-com/hyperframes`).

## 1. Boot the app with demo data

```bash
# Postgres with the app's default DATABASE_URL, then:
cp .env.example .env.local        # AUTH_SECRET, ADMIN_EMAIL=demo@mbarete.local, ADMIN_PASSWORD=…
# point AI transcription at the local mock (no API key needed):
#   MOONSHOT_API_KEY=demo-local-mock
#   MOONSHOT_BASE_URL=http://127.0.0.1:8787/v1
#   TRANSCRIBE_PROVIDER=moonshot
npm run build && npm start        # production mode — dev mode leaves the Next.js
                                  # badge in shots and breaks photo previews
                                  # (StrictMode revokes the object URLs)
node scripts/teaser/vision-mock.mjs &   # answers "Fill from photos" with a fixed
                                        # product reading (the vacuum bottle),
                                        # delayed ~3.8s so "Reading photos…" is
                                        # visible on camera. Edit READING there
                                        # to capture a different product.
```

Copy the product photos from `videos/mbarete-teaser/assets/` into `uploads/c1/`
(names in `seed-demo.sql`), then:

```bash
psql "$DATABASE_URL" -f scripts/teaser/seed-demo.sql
```

## 2. Capture the screenshots

```bash
SHOT_DIR=./teaser-shots \
BOTTLE_PHOTO=videos/mbarete-teaser/assets/photos/market-capture.jpg \
UI_TEST_EMAIL=demo@mbarete.local UI_TEST_PASSWORD=… \
node scripts/teaser/capture.mjs
```

Drives the real golden path: login → catalog → Add Product → camera-input photo
→ AI transcription (against the mock) → save → catalog, at phone (390×844@3x)
and desktop (1440×900@2x) sizes, EN and ZH. `SKIP_MOBILE=1` reruns only the
desktop shots (a mobile rerun would register a duplicate product).

Optimized copies used by the video live in `videos/mbarete-teaser/assets/shots/`.
The phone screens the live-action cut feeds to Seedance live in
`videos/mbarete-teaser/assets/seedance-refs/` — see
`videos/mbarete-teaser/SEEDANCE-PROMPT.md`.

## 3. Render the video

```bash
cd videos/mbarete-teaser
node scripts/make-sfx.mjs        # regenerates the deterministic SFX WAVs
npx hyperframes check .          # lint + runtime + layout + motion + contrast
npx hyperframes render . -q high -o renders/mbarete-teaser.mp4
```

`npx hyperframes preview --background` opens the Studio timeline for editing.
No music bed is included (no offline generator in the render environment);
drop one under the SFX in any editor, or regenerate via HyperFrames media-use
once signed in.
