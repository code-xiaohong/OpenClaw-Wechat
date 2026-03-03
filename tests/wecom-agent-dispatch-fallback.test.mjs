import assert from "node:assert/strict";
import test from "node:test";

import { handleWecomAgentPostDispatchFallback } from "../src/wecom/agent-dispatch-fallback.js";

function createState(overrides = {}) {
  return {
    hasDeliveredReply: false,
    hasDeliveredPartialReply: false,
    blockTextFallback: "",
    streamChunkSendChain: Promise.resolve(),
    ...overrides,
  };
}

test("handleWecomAgentPostDispatchFallback delivers block fallback text", async () => {
  const sent = [];
  const watchers = [];
  const state = createState({
    blockTextFallback: "line-1\nline-2",
  });
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async (text) => sent.push(String(text)),
    markdownToWecomText: (text) => `fmt:${text}`,
    sendProgressNotice: async () => {},
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: false },
  });

  assert.deepEqual(sent, ["fmt:line-1\nline-2"]);
  assert.deepEqual(watchers, []);
  assert.equal(state.hasDeliveredReply, true);
});

test("handleWecomAgentPostDispatchFallback starts queued watcher when no output", async () => {
  const notices = [];
  const watchers = [];
  const state = createState();
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async () => {},
    markdownToWecomText: (text) => String(text),
    sendProgressNotice: async (text) => notices.push(String(text)),
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    queuedNoticeText: "queued",
    processingNoticeText: "processing",
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: false },
  });

  assert.deepEqual(notices, ["queued"]);
  assert.deepEqual(watchers, ["queued-no-final"]);
  assert.equal(state.hasDeliveredReply, false);
});

test("handleWecomAgentPostDispatchFallback starts dispatch-finished watcher when queuedFinal true", async () => {
  const notices = [];
  const watchers = [];
  const state = createState();
  await handleWecomAgentPostDispatchFallback({
    api: { logger: { info() {}, warn() {} } },
    state,
    streamingEnabled: false,
    flushStreamingBuffer: async () => false,
    sendTextToUser: async () => {},
    markdownToWecomText: (text) => String(text),
    sendProgressNotice: async (text) => notices.push(String(text)),
    startLateReplyWatcher: async (reason) => watchers.push(reason),
    queuedNoticeText: "queued",
    processingNoticeText: "processing",
    dispatchResult: { counts: { final: 0, block: 0, tool: 0 }, queuedFinal: true },
  });

  assert.deepEqual(notices, ["processing"]);
  assert.deepEqual(watchers, ["dispatch-finished-without-final"]);
});
