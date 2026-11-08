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
  hsCode: "42022200",
  cnHsCode: "4202220000",
  declarationElements: "手提包，无品牌，聚氨酯，日常携带物品用，型号无",
  importDutyBrPct: 20,
  importDutyPyPct: 16,
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

let extractedDocument = "";

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    if (req.method === "POST" && req.url === "/v1/files?beta=true") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "anthropic-stub-file",
        created_at: "2026-01-01T00:00:00Z",
        filename: "document.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        type: "file",
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/messages") {
      const reading = { kind: "customs_declaration", fapiaoType: null, confidence: "high", reason: "Customs declaration" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "msg-stub",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: JSON.stringify(reading) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
      }));
      return;
    }
    if (req.method === "DELETE" && req.url === "/v1/files/anthropic-stub-file?beta=true") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "anthropic-stub-file", type: "file_deleted" }));
      return;
    }
    if (req.method === "POST" && req.url === "/files") {
      const name = /filename="([^"]+)"/.exec(text)?.[1] ?? "";
      extractedDocument = name.includes("customs")
        ? "中华人民共和国海关出口货物报关单\nCUSTOMS DECLARATION"
        : name.includes("invoice")
          ? "增值税专用发票\n税率 3%\nVAT SPECIAL INVOICE"
          : "An unrelated note with no export document structure";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "dossier-stub-file" }));
      return;
    }
    if (req.method === "GET" && req.url === "/files/dossier-stub-file/content") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(extractedDocument);
      return;
    }
    if (req.method === "DELETE" && req.url === "/files/dossier-stub-file") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    // Buffering above lets megabytes of base64 photos arrive before the answer.
    // A dossier request classifies the extracted text; the older product/card
    // paths keep their original fixed readings.
    const body = JSON.parse(text);
    const system = body.messages?.[0]?.content ?? "";
    const documentText = body.messages?.[1]?.content ?? "";
    const reading = system.includes("fixed export-dossier catalog")
      ? documentText.includes("出口货物报关单")
        ? { kind: "customs_declaration", fapiaoType: null, confidence: "high", reason: "Customs declaration title and fields" }
        : documentText.includes("增值税专用发票")
          ? { kind: "supplier_invoice", fapiaoType: "special_3", confidence: "high", reason: "3% VAT special invoice" }
          : { kind: null, fapiaoType: null, confidence: "low", reason: "No recognizable dossier structure" }
      : text.includes("business card") ? STUB_CARD : STUB_READING;
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
