---
format: 1920x1080
duration: 13.6s
message: "Leave the market with a catalog, not a camera roll."
arc: Desk → Zoom-out to the market → Capture & AI read → Catalog payoff → Lockup
audience: wholesale sourcing teams (Yiwu / Canton Fair buyers) and their clients
mode: autonomous
---

Rhythm: settle–WHIP–theater–SLAM–still. One continuous camera story: push in on
the desktop, whip-zoom OUT into the phone at the market, capture theater on the
phone, the captured card hands off into the catalog grid, dead-still brand
lockup. Cream field `#F8F4EC` persists across every scene (shared background);
vermilion `#BC3524` is the only accent. Type: Archivo (900 display) + IBM Plex
Mono (data register) + Noto Sans SC (ZH). All UI content is real screenshots.

## Frame 1 — Desk

- scene: The app running on a computer — bilingual catalog gallery breathes inside a browser frame
- duration: 3.0s
- transition_in: none
- status: outline
- src: compositions/index.html
- poster: 2s

Eyebrow line waterfalls in (small, mono): "BUILT IN YIWU · MADE FOR SOURCING
TEAMS · 义乌" — then a browser-framed desktop screenshot (d1, EN gallery) RISES
with a motion-blur streak and settles; slow camera push-in with micro-drift.
At ~2.0s the screen content crossfades EN→ZH (d2) — the one-tap bilingual wink.
Blueprint: `device-surface-showcase` (static tour, adapt).
Rules: `waterfall-entry` (eyebrow), `motion-blur-streak` (browser rise),
`multi-phase-camera` (push + drift), `sine-wave-loop` (device float).

## Frame 2 — Capture

- scene: Whip zoom-out to a phone in hand at the market: shutter, "Reading photos…", the AI fills the bilingual form
- duration: 6.6s
- transition_in: velocity-matched whip (continuous camera zoom-out, blur-through)
- status: outline
- src: compositions/index.html
- poster: 6.5s

The laptop shrinks away under a whip zoom-out (camera-travel blur carve-out) and
the frame resolves on a PHONE held over a market stall backdrop: full-bleed
viewfinder showing the real product photo (glitter highlighter box + handwritten
¥4.14 / 288-box price board), corner brackets, shutter button. Shutter PRESS →
white flash → the photo drops into the real Add Product form (m3): tile + a
"Reading photos…" shimmer. Then AI-fill THEATER: data chips spring out beside
the phone on a beat — bilingual name (EN + 极光贝母幻彩荧光笔6色装), giant mono
"¥4.14", "MOQ 288 · 288/ctn", "Board read: ¥4.14 · 288/box" — while the screen
becomes the filled form (m4) with the amber "AI-read — please verify" hint.
Save tap → tick. The captured product CARD pulls out of the phone toward
camera, trailing a streak → seam into Frame 3.
Blueprint: `prompt-type-submit-generate` (adapt: the camera is the input,
the AI answer is the filled form) + `agent-progress-theater` (working state).
Rules: `motion-blur-streak` (whip + card pull-out), `press-release-spring`
(shutter + save), `spring-pop-entrance` (chips), `ambient-glow-bloom`
(shimmer on "Reading photos…"), `card-morph-anchor` (card handoff).

## Frame 3 — Catalog payoff

- scene: The captured card lands in the catalog; the grid assembles; the headline slams in EN + ZH
- duration: 2.6s
- transition_in: card handoff morph (the flying card becomes the first grid tile)
- status: outline
- src: compositions/index.html
- poster: 1.8s

The flying card LANDS as a tile; the rest of the real catalog tiles
stagger-assemble around it in one wave (short slide into slot, no scatter).
Headline band slams in two beats over the lower third:
beat 1 "Leave the market with a catalog," · beat 2 "not a camera roll."
with the ZH line "带走的是产品目录，而不是满手机的照片。" settling under it.
Blueprint: `grid-card-assemble` (Key_Feature grid, dense-wall short-slide form).
Rules: `kinetic-beat-slam` (two-beat headline), `spring-pop-entrance` (tile
landing), `multi-phase-camera` (slow push during hold).

## Frame 4 — Lockup

- scene: Cream field; the red seal blooms; proof line; dead-still hold
- duration: 1.4s
- transition_in: blur-through (velocity-matched)
- status: outline
- src: compositions/index.html
- poster: 1.1s

Everything clears; on the cream field the Mbarete seal spring-BLOOMS from zero
(power3, whisper of rotation), a soft warm glow bloom lands with it; beneath,
the mono proof rail wipes in left→right: "OFFLINE-FIRST · ENGLISH + 中文 ·
YIWU & CANTON FAIR". Dead-static hold to the end.
Blueprint: `logo-assemble-lockup` (text-clears-mark-blooms / settled-reveal).
Rules: `spring-pop-entrance` (seal bloom), `ambient-glow-bloom` (hero bloom),
underline/tagline wipe via clip-path (blueprint's tagline wipe-in row).
