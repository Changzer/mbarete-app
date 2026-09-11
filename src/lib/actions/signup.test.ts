import assert from "node:assert/strict";
import test from "node:test";
import { signUp } from "./signup";

test("public signup stays closed with legacy SaaS settings and valid-looking input", async () => {
  const oldMode = process.env.DEPLOY_MODE;
  const oldCode = process.env.SIGNUP_CODE;
  try {
    process.env.SIGNUP_CODE = "old-invite-code";
    for (const mode of ["saas", "self-hosted"]) {
      process.env.DEPLOY_MODE = mode;
      const form = new FormData();
      for (const [key, value] of Object.entries({
        companyName: "Uninvited company", ownerName: "Test", email: "test@example.com",
        password: "test-password", confirm: "test-password", code: "old-invite-code",
        consent: "on", ref: "OLDREF",
      })) form.set(key, value);
      // Refusal needs neither a request context nor a database.
      assert.deepEqual(await signUp(undefined, form), { error: "closed" });
    }
  } finally {
    if (oldMode === undefined) delete process.env.DEPLOY_MODE;
    else process.env.DEPLOY_MODE = oldMode;
    if (oldCode === undefined) delete process.env.SIGNUP_CODE;
    else process.env.SIGNUP_CODE = oldCode;
  }
});
