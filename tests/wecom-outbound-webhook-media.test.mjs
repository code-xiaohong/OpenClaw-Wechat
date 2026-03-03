import assert from "node:assert/strict";
import test from "node:test";

import { createWecomWebhookBotMediaSender } from "../src/wecom/outbound-webhook-media.js";

function createSender(overrides = {}) {
  const imageCalls = [];
  const fileCalls = [];
  const base = {
    resolveWebhookBotSendUrl: ({ url }) => url || "",
    resolveWecomOutboundMediaTarget: ({ mediaUrl }) => {
      if (String(mediaUrl).endsWith(".png")) return { type: "image", filename: "a.png" };
      return { type: "file", filename: "b.bin" };
    },
    fetchMediaFromUrl: async () => ({ buffer: Buffer.from("test-buffer") }),
    webhookSendImage: async (payload) => imageCalls.push(payload),
    webhookSendFileBuffer: async (payload) => fileCalls.push(payload),
    attachWecomProxyDispatcher: (_url, options) => options,
  };
  const sender = createWecomWebhookBotMediaSender({
    ...base,
    ...overrides,
  });
  return {
    sender,
    imageCalls,
    fileCalls,
  };
}

test("sendWebhookBotMediaBatch returns url-missing when webhook url is absent", async () => {
  const { sender } = createSender({
    resolveWebhookBotSendUrl: () => "",
  });
  const result = await sender({
    api: { logger: { warn() {} } },
    webhookBotPolicy: {},
    proxyUrl: "",
    mediaUrls: ["https://example.com/a.png"],
    mediaType: "",
  });
  assert.deepEqual(result, {
    sentCount: 0,
    failedCount: 1,
    failedUrls: ["https://example.com/a.png"],
    reason: "webhook-bot-url-missing",
  });
});

test("sendWebhookBotMediaBatch sends image and file payloads", async () => {
  const { sender, imageCalls, fileCalls } = createSender();
  const result = await sender({
    api: { logger: { warn() {} } },
    webhookBotPolicy: {
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      key: "",
      timeoutMs: 8000,
    },
    proxyUrl: "",
    mediaUrls: ["https://example.com/a.png", "https://example.com/b.txt"],
    mediaType: "",
  });
  assert.equal(result.sentCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(result.reason, "ok");
  assert.equal(imageCalls.length, 1);
  assert.equal(fileCalls.length, 1);
});

test("sendWebhookBotMediaBatch tracks failed urls when send throws", async () => {
  const warns = [];
  const { sender } = createSender({
    webhookSendImage: async () => {
      throw new Error("upload failed");
    },
  });
  const result = await sender({
    api: { logger: { warn: (line) => warns.push(String(line)) } },
    webhookBotPolicy: {
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      key: "",
      timeoutMs: 8000,
    },
    proxyUrl: "",
    mediaUrls: ["https://example.com/a.png"],
    mediaType: "",
  });
  assert.equal(result.sentCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.reason, "webhook-bot-media-failed");
  assert.equal(warns.length, 1);
  assert.match(warns[0], /webhook media send failed/);
});
