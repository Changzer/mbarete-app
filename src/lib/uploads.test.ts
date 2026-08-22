import assert from "node:assert/strict";
import test from "node:test";
import { requiresUploadAuth } from "@/lib/uploads";

test("every tenant-owned upload requires authentication", () => {
  assert.equal(requiresUploadAuth("c12/photo.jpg"), true);
  assert.equal(requiresUploadAuth("c12/card-photo.webp"), true);
});

test("legacy documents remain protected while legacy product photos remain readable", () => {
  assert.equal(requiresUploadAuth("doc-old.jpg"), true);
  assert.equal(requiresUploadAuth("old-invoice.pdf"), true);
  assert.equal(requiresUploadAuth("legacy-product.jpg"), false);
});
