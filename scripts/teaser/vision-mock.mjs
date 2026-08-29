// Local stand-in for the Moonshot vision API (same dialect as scripts/e2e/vision-stub.mjs)
// but returns a reading matching the terracotta vacuum bottle demo photo, with a
// configurable delay so the "Reading photos…" state is visible on camera.
import http from "node:http";

const PORT = Number(process.env.VISION_STUB_PORT ?? 8787);
const DELAY_MS = Number(process.env.VISION_STUB_DELAY_MS ?? 3800);

const READING = {
  boardText: "¥12.5\n48/box",
  supplierCode: "HT-500A",
  thumbImage: 1,
  thumbBox: { left: 280, top: 20, right: 720, bottom: 660 },
  nameEn: "Vacuum Insulated Bottle 500ml",
  nameZh: "保温水杯 500ml",
  descriptionEn: "Double-wall stainless steel, powder-coated terracotta finish, loop-handle lid.",
  descriptionZh: "双层不锈钢，陶土色粉末喷涂，提环杯盖。",
  price: 12.5,
  currency: "CNY",
  moq: 48,
  qtyPerBox: 48,
  categoryId: 7,
  newCategoryEn: null,
  newCategoryZh: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  weightKg: null,
  cbm: null,
  notes: "Price read from handwritten board; 48 pcs per carton.",
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
