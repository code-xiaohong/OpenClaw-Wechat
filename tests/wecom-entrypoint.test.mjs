import assert from "node:assert/strict";
import test from "node:test";

import register, { __internal } from "../src/index.js";

test("entrypoint exports register function and internal helpers", () => {
  assert.equal(typeof register, "function");
  assert.equal(typeof __internal, "object");
  assert.equal(typeof __internal.buildWecomSessionId, "function");
});
