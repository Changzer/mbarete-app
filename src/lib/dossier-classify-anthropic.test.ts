import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ZipArchive } from "archiver";
import * as XLSX from "@e965/xlsx";
import { classifyDossierDocument } from "./dossier-classify";

const names = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "MOONSHOT_API_KEY",
  "MOONSHOT_BASE_URL",
  "TRANSCRIBE_PROVIDER",
] as const;

function saveEnv() {
  return names.map((name) => [name, process.env[name]] as const);
}

function restoreEnv(previous: ReturnType<typeof saveEnv>) {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function message(reading: unknown) {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: JSON.stringify(reading) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 },
  };
}

async function anthropicStub(handlers: {
  onFiles?: (body: unknown) => unknown;
  onMessages: (body: unknown) => unknown;
}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = request.headers["content-type"]?.includes("application/json") && text ? JSON.parse(text) : null;
      calls.push({ method: request.method ?? "", url: request.url ?? "", body });
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.method === "POST" && request.url?.startsWith("/v1/files")) {
        response.end(JSON.stringify(handlers.onFiles?.(body) ?? {
          id: "file-anthropic",
          created_at: "2026-01-01T00:00:00Z",
          filename: "document.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          type: "file",
        }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/messages") {
        response.end(JSON.stringify(handlers.onMessages(body)));
        return;
      }
      if (request.method === "DELETE" && request.url?.startsWith("/v1/files/file-anthropic")) {
        response.end(JSON.stringify({ id: "file-anthropic", type: "file_deleted" }));
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, calls, url: `http://127.0.0.1:${address.port}` };
}

function close(server: http.Server) {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

test("Anthropic PDF input uses a temporary remote file and deletes it", async () => {
  const previous = saveEnv();
  const { server, calls, url } = await anthropicStub({
    onMessages: () => message({ kind: "customs_declaration", fapiaoType: null, confidence: "high", reason: "Declaration" }),
  });
  process.env.ANTHROPIC_API_KEY = "test-only";
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.TRANSCRIBE_PROVIDER = "anthropic";
  delete process.env.MOONSHOT_API_KEY;
  try {
    const result = await classifyDossierDocument(new File([Buffer.from("pdf")], "customs.pdf", { type: "application/pdf" }));
    assert.equal(result.kind, "customs_declaration");
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      "POST /v1/files?beta=true",
      "POST /v1/messages",
      "DELETE /v1/files/file-anthropic?beta=true",
    ]);
    const request = calls[1].body as {
      messages: { content: { type: string; source?: { type: string; file_id: string } }[] }[];
    };
    assert.equal(request.messages[0].content[0].source?.type, "file");
    assert.equal(request.messages[0].content[0].source?.file_id, "file-anthropic");
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    restoreEnv(previous);
    await close(server);
  }
});

test("Anthropic classifies locally extracted Excel text without a remote file", async () => {
  const previous = saveEnv();
  const { server, calls, url } = await anthropicStub({
    onMessages: () => message({ kind: "packing_list", fapiaoType: null, confidence: "high", reason: "Packing list" }),
  });
  process.env.ANTHROPIC_API_KEY = "test-only";
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.TRANSCRIBE_PROVIDER = "anthropic";
  delete process.env.MOONSHOT_API_KEY;
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["PACKING LIST"], ["Cartons", 4]]), "Sheet1");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = await classifyDossierDocument(new File([bytes], "packing.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    assert.equal(result.kind, "packing_list");
    assert.deepEqual(calls.map((call) => call.url), ["/v1/messages"]);
    const request = calls[0].body as { messages: { content: { text: string }[] }[] };
    assert.match(request.messages[0].content[0].text, /PACKING LIST/);
    assert.match(request.messages[0].content[0].text, /Cartons\\t4/);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    restoreEnv(previous);
    await close(server);
  }
});

test("Anthropic classifies locally extracted DOCX text", async () => {
  const previous = saveEnv();
  const { server, calls, url } = await anthropicStub({
    onMessages: () => message({ kind: "purchase_contract", fapiaoType: null, confidence: "high", reason: "Purchase contract" }),
  });
  process.env.ANTHROPIC_API_KEY = "test-only";
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.TRANSCRIBE_PROVIDER = "anthropic";
  delete process.env.MOONSHOT_API_KEY;
  try {
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", (error: Error) => { throw error; });
    archive.append("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>", { name: "[Content_Types].xml" });
    archive.append("<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>", { name: "_rels/.rels" });
    archive.append("<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>PURCHASE CONTRACT</w:t></w:r></w:p><w:p><w:r><w:t>Supplier and buyer agreement</w:t></w:r></w:p></w:body></w:document>", { name: "word/document.xml" });
    await archive.finalize();
    const result = await classifyDossierDocument(new File([Buffer.concat(chunks)], "purchase.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    assert.equal(result.kind, "purchase_contract");
    const request = calls[0].body as { messages: { content: { text: string }[] }[] };
    assert.match(request.messages[0].content[0].text, /PURCHASE CONTRACT/);
  } finally {
    restoreEnv(previous);
    await close(server);
  }
});
