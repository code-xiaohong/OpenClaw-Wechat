import assert from "node:assert/strict";
import test from "node:test";

import { createWecomOutboundSender } from "../src/wecom/outbound-sender.js";

function createBaseDeps(overrides = {}) {
  return {
    resolveWecomWebhookTargetConfig: () => ({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send", key: "k1" }),
    resolveWebhookBotSendUrl: ({ url, key }) => `${url}?key=${key}`,
    attachWecomProxyDispatcher: () => ({ dispatcher: { id: "d1" } }),
    splitWecomText: (text) => [String(text ?? "")],
    webhookSendText: async () => {},
    webhookSendImage: async () => {},
    webhookSendFileBuffer: async () => {},
    fetchImpl: async () => ({ ok: true }),
    sleep: async () => {},
    normalizeOutboundMediaUrls: ({ mediaUrl, mediaUrls } = {}) => [
      ...new Set([mediaUrl, ...(Array.isArray(mediaUrls) ? mediaUrls : [])].filter(Boolean)),
    ],
    resolveWecomOutboundMediaTarget: () => ({ type: "file", filename: "a.txt" }),
    fetchMediaFromUrl: async () => ({ buffer: Buffer.from("hello") }),
    buildTinyFileFallbackText: ({ fileName }) => `[tiny:${fileName}]`,
    sendWecomText: async () => {},
    uploadWecomMedia: async () => "media-1",
    sendWecomImage: async () => {},
    sendWecomVideo: async () => {},
    sendWecomVoice: async () => {},
    sendWecomFile: async () => {},
    createHash: (_algo, input) => Buffer.from(input).toString("hex").slice(0, 8),
    minFileSize: 5,
    ...overrides,
  };
}

test("sendWecomWebhookText splits content into chunks", async () => {
  const chunksSent = [];
  const sender = createWecomOutboundSender(
    createBaseDeps({
      splitWecomText: () => ["c1", "c2"],
      webhookSendText: async (payload) => {
        chunksSent.push(payload.content);
      },
    }),
  );

  await sender.sendWecomWebhookText({
    webhook: "main",
    webhookTargets: {},
    text: "any",
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.deepEqual(chunksSent, ["c1", "c2"]);
});

test("sendWecomOutboundMediaBatch falls back to text for tiny file", async () => {
  const sentText = [];
  let uploaded = 0;

  const sender = createWecomOutboundSender(
    createBaseDeps({
      resolveWecomOutboundMediaTarget: () => ({ type: "file", filename: "tiny.txt" }),
      fetchMediaFromUrl: async () => ({ buffer: Buffer.from("abc") }),
      sendWecomText: async ({ text }) => {
        sentText.push(text);
      },
      uploadWecomMedia: async () => {
        uploaded += 1;
        return "media-1";
      },
    }),
  );

  const result = await sender.sendWecomOutboundMediaBatch({
    corpId: "ww1",
    corpSecret: "s",
    agentId: "1000002",
    toUser: "alice",
    mediaUrls: ["https://example.com/a.txt"],
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.sentCount, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(uploaded, 0);
  assert.equal(sentText.length, 1);
  assert.match(sentText[0], /tiny/);
});
