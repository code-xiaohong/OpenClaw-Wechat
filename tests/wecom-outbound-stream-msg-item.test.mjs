import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveStreamMsgItems } from "../src/wecom/outbound-stream-msg-item.js";

test("buildActiveStreamMsgItems builds image msg_item and keeps non-image as fallback urls", async () => {
  const calls = [];
  const result = await buildActiveStreamMsgItems({
    mediaUrls: ["https://example.com/a.png", "https://example.com/b.mp4"],
    mediaType: "",
    fetchMediaFromUrl: async (url) => {
      calls.push(url);
      return {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      };
    },
    proxyUrl: "",
    logger: null,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://example.com/a.png");
  assert.equal(result.msgItem.length, 1);
  assert.equal(result.msgItem[0]?.msgtype, "image");
  assert.deepEqual(result.fallbackUrls, ["https://example.com/b.mp4"]);
});

test("buildActiveStreamMsgItems falls back when image format is unsupported", async () => {
  const result = await buildActiveStreamMsgItems({
    mediaUrls: ["https://example.com/a.png"],
    mediaType: "",
    fetchMediaFromUrl: async () => ({
      buffer: Buffer.from("not-image"),
    }),
    proxyUrl: "",
    logger: null,
  });

  assert.equal(result.msgItem.length, 0);
  assert.deepEqual(result.fallbackUrls, ["https://example.com/a.png"]);
});
