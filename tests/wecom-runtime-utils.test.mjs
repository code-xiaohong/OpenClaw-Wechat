import assert from "node:assert/strict";
import test from "node:test";

import {
  asNumber,
  buildWecomBotSessionId,
  createDeliveryTraceId,
  isAgentFailureText,
  isDispatchTimeoutError,
  requireEnv,
  withTimeout,
} from "../src/wecom/runtime-utils.js";

test("buildWecomBotSessionId normalizes sender id", () => {
  assert.equal(buildWecomBotSessionId(" Alice "), "wecom-bot:alice");
});

test("requireEnv reads env value and supports fallback", () => {
  const env = { A: "1", B: "" };
  assert.equal(requireEnv("A", "x", env), "1");
  assert.equal(requireEnv("B", "x", env), "x");
  assert.equal(requireEnv("C", "x", env), "x");
});

test("asNumber parses numeric values", () => {
  assert.equal(asNumber("10", 0), 10);
  assert.equal(asNumber("bad", 3), 3);
});

test("withTimeout rejects and timeout errors can be identified", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, "dispatch timed out after 10ms"),
    (error) => {
      assert.equal(isDispatchTimeoutError(error), true);
      return true;
    },
  );
});

test("isAgentFailureText detects transport failures", () => {
  assert.equal(isAgentFailureText("Request was aborted"), true);
  assert.equal(isAgentFailureText("fetch failed: connection reset"), true);
  assert.equal(isAgentFailureText("normal answer"), false);
});

test("createDeliveryTraceId returns prefixed trace id", () => {
  assert.match(createDeliveryTraceId("test"), /^test-/);
});
