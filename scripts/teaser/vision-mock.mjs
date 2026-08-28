// Local stand-in for the Moonshot vision API (same dialect as scripts/e2e/vision-stub.mjs)
// but returns a reading matching the terracotta vacuum bottle demo photo, with a
// configurable delay so the "Reading photos…" state is visible on camera.
import http from "node:http";

const PORT = Number(process.env.VISION_STUB_PORT ?? 8787);
const DELAY_MS = Number(process.env.VISION_STUB_DELAY_MS ?? 3800);

const READING = {
  boardText: "¥4.14\n288/box",
  supplierCode: "NO.1018",
  thumbImage: 1,
  thumbBox: { left: 290, top: 20, right: 680, bottom: 450 },
  nameEn: "Aurora Glitter Highlighter 6-Color Set",
  nameZh: "极光贝母幻彩荧光笔6色装",
  descriptionEn: "\"Dark Starlight\" pastel glitter highlighters, 6 shining colors per box.",
  descriptionZh: "墨夜星芒系列幻彩荧光笔，一盒6色。",
  price: 4.14,
  currency: "CNY",
  moq: 288,
  qtyPerBox: 288,
  categoryId: 2,
  newCategoryEn: null,
  newCategoryZh: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  weightKg: null,
  cbm: null,
  notes: "Price read from handwritten board; 288 pcs per carton.",
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  req.on("data", () => {});
  req.on("end", () => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(READING) } }],
          usage: { prompt_tokens: 2400, completion_tokens: 350 },
        }),
      );
    }, DELAY_MS);
  });
});

server.listen(PORT, () => {
  console.log(`[vision-mock] listening on :${PORT}, delay ${DELAY_MS}ms`);
});
