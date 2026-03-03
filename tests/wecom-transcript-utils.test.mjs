import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDeliveredTranscriptReplyTracker,
  extractAssistantTextFromTranscriptMessage,
  parseLateAssistantReplyFromTranscriptLine,
  readTranscriptAppendedChunk,
  resolveSessionTranscriptFilePath,
} from "../src/wecom/transcript-utils.js";

test("extractAssistantTextFromTranscriptMessage keeps assistant text blocks", () => {
  const text = extractAssistantTextFromTranscriptMessage({
    role: "assistant",
    content: [{ type: "text", text: "hello" }, { type: "image", text: "ignored" }],
  });
  assert.equal(text, "hello");
});

test("createDeliveredTranscriptReplyTracker dedupes delivered message ids", () => {
  const tracker = createDeliveredTranscriptReplyTracker({ ttlMs: 1000 });
  assert.equal(tracker.hasTranscriptReplyBeenDelivered("s1", "m1"), false);
  tracker.markTranscriptReplyDelivered("s1", "m1");
  assert.equal(tracker.hasTranscriptReplyBeenDelivered("s1", "m1"), true);
});

test("parseLateAssistantReplyFromTranscriptLine parses message entry", () => {
  const line = JSON.stringify({
    type: "message",
    id: "msg-1",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final reply" }],
      timestamp: Date.now(),
    },
  });
  const parsed = parseLateAssistantReplyFromTranscriptLine(line, 0);
  assert.equal(parsed?.transcriptMessageId, "msg-1");
  assert.equal(parsed?.text, "final reply");
});

test("resolveSessionTranscriptFilePath reads sessionFile from store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-wechat-transcript-"));
  const storePath = join(dir, "store.json");
  await writeFile(
    storePath,
    JSON.stringify({
      "agent:main:wecom:user": { sessionId: "agent:main:wecom:user", sessionFile: "sessions/u1.jsonl" },
    }),
    "utf8",
  );

  const path = await resolveSessionTranscriptFilePath({
    storePath,
    sessionKey: "agent:main:wecom:user",
    sessionId: "agent:main:wecom:user",
    logger: { warn() {} },
  });
  assert.equal(path, join(dir, "sessions/u1.jsonl"));
});

test("readTranscriptAppendedChunk reads from offset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-wechat-transcript-chunk-"));
  const filePath = join(dir, "test.jsonl");
  await writeFile(filePath, "line1\nline2\n", "utf8");
  const first = await readTranscriptAppendedChunk(filePath, 0);
  assert.match(first.chunk, /line1/);
  const second = await readTranscriptAppendedChunk(filePath, first.nextOffset);
  assert.equal(second.chunk, "");
});
