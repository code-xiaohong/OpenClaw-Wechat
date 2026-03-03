import assert from "node:assert/strict";
import test from "node:test";

import { createWecomTextInboundScheduler } from "../src/wecom/text-inbound-scheduler.js";

function createScheduler(overrides = {}) {
  const handled = [];
  const scheduler = createWecomTextInboundScheduler({
    resolveWecomGroupChatPolicy: () => ({ mentionPatterns: ["@bot"] }),
    shouldStripWecomGroupMentions: () => false,
    stripWecomGroupMentions: (text) => String(text ?? "").replace(/@bot/g, "").trim(),
    extractLeadingSlashCommand: (text) => {
      const normalized = String(text ?? "").trim();
      return normalized.startsWith("/") ? normalized.split(/\s+/)[0].toLowerCase() : "";
    },
    resolveWecomTextDebouncePolicy: () => ({ enabled: true, windowMs: 5000, maxBatch: 2 }),
    buildWecomSessionId: (fromUser) => `wecom:${fromUser}`,
    messageProcessLimiter: {
      async execute(fn) {
        return fn();
      },
    },
    executeInboundTaskWithSessionQueue: async ({ task }) => task(),
    getProcessInboundMessage: () => async (payload) => {
      handled.push(payload);
    },
    ...overrides,
  });
  return { scheduler, handled };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("buildTextDebounceBufferKey builds dm/group keys", () => {
  const { scheduler } = createScheduler();
  assert.equal(
    scheduler.buildTextDebounceBufferKey({ accountId: "default", fromUser: "u1", chatId: "", isGroupChat: false }),
    "default:dm:u1",
  );
  assert.equal(
    scheduler.buildTextDebounceBufferKey({ accountId: "default", fromUser: "u1", chatId: "g1", isGroupChat: true }),
    "default:group:g1:user:u1",
  );
});

test("scheduleTextInboundProcessing merges buffered text and flushes at maxBatch", async () => {
  const { scheduler, handled } = createScheduler({
    resolveWecomTextDebouncePolicy: () => ({ enabled: true, windowMs: 5000, maxBatch: 2 }),
  });
  const api = { logger: { info() {}, warn() {}, error() {} } };
  const basePayload = { accountId: "default", fromUser: "u1", chatId: "", isGroupChat: false, msgId: "m1" };

  scheduler.scheduleTextInboundProcessing(api, basePayload, "hello");
  await tick();
  assert.equal(handled.length, 0);

  scheduler.scheduleTextInboundProcessing(api, { ...basePayload, msgId: "m2" }, "world");
  await tick();

  assert.equal(handled.length, 1);
  assert.equal(handled[0].content, "hello\nworld");
  assert.equal(handled[0].msgId, "m1");
});

test("command message flushes buffer first, then dispatches command", async () => {
  const { scheduler, handled } = createScheduler({
    resolveWecomTextDebouncePolicy: () => ({ enabled: true, windowMs: 5000, maxBatch: 10 }),
  });
  const api = { logger: { info() {}, warn() {}, error() {} } };
  const basePayload = { accountId: "default", fromUser: "u1", chatId: "", isGroupChat: false, msgId: "m1" };

  scheduler.scheduleTextInboundProcessing(api, basePayload, "buffered");
  scheduler.scheduleTextInboundProcessing(api, { ...basePayload, msgId: "m2" }, "/status");
  await tick();

  assert.equal(handled.length, 2);
  assert.equal(handled[0].content, "buffered");
  assert.equal(handled[1].content, "/status");
});

test("group mention stripping affects command probe", async () => {
  const { scheduler, handled } = createScheduler({
    shouldStripWecomGroupMentions: () => true,
    resolveWecomTextDebouncePolicy: () => ({ enabled: true, windowMs: 5000, maxBatch: 10 }),
  });
  const api = { logger: { info() {}, warn() {}, error() {} } };
  const basePayload = { accountId: "default", fromUser: "u1", chatId: "g1", isGroupChat: true, msgId: "m1" };

  scheduler.scheduleTextInboundProcessing(api, basePayload, "@bot /help");
  await tick();

  assert.equal(handled.length, 1);
  assert.equal(handled[0].content, "@bot /help");
});
