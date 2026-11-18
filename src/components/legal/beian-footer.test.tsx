import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeianFooter } from "./beian-footer";

const names = ["DEPLOY_REGION", "ICP_BEIAN", "GONGAN_BEIAN"] as const;
const previous = names.map((name) => [name, process.env[name]] as const);

function reset() {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("mainland renders the approved ICP filing by default", () => {
  delete process.env.ICP_BEIAN;
  delete process.env.GONGAN_BEIAN;
  process.env.DEPLOY_REGION = "cn";
  const html = renderToStaticMarkup(createElement(BeianFooter));
  assert.match(html, /浙ICP备2026100480号/);
  assert.match(html, /beian\.miit\.gov\.cn/);
  reset();
});

test("non-mainland stays empty and an explicit filing overrides the default", () => {
  delete process.env.DEPLOY_REGION;
  delete process.env.ICP_BEIAN;
  delete process.env.GONGAN_BEIAN;
  assert.equal(renderToStaticMarkup(createElement(BeianFooter)), "");
  process.env.DEPLOY_REGION = "cn";
  process.env.ICP_BEIAN = "浙ICP备test号";
  const html = renderToStaticMarkup(createElement(BeianFooter));
  assert.match(html, /浙ICP备test号/);
  assert.doesNotMatch(html, /2026100480/);
  reset();
});
