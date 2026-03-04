import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("package.json declares openclaw install metadata", () => {
  const packagePath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(pkg?.openclaw?.install?.defaultChoice, "npm");
  assert.equal(pkg?.openclaw?.install?.npmSpec, "@dingxiang-me/openclaw-wechat");
});
