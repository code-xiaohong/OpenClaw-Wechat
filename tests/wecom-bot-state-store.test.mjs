import assert from "node:assert/strict";
import test from "node:test";

import { createWecomBotStateStore } from "../src/wecom/bot-state-store.js";

test("bot state store tracks active stream lifecycle", () => {
  const store = createWecomBotStateStore();

  store.createStream("stream-1", "处理中", { sessionId: "wecom-bot:alice" });
  assert.equal(store.hasStream("stream-1"), true);
  assert.equal(store.resolveActiveStream("wecom-bot:alice"), "stream-1");

  store.finishStream("stream-1", "已完成");
  assert.equal(store.resolveActiveStream("wecom-bot:alice"), "");
});

test("bot state store handles response_url cache ttl", async () => {
  const store = createWecomBotStateStore({ responseUrlTtlMs: 50 });

  store.upsertResponseUrlCache({
    sessionId: "wecom-bot:alice",
    responseUrl: "https://example.com/response",
  });
  const cached = store.getResponseUrlCache("wecom-bot:alice");
  assert.equal(Boolean(cached), true);
  assert.equal(cached?.used, false);

  store.markResponseUrlUsed("wecom-bot:alice");
  const marked = store.getResponseUrlCache("wecom-bot:alice");
  assert.equal(marked?.used, true);

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(store.getResponseUrlCache("wecom-bot:alice"), null);
});
