import assert from "node:assert/strict";
import test from "node:test";

import { normalizePluginHttpPath } from "../src/wecom/http-path.js";

test("normalizePluginHttpPath normalizes slash/query/hash", () => {
  assert.equal(normalizePluginHttpPath("wecom/callback?x=1#p"), "/wecom/callback");
  assert.equal(normalizePluginHttpPath("//wecom//callback//"), "/wecom/callback");
});

test("normalizePluginHttpPath falls back when path is empty", () => {
  assert.equal(normalizePluginHttpPath("", "/wecom/callback/"), "/wecom/callback");
  assert.equal(normalizePluginHttpPath("", ""), "/");
});
