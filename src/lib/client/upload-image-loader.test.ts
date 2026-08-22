import assert from "node:assert/strict";
import test from "node:test";
import { authenticatedUploadLoader } from "@/lib/client/upload-image-loader";

test("authenticated upload images request the protected resizing route directly", () => {
  assert.equal(
    authenticatedUploadLoader({ src: "/uploads/c7/photo.jpg", width: 384, quality: 75 }),
    "/uploads/c7/photo.jpg?w=384",
  );
});
