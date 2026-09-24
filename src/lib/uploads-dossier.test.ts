import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileTooLargeError, saveUploadedDocument, saveUploadedDossierDocument } from "./uploads";

test("a large dossier scan streams intact while ordinary document limits remain enforced", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dossier-upload-"));
  const previous = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = dir;
  try {
    const bytes = Buffer.alloc(26 * 1024 * 1024, 42);
    const file = new File([bytes], "scan.pdf", { type: "application/pdf" });
    await assert.rejects(saveUploadedDocument(7, file), FileTooLargeError);
    // A full-file arrayBuffer would double the incoming upload's allocation.
    t.mock.method(file, "arrayBuffer", () => { throw new Error("Do not buffer the File again"); });
    const stored = await saveUploadedDossierDocument(7, file);
    assert.match(stored, /^\/uploads\/c7\/doc-[\w-]+\.pdf$/);
    assert.deepEqual(await fs.readFile(path.join(dir, stored.slice("/uploads/".length))), bytes);

    const bad = new File(["%PDF"], "broken.pdf", { type: "application/pdf" });
    t.mock.method(bad, "stream", () => new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      pull(controller) { controller.error(new Error("read interrupted")); },
    }));
    await assert.rejects(saveUploadedDossierDocument(7, bad), /read interrupted/);
    assert.equal((await fs.readdir(path.join(dir, "c7"))).length, 1, "failed writes leave no partial file");
  } finally {
    if (previous === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
