import assert from "node:assert/strict";
import test from "node:test";

import { createWecomResponseUrlSender } from "../src/wecom/outbound-response-url.js";

function createSender(overrides = {}) {
  const calls = [];
  const sender = createWecomResponseUrlSender({
    attachWecomProxyDispatcher: (_url, options) => options,
    parseWecomResponseUrlResult: () => ({ accepted: true, errcode: 0 }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        status: 200,
        text: async () => '{"errcode":0}',
      };
    },
    ...overrides,
  });
  return { sender, calls };
}

test("sendWecomBotPayloadViaResponseUrl validates required args", async () => {
  const { sender } = createSender();
  await assert.rejects(
    () => sender({ responseUrl: "", payload: { ok: true } }),
    /missing response_url/,
  );
  await assert.rejects(
    () => sender({ responseUrl: "https://example.com/callback", payload: null }),
    /missing response payload/,
  );
});

test("sendWecomBotPayloadViaResponseUrl posts payload and returns status", async () => {
  const { sender, calls } = createSender();
  const result = await sender({
    responseUrl: "https://example.com/callback",
    payload: { msgtype: "text", text: { content: "hello" } },
    timeoutMs: 5000,
  });
  assert.equal(result.status, 200);
  assert.equal(result.errcode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/callback");
  assert.equal(calls[0].options.method, "POST");
});

test("sendWecomBotPayloadViaResponseUrl throws when parser marks rejection", async () => {
  const { sender } = createSender({
    parseWecomResponseUrlResult: () => ({
      accepted: false,
      errcode: 40002,
      errmsg: "invalid request",
    }),
  });
  await assert.rejects(
    () =>
      sender({
        responseUrl: "https://example.com/callback",
        payload: { msgtype: "text", text: { content: "hello" } },
      }),
    /response_url rejected/,
  );
});
