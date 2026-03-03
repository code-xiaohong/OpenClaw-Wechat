import assert from "node:assert/strict";
import test from "node:test";

import { createWecomSessionQueueManager } from "../src/wecom/session-queue.js";

class FakeQueue {
  constructor({ maxConcurrentPerSession = 1 } = {}) {
    this.maxConcurrentPerSession = maxConcurrentPerSession;
    this.enqueued = [];
  }

  setMaxConcurrentPerSession(value) {
    this.maxConcurrentPerSession = value;
  }

  async enqueue(sessionId, task) {
    this.enqueued.push(sessionId);
    return task();
  }
}

test("syncWecomSessionQueuePolicy applies limits and timeout", () => {
  let expireMs = 0;
  const manager = createWecomSessionQueueManager({
    WecomSessionTaskQueue: FakeQueue,
    resolveWecomStreamManagerPolicy: () => ({ enabled: true, maxConcurrentPerSession: 3, timeoutMs: 9000 }),
    setBotStreamExpireMs: (value) => {
      expireMs = value;
    },
  });

  const policy = manager.syncWecomSessionQueuePolicy({});
  assert.equal(policy.maxConcurrentPerSession, 3);
  assert.equal(manager.wecomSessionTaskQueue.maxConcurrentPerSession, 3);
  assert.equal(manager.botSessionTaskQueue.maxConcurrentPerSession, 3);
  assert.equal(expireMs, 9000);
});

test("executeInboundTaskWithSessionQueue enqueues only when enabled", async () => {
  let enabled = true;
  const manager = createWecomSessionQueueManager({
    WecomSessionTaskQueue: FakeQueue,
    resolveWecomStreamManagerPolicy: () => ({ enabled, maxConcurrentPerSession: 2, timeoutMs: 1000 }),
    setBotStreamExpireMs: () => {},
  });

  let calls = 0;
  const resultEnabled = await manager.executeInboundTaskWithSessionQueue({
    api: {},
    sessionId: "s1",
    isBot: false,
    task: async () => {
      calls += 1;
      return "ok-1";
    },
  });
  assert.equal(resultEnabled, "ok-1");
  assert.deepEqual(manager.wecomSessionTaskQueue.enqueued, ["s1"]);

  enabled = false;
  const resultDisabled = await manager.executeInboundTaskWithSessionQueue({
    api: {},
    sessionId: "s2",
    isBot: true,
    task: async () => {
      calls += 1;
      return "ok-2";
    },
  });
  assert.equal(resultDisabled, "ok-2");
  assert.deepEqual(manager.botSessionTaskQueue.enqueued, []);
  assert.equal(calls, 2);
});
