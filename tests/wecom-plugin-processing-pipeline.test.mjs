import assert from "node:assert/strict";
import test from "node:test";

import { createWecomPluginProcessingPipeline } from "../src/wecom/plugin-processing-pipeline.js";

test("createWecomPluginProcessingPipeline returns bot/agent/scheduler handlers", () => {
  const pipeline = createWecomPluginProcessingPipeline({
    botInboundDeps: {},
    agentInboundDeps: {},
    textSchedulerDeps: {
      resolveWecomGroupChatPolicy: () => ({ enabled: false }),
      shouldStripWecomGroupMentions: () => false,
      stripWecomGroupMentions: (text) => String(text ?? ""),
      extractLeadingSlashCommand: () => "",
      resolveWecomTextDebouncePolicy: () => ({ enabled: false, windowMs: 1000, maxBatch: 3 }),
      buildWecomSessionId: (user) => `wecom:${user}`,
      messageProcessLimiter: { execute: async (fn) => fn() },
      executeInboundTaskWithSessionQueue: async ({ task }) => task(),
    },
  });

  assert.equal(typeof pipeline.processBotInboundMessage, "function");
  assert.equal(typeof pipeline.processInboundMessage, "function");
  assert.equal(typeof pipeline.scheduleTextInboundProcessing, "function");
});
