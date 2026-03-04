import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("openclaw.plugin.json allows bot-only accounts (no required agent creds)", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const accountSchema = manifest?.configSchema?.properties?.accounts?.additionalProperties;
  assert.ok(accountSchema && typeof accountSchema === "object");
  assert.equal(Array.isArray(accountSchema.required), false);
});
