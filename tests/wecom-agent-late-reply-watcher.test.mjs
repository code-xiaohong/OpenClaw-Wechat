import assert from "node:assert/strict";
import test from "node:test";

import { createWecomLateReplyWatcher } from "../src/wecom/agent-late-reply-watcher.js";

test("createWecomLateReplyWatcher delivers transcript reply and clears watcher entry", async () => {
  const delivered = [];
  const failures = [];
  const marked = [];
  const watchers = new Map();
  let hasDelivered = false;

  const runWatcher = createWecomLateReplyWatcher({
    resolveSessionTranscriptFilePath: async () => "/tmp/transcript",
    readTranscriptAppendedChunk: async (_path, offset) => {
      if (offset === 0) {
        return {
          nextOffset: 10,
          chunk: "line-1\n",
        };
      }
      return {
        nextOffset: offset,
        chunk: "",
      };
    },
    parseLateAssistantReplyFromTranscriptLine: (line) => {
      if (line === "line-1") {
        return {
          text: "hello",
          transcriptMessageId: "msg-1",
        };
      }
      return null;
    },
    hasTranscriptReplyBeenDelivered: () => false,
    markTranscriptReplyDelivered: (_sessionId, transcriptMessageId) => {
      marked.push(transcriptMessageId);
    },
    sleep: async () => {},
    markdownToWecomText: (text) => `fmt:${text}`,
    now: () => 1000,
    statImpl: async () => ({ size: 0 }),
  });

  await runWatcher({
    watchId: "watch-1",
    reason: "test",
    sessionId: "session-1",
    sessionTranscriptId: "session-1",
    accountId: "default",
    storePath: "/tmp/store",
    logger: { info() {}, warn() {} },
    watchStartedAt: 1000,
    watchMs: 2000,
    pollMs: 0,
    activeWatchers: watchers,
    isDelivered: () => hasDelivered,
    markDelivered: () => {
      hasDelivered = true;
    },
    sendText: async (text) => {
      delivered.push(text);
    },
    onFailureFallback: async (err) => {
      failures.push(String(err));
    },
  });

  assert.deepEqual(delivered, ["fmt:hello"]);
  assert.deepEqual(marked, ["msg-1"]);
  assert.equal(hasDelivered, true);
  assert.equal(failures.length, 0);
  assert.equal(watchers.size, 0);
});

test("createWecomLateReplyWatcher triggers timeout fallback", async () => {
  const failures = [];
  const watchers = new Map();
  let nowTick = 0;
  let hasDelivered = false;

  const runWatcher = createWecomLateReplyWatcher({
    resolveSessionTranscriptFilePath: async () => "/tmp/transcript",
    readTranscriptAppendedChunk: async (_path, offset) => ({
      nextOffset: offset,
      chunk: "",
    }),
    parseLateAssistantReplyFromTranscriptLine: () => null,
    hasTranscriptReplyBeenDelivered: () => false,
    markTranscriptReplyDelivered: () => {},
    sleep: async () => {},
    markdownToWecomText: (text) => text,
    now: () => {
      nowTick += 100;
      return nowTick;
    },
    statImpl: async () => ({ size: 0 }),
  });

  await runWatcher({
    watchId: "watch-2",
    reason: "timeout",
    sessionId: "session-2",
    sessionTranscriptId: "session-2",
    accountId: "default",
    storePath: "/tmp/store",
    logger: { info() {}, warn() {} },
    watchStartedAt: 0,
    watchMs: 300,
    pollMs: 0,
    activeWatchers: watchers,
    isDelivered: () => hasDelivered,
    markDelivered: () => {
      hasDelivered = true;
    },
    sendText: async () => {},
    onFailureFallback: async (err) => {
      failures.push(String(err));
    },
  });

  assert.equal(hasDelivered, false);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /timed out after 300ms/);
  assert.equal(watchers.size, 0);
});

test("createWecomLateReplyWatcher handles resolveSessionTranscriptFilePath error", async () => {
  const failures = [];
  const runWatcher = createWecomLateReplyWatcher({
    resolveSessionTranscriptFilePath: async () => {
      throw new Error("missing transcript");
    },
    readTranscriptAppendedChunk: async (_path, offset) => ({
      nextOffset: offset,
      chunk: "",
    }),
    parseLateAssistantReplyFromTranscriptLine: () => null,
    hasTranscriptReplyBeenDelivered: () => false,
    markTranscriptReplyDelivered: () => {},
    sleep: async () => {},
    markdownToWecomText: (text) => text,
    now: () => 1000,
    statImpl: async () => ({ size: 0 }),
  });

  await runWatcher({
    watchId: "watch-3",
    reason: "error",
    sessionId: "session-3",
    sessionTranscriptId: "session-3",
    accountId: "default",
    storePath: "/tmp/store",
    logger: { info() {}, warn() {} },
    watchStartedAt: 1000,
    watchMs: 300,
    pollMs: 0,
    activeWatchers: new Map(),
    isDelivered: () => false,
    markDelivered: () => {},
    sendText: async () => {},
    onFailureFallback: async (err) => {
      failures.push(String(err?.message || err));
    },
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /missing transcript/);
});
