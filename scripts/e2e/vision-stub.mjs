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

/** The card lying beside the handbag: what "identify supplier" reads. */
export const STUB_CARD = {
  companyNameEn: "Yiwu Golden Bag Co., Ltd.",
  companyNameZh: "义乌金袋皮具有限公司",
  taxId: null,
  contactPerson: "陈瑶 (Chen Yao)",
  phone: "13800001234",
  email: null,
  whatsapp: null,
  wechat: null,
  boothLocation: "No.4642, Street 9, Area C, 2/F, District 1 (义乌国际商贸城一区2楼C区9街4642店)",
  bankInfo: null,
  notes: "WeChat QR on card back",
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  // Buffer the body — the pipeline sends megabytes of base64 photos and a
  // response before the request finishes reads as a broken socket to fetch.
  // Only the user text is looked at: a business-card request (the contact
  // form, a contact capture, "identify supplier from a photo") gets the
  // card reading, everything else the product one.
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    const reading = text.includes("business card") ? STUB_CARD : STUB_READING;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reading) } }],
        // Fixed pretend bill so usage accounting is exercised end to end.
        usage: { prompt_tokens: 2400, completion_tokens: 350 },
      }),
    );
  });
});

server.listen(PORT, () => {
  console.log(`[vision-stub] listening on :${PORT}`);
});
