import { createWecomLateReplyWatcher } from "./agent-late-reply-watcher.js";
import { executeWecomBotInboundFlow } from "./bot-inbound-executor.js";
import { createWecomBotTranscriptFallbackReader } from "./bot-transcript-fallback.js";

export function createWecomBotInboundProcessor(deps = {}) {
  const {
    resolveSessionTranscriptFilePath,
    readTranscriptAppendedChunk,
    parseLateAssistantReplyFromTranscriptLine,
    hasTranscriptReplyBeenDelivered,
    markTranscriptReplyDelivered,
    markdownToWecomText,
    sleep,
  } = deps;

  let lateReplyWatcherRunner = null;
  let transcriptFallbackReader = null;
  function ensureLateReplyWatcherRunner() {
    if (lateReplyWatcherRunner) return lateReplyWatcherRunner;
    lateReplyWatcherRunner = createWecomLateReplyWatcher({
      resolveSessionTranscriptFilePath,
      readTranscriptAppendedChunk,
      parseLateAssistantReplyFromTranscriptLine,
      hasTranscriptReplyBeenDelivered,
      markTranscriptReplyDelivered,
      sleep,
      markdownToWecomText,
    });
    return lateReplyWatcherRunner;
  }
  function ensureTranscriptFallbackReader() {
    if (transcriptFallbackReader) return transcriptFallbackReader;
    transcriptFallbackReader = createWecomBotTranscriptFallbackReader({
      resolveSessionTranscriptFilePath,
      readTranscriptAppendedChunk,
      parseLateAssistantReplyFromTranscriptLine,
      hasTranscriptReplyBeenDelivered,
      markdownToWecomText,
    });
    return transcriptFallbackReader;
  }

  const flowDeps = {
    ...deps,
    ensureLateReplyWatcherRunner,
    ensureTranscriptFallbackReader,
  };

  async function processBotInboundMessage(payload) {
    return executeWecomBotInboundFlow({
      ...flowDeps,
      ...payload,
    });
  }

  return processBotInboundMessage;
}
