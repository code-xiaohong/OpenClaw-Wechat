import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";

import {
  createWecomMediaFetcher,
  detectImageContentTypeFromBuffer,
  normalizeOutboundMediaUrls,
  pickImageFileExtension,
  resolveLocalMediaPath,
  resolveWecomOutboundMediaTarget,
} from "../src/wecom/media-url-utils.js";

test("resolveLocalMediaPath handles file/sandbox/absolute paths", () => {
  assert.equal(resolveLocalMediaPath("file:///tmp/a%20b.png"), "/tmp/a b.png");
  assert.equal(resolveLocalMediaPath("sandbox:/tmp/demo.txt"), "/tmp/demo.txt");
  assert.equal(resolveLocalMediaPath("/tmp/hello.png?x=1"), "/tmp/hello.png");
  assert.equal(resolveLocalMediaPath("https://example.com/a.png"), "");
});

test("normalizeOutboundMediaUrls dedupes and trims", () => {
  const urls = normalizeOutboundMediaUrls({
    mediaUrl: " https://example.com/a.png ",
    mediaUrls: ["https://example.com/a.png", "", "https://example.com/b.png"],
  });
  assert.deepEqual(urls, ["https://example.com/a.png", "https://example.com/b.png"]);
});

test("resolveWecomOutboundMediaTarget infers by extension/type", () => {
  assert.deepEqual(resolveWecomOutboundMediaTarget({ mediaUrl: "https://x/a.png" }), {
    type: "image",
    filename: "a.png",
  });
  assert.deepEqual(resolveWecomOutboundMediaTarget({ mediaUrl: "https://x/a.heic" }), {
    type: "image",
    filename: "a.heic",
  });
  assert.deepEqual(resolveWecomOutboundMediaTarget({ mediaUrl: "https://x/a.mkv" }), {
    type: "video",
    filename: "a.mkv",
  });
  assert.deepEqual(resolveWecomOutboundMediaTarget({ mediaUrl: "https://x/a.unknown", mediaType: "voice" }), {
    type: "voice",
    filename: "a.unknown",
  });
});

test("detectImageContentTypeFromBuffer and pickImageFileExtension work", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageContentTypeFromBuffer(png), "image/png");
  assert.equal(pickImageFileExtension({ contentType: "image/png", sourceUrl: "" }), ".png");
  assert.equal(pickImageFileExtension({ contentType: "", sourceUrl: "https://x/a.webp?x=1" }), ".webp");
});

test("createWecomMediaFetcher reads local media path", async () => {
  const fixturePath = join(tmpdir(), `openclaw-wechat-media-${Date.now()}.txt`);
  await writeFile(fixturePath, "hello");
  const { fetchMediaFromUrl } = createWecomMediaFetcher({
    fetchWithRetry: async () => {
      throw new Error("should not call network for local paths");
    },
    buildMediaFetchErrorMessage: () => "fetch error",
    pluginVersion: "test",
  });

  try {
    const result = await fetchMediaFromUrl(fixturePath, { maxBytes: 1024 });
    assert.equal(result.source, "local");
    assert.equal(result.contentType, "text/plain; charset=utf-8");
    assert.equal(result.buffer.toString("utf8"), "hello");
  } finally {
    await unlink(fixturePath).catch(() => {});
  }
});
