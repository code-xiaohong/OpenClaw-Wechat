import assert from "node:assert/strict";
import test from "node:test";

import { createWecomAgentMediaSender } from "../src/wecom/outbound-agent-media-sender.js";

function createDeps(overrides = {}) {
  return {
    normalizeOutboundMediaUrls: ({ mediaUrl, mediaUrls } = {}) => [
      ...new Set([mediaUrl, ...(Array.isArray(mediaUrls) ? mediaUrls : [])].filter(Boolean)),
    ],
    resolveWecomOutboundMediaTarget: () => ({ type: "voice", filename: "a.amr" }),
    fetchMediaFromUrl: async () => ({ buffer: Buffer.from("voice") }),
    buildTinyFileFallbackText: ({ fileName }) => `[tiny:${fileName}]`,
    sendWecomText: async () => {},
    uploadWecomMedia: async () => "media-1",
    sendWecomImage: async () => {},
    sendWecomVideo: async () => {},
    sendWecomVoice: async () => {},
    sendWecomFile: async () => {},
    minFileSize: 5,
    ...overrides,
  };
}

test("sendWecomOutboundMediaBatch routes voice target to sendWecomVoice", async () => {
  const voiceMediaIds = [];
  const uploadTypes = [];
  const sender = createWecomAgentMediaSender(
    createDeps({
      uploadWecomMedia: async ({ type }) => {
        uploadTypes.push(type);
        return "media-voice";
      },
      sendWecomVoice: async ({ mediaId }) => {
        voiceMediaIds.push(mediaId);
      },
    }),
  );

  const result = await sender.sendWecomOutboundMediaBatch({
    corpId: "ww1",
    corpSecret: "s",
    agentId: "1000002",
    toUser: "alice",
    mediaUrls: ["https://example.com/a.amr"],
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(result.total, 1);
  assert.equal(result.sentCount, 1);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(uploadTypes, ["voice"]);
  assert.deepEqual(voiceMediaIds, ["media-voice"]);
});
