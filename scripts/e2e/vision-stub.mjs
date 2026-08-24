/**
 * A stand-in for the Moonshot vision API so the golden-path browser test can
 * exercise the real transcription pipeline — request building, JSON parsing,
 * zod validation, thumbnail cropping — without a network or an API key.
 *
 * Speaks just enough of the chat-completions dialect that src/lib/vision.ts
 * uses: POST /chat/completions answers with a fixed product reading wrapped
 * the way Moonshot wraps it. Point the app at it with
 * MOONSHOT_API_KEY=stub MOONSHOT_BASE_URL=http://localhost:<port>.
 *
 * The reading matches e2e's golden-path spec: a handbag with a factory style
 * number and a thumbnail box, so the spec can assert the code and the crop
 * came through end to end.
 */
import http from "node:http";

const PORT = Number(process.env.VISION_STUB_PORT ?? 9099);

export const STUB_READING = {
  boardText: "Quilted PU Leather Handbag\n$13.08\nMOQ 24\n24/ctn",
  supplierCode: "AA012604240",
  thumbImage: 1,
  thumbBox: { left: 250, top: 400, right: 750, bottom: 900 },
  nameEn: "Quilted PU Leather Handbag 24cm",
  nameZh: "绗缝PU皮手提包",
  descriptionEn: null,
  descriptionZh: null,
  price: 13.08,
  currency: "USD",
  moq: 24,
  qtyPerBox: 24,
  categoryId: null,
  newCategoryEn: "Bags & Luggage",
  newCategoryZh: "箱包",
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  weightKg: null,
  cbm: null,
  notes: null,
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  // Drain the body — the pipeline sends megabytes of base64 photos and a
  // response before the request finishes reads as a broken socket to fetch.
  req.on("data", () => {});
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(STUB_READING) } }],
      }),
    );
  });
});

server.listen(PORT, () => {
  console.log(`[vision-stub] listening on :${PORT}`);
});
