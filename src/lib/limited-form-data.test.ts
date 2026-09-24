import assert from "node:assert/strict";
import { test } from "node:test";
import { limitedFormData, UploadBodyTooLargeError } from "./limited-form-data";

async function multipart(declared?: string) {
  const form = new FormData();
  form.set("kind", "packing_list");
  form.set("file", new File([new Uint8Array(1024)], "scan.pdf", { type: "application/pdf" }));
  const source = new Request("http://localhost/upload", { method: "POST", body: form });
  const bytes = new Uint8Array(await source.arrayBuffer());
  let offset = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 64));
      offset += 64;
    },
    cancel() { cancelled = true; },
  });
  const headers = new Headers(source.headers);
  if (declared !== undefined) headers.set("content-length", declared);
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, headers, duplex: "half" };
  return { request: new Request(source.url, init), length: bytes.length, cancelled: () => cancelled };
}

test("multipart without Content-Length accepts the exact body boundary and preserves metadata", async () => {
  const { request, length } = await multipart();
  const form = await limitedFormData(request, length);
  assert.equal(form.get("kind"), "packing_list");
  const file = form.get("file") as File;
  assert.equal(file.size, 1024);
  assert.equal(file.name, "scan.pdf");
});

test("chunked or understated bodies stop at the byte cap and cancel the source", async () => {
  for (const declared of [undefined, "1"]) {
    const input = await multipart(declared);
    await assert.rejects(limitedFormData(input.request, 400), UploadBodyTooLargeError);
    // Cancellation propagates through pipeThrough asynchronously.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(input.cancelled(), true);
  }
});

test("declared oversized requests are rejected before consuming their body", async () => {
  const { request } = await multipart("2000");
  await assert.rejects(limitedFormData(request, 1500), UploadBodyTooLargeError);
  assert.equal(request.bodyUsed, false);
});

test("malformed multipart and invalid length are ordinary validation errors", async () => {
  const { request } = await multipart("not-a-number");
  await assert.rejects(limitedFormData(request, 4096), TypeError);
  await assert.rejects(limitedFormData(new Request("http://localhost", {
    method: "POST", body: "incomplete", headers: { "content-type": "multipart/form-data; boundary=absent" },
  }), 4096), (error: unknown) => error instanceof Error && !(error instanceof UploadBodyTooLargeError));
});
