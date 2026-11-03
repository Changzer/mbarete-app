import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = globSync("src/**/*.test.ts").sort();

if (files.length === 0) {
  console.error("No unit tests found under src/.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
