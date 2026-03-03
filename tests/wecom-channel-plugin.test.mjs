import assert from "node:assert/strict";
import test from "node:test";

import { createWecomChannelPlugin } from "../src/wecom/channel-plugin.js";

function createPluginHarness(overrides = {}) {
  const calls = {
    sendText: [],
    webhookText: [],
    webhookMedia: [],
    outboundMedia: [],
  };
  const logger = { info() {}, warn() {}, error() {} };
  const directConfig = {
    corpId: "ww1",
    corpSecret: "sec",
    agentId: "1001",
    outboundProxy: "",
    webhooks: { ops: { url: "https://example.com", key: "k1" } },
  };
  const runtime = { config: { channels: { wecom: {} } }, logger };

  const plugin = createWecomChannelPlugin({
    listWecomAccountIds: () => ["default"],
    getWecomConfig: () => directConfig,
    getGatewayRuntime: () => runtime,
    normalizeWecomResolvedTarget: (to) => {
      if (to === "webhook") return { webhook: "ops" };
      if (to === "direct") return { toUser: "alice" };
      return null;
    },
    formatWecomTargetForLog: (target) => JSON.stringify(target),
    sendWecomWebhookText: async (payload) => {
      calls.webhookText.push(payload);
    },
    sendWecomWebhookMediaBatch: async (payload) => {
      calls.webhookMedia.push(payload);
      return { total: 1, sentCount: 1, failed: [] };
    },
    sendWecomOutboundMediaBatch: async (payload) => {
      calls.outboundMedia.push(payload);
      return { total: 1, sentCount: 1, failed: [] };
    },
    sendWecomText: async (payload) => {
      calls.sendText.push(payload);
    },
    ...overrides,
  });

  return { plugin, calls };
}

test("channel plugin outbound.sendText supports webhook target", async () => {
  const { plugin, calls } = createPluginHarness();
  const result = await plugin.outbound.sendText({ to: "webhook", text: "hello" });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "wecom-webhook");
  assert.equal(calls.webhookText.length, 1);
  assert.equal(calls.sendText.length, 0);
});

test("channel plugin inbound.deliverReply sends media + text for direct target", async () => {
  const { plugin, calls } = createPluginHarness();
  const result = await plugin.inbound.deliverReply({
    to: "direct",
    text: "done",
    mediaUrl: "https://example.com/a.png",
    mediaType: "image",
  });
  assert.equal(result.ok, true);
  assert.equal(calls.outboundMedia.length, 1);
  assert.equal(calls.sendText.length, 1);
});

test("channel plugin resolveTarget validates target", () => {
  const { plugin } = createPluginHarness();
  const fail = plugin.outbound.resolveTarget({ to: "" });
  assert.equal(fail.ok, false);
});
