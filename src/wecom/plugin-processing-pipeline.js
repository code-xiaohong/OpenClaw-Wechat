import { createWecomAgentInboundProcessor } from "./agent-inbound-processor.js";
import { createWecomBotInboundProcessor } from "./bot-inbound-processor.js";
import { createWecomTextInboundScheduler } from "./text-inbound-scheduler.js";

function assertObject(name, value) {
  if (!value || typeof value !== "object") {
    throw new Error(`createWecomPluginProcessingPipeline: ${name} is required`);
  }
}

export function createWecomPluginProcessingPipeline({
  botInboundDeps,
  agentInboundDeps,
  textSchedulerDeps,
} = {}) {
  assertObject("botInboundDeps", botInboundDeps);
  assertObject("agentInboundDeps", agentInboundDeps);
  assertObject("textSchedulerDeps", textSchedulerDeps);

  const processBotInboundMessage = createWecomBotInboundProcessor(botInboundDeps);
  const processInboundMessage = createWecomAgentInboundProcessor(agentInboundDeps);
  const { scheduleTextInboundProcessing } = createWecomTextInboundScheduler({
    ...textSchedulerDeps,
    getProcessInboundMessage: () => processInboundMessage,
  });

  return {
    processBotInboundMessage,
    processInboundMessage,
    scheduleTextInboundProcessing,
  };
}
