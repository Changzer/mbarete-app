import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEnquiryUploadName,
  isGatedUploadName,
  requiresUploadAuth,
  isSafeUploadName,
} from "./uploads";

/**
 * These names come from strangers with no account. The one thing that must
 * never happen is an enquiry photo taking the OPEN path in the serving route,
 * which hands a file to anyone who asks and tells them to cache it forever —
 * that would make the domain a free image host for whatever gets uploaded.
 */
const ENQUIRY = "enq-3f2a1c4e-0b7d-4a11-9c2e-5d6f7a8b9c0d.webp";

test("an enquiry photo is recognised and never on the open path", () => {
  assert.equal(isEnquiryUploadName(ENQUIRY), true);
  assert.equal(isGatedUploadName(ENQUIRY), true);
  assert.equal(requiresUploadAuth(ENQUIRY), true);
});

test("the name the saver produces survives the traversal check", () => {
  assert.equal(isSafeUploadName(ENQUIRY), true);
});

// The regression this prefix exists to prevent: a flat image name with no
// prefix is public and immutably cached. If enquiry photos were ever written
// that way the gate above would silently stop applying.
test("a flat image name really is open, which is why the prefix is needed", () => {
  const flat = "3f2a1c4e-0b7d-4a11-9c2e-5d6f7a8b9c0d.webp";
  assert.equal(requiresUploadAuth(flat), false);
  assert.equal(isEnquiryUploadName(flat), false);
});

test("the prefix does not collide with the other gated kinds", () => {
  assert.equal(isEnquiryUploadName("slip-abc.jpg"), false);
  assert.equal(isEnquiryUploadName("doc-abc.pdf"), false);
  // A company-scoped file is somebody's tenant data, not an enquiry.
  assert.equal(isEnquiryUploadName("c7/abc.jpg"), false);
});

test("traversal and odd names are still refused", () => {
  for (const bad of ["../enq-x.webp", "enq-x.exe", "enq-x", "/etc/passwd", "enq-x.webp/../y"]) {
    assert.equal(isSafeUploadName(bad), false, bad);
  }
});
