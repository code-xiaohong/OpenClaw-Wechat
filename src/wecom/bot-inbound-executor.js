import { buildWecomBotInboundContextPayload, buildWecomBotInboundEnvelopePayload } from "./bot-context.js";
import { handleWecomBotDispatchError, handleWecomBotPostDispatchFallback } from "./bot-dispatch-fallback.js";
import { createWecomBotDispatchHandlers } from "./bot-dispatch-handlers.js";
import { applyWecomBotCommandAndSenderGuard, applyWecomBotGroupChatGuard } from "./bot-inbound-guards.js";
import {
  createWecomBotDispatchState,
  createWecomBotLateReplyRuntime,
  resolveWecomBotReplyRuntimePolicy,
} from "./bot-reply-runtime.js";
import { prepareWecomBotRuntimeContext } from "./bot-runtime-context.js";

function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`executeWecomBotInboundFlow: ${name} is required`);
  }
}

export async function executeWecomBotInboundFlow({
  api,
  streamId,
  fromUser,
  content,
  msgType = "text",
  msgId,
  chatId,
  isGroupChat = false,
  imageUrls = [],
  fileUrl = "",
  fileName = "",
  quote = null,
  responseUrl = "",
  buildWecomBotSessionId,
  resolveWecomBotConfig,
  resolveWecomBotProxyConfig,
  normalizeWecomBotOutboundMediaUrls,
  resolveWecomGroupChatPolicy,
  resolveWecomDynamicAgentPolicy,
  hasBotStream,
  finishBotStream,
  deliverBotReplyText,
  shouldTriggerWecomGroupResponse,
  shouldStripWecomGroupMentions,
  stripWecomGroupMentions,
  resolveWecomCommandPolicy,
  resolveWecomAllowFromPolicy,
  isWecomSenderAllowed,
  extractLeadingSlashCommand,
  buildWecomBotHelpText,
  buildWecomBotStatusText,
  buildBotInboundContent,
  resolveWecomAgentRoute,
  seedDynamicAgentWorkspace,
  markTranscriptReplyDelivered,
  markdownToWecomText,
  withTimeout,
  isDispatchTimeoutError,
  queueBotStreamMedia,
  updateBotStream,
  isAgentFailureText,
  scheduleTempFileCleanup,
  ACTIVE_LATE_REPLY_WATCHERS,
  ensureLateReplyWatcherRunner,
  ensureTranscriptFallbackReader,
} = {}) {
  if (!api || typeof api !== "object") {
    throw new Error("executeWecomBotInboundFlow: api is required");
  }
  assertFunction("buildWecomBotSessionId", buildWecomBotSessionId);
  assertFunction("resolveWecomBotConfig", resolveWecomBotConfig);
  assertFunction("resolveWecomBotProxyConfig", resolveWecomBotProxyConfig);
  assertFunction("normalizeWecomBotOutboundMediaUrls", normalizeWecomBotOutboundMediaUrls);
  assertFunction("resolveWecomGroupChatPolicy", resolveWecomGroupChatPolicy);
  assertFunction("resolveWecomDynamicAgentPolicy", resolveWecomDynamicAgentPolicy);
  assertFunction("hasBotStream", hasBotStream);
  assertFunction("finishBotStream", finishBotStream);
  assertFunction("deliverBotReplyText", deliverBotReplyText);
  assertFunction("shouldTriggerWecomGroupResponse", shouldTriggerWecomGroupResponse);
  assertFunction("shouldStripWecomGroupMentions", shouldStripWecomGroupMentions);
  assertFunction("stripWecomGroupMentions", stripWecomGroupMentions);
  assertFunction("resolveWecomCommandPolicy", resolveWecomCommandPolicy);
  assertFunction("resolveWecomAllowFromPolicy", resolveWecomAllowFromPolicy);
  assertFunction("isWecomSenderAllowed", isWecomSenderAllowed);
  assertFunction("extractLeadingSlashCommand", extractLeadingSlashCommand);
  assertFunction("buildWecomBotHelpText", buildWecomBotHelpText);
  assertFunction("buildWecomBotStatusText", buildWecomBotStatusText);
  assertFunction("buildBotInboundContent", buildBotInboundContent);
  assertFunction("resolveWecomAgentRoute", resolveWecomAgentRoute);
  assertFunction("seedDynamicAgentWorkspace", seedDynamicAgentWorkspace);
  assertFunction("markTranscriptReplyDelivered", markTranscriptReplyDelivered);
  assertFunction("markdownToWecomText", markdownToWecomText);
  assertFunction("withTimeout", withTimeout);
  assertFunction("isDispatchTimeoutError", isDispatchTimeoutError);
  assertFunction("queueBotStreamMedia", queueBotStreamMedia);
  assertFunction("updateBotStream", updateBotStream);
  assertFunction("isAgentFailureText", isAgentFailureText);
  assertFunction("scheduleTempFileCleanup", scheduleTempFileCleanup);
  assertFunction("ensureLateReplyWatcherRunner", ensureLateReplyWatcherRunner);
  assertFunction("ensureTranscriptFallbackReader", ensureTranscriptFallbackReader);

  const runtime = api.runtime;
  const cfg = api.config;
  const baseSessionId = buildWecomBotSessionId(fromUser);
  let sessionId = baseSessionId;
  let routedAgentId = "";
  const fromAddress = `wecom-bot:${fromUser}`;
  const normalizedFromUser = String(fromUser ?? "").trim().toLowerCase();
  const originalContent = String(content ?? "");
  let commandBody = originalContent;
  const dispatchStartedAt = Date.now();
  const tempPathsToCleanup = [];
  const botModeConfig = resolveWecomBotConfig(api);
  const botProxyUrl = resolveWecomBotProxyConfig(api);
  const normalizedFileUrl = String(fileUrl ?? "").trim();
  const normalizedFileName = String(fileName ?? "").trim();
  const normalizedQuote =
    quote && typeof quote === "object"
      ? {
          msgType: String(quote.msgType ?? "").trim().toLowerCase(),
          content: String(quote.content ?? "").trim(),
        }
      : null;
  const normalizedImageUrls = Array.from(
    new Set(
      (Array.isArray(imageUrls) ? imageUrls : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );
  const groupChatPolicy = resolveWecomGroupChatPolicy(api);
  const dynamicAgentPolicy = resolveWecomDynamicAgentPolicy(api);
  let isAdminUser = false;

  const safeFinishStream = (text) => {
    if (!hasBotStream(streamId)) return;
    finishBotStream(streamId, String(text ?? ""));
  };
  const safeDeliverReply = async (reply, reason = "reply") => {
    const normalizedReply =
      typeof reply === "string"
        ? { text: reply }
        : reply && typeof reply === "object"
          ? reply
          : { text: "" };
    const contentText = String(normalizedReply.text ?? "").trim();
    const replyMediaUrls = normalizeWecomBotOutboundMediaUrls(normalizedReply);
    if (!contentText && replyMediaUrls.length === 0) return false;
    const result = await deliverBotReplyText({
      api,
      fromUser,
      sessionId,
      streamId,
      responseUrl,
      text: contentText,
      mediaUrls: replyMediaUrls,
      mediaType: String(normalizedReply.mediaType ?? "").trim().toLowerCase() || undefined,
      reason,
    });
    if (!result?.ok && hasBotStream(streamId)) {
      finishBotStream(streamId, contentText || "已收到模型返回的媒体结果，请稍后刷新。");
    }
    return result?.ok === true;
  };
  let startLateReplyWatcher = () => false;
  let readTranscriptFallbackResult = async () => ({ text: "", transcriptMessageId: "" });

  try {
    const groupGuardResult = applyWecomBotGroupChatGuard({
      isGroupChat,
      msgType,
      commandBody,
      groupChatPolicy,
      shouldTriggerWecomGroupResponse,
      shouldStripWecomGroupMentions,
      stripWecomGroupMentions,
    });
    if (!groupGuardResult.ok) {
      safeFinishStream(groupGuardResult.finishText);
      return;
    }
    commandBody = groupGuardResult.commandBody;

    const commandGuardResult = applyWecomBotCommandAndSenderGuard({
      api,
      fromUser,
      msgType,
      commandBody,
      normalizedFromUser,
      resolveWecomCommandPolicy,
      resolveWecomAllowFromPolicy,
      isWecomSenderAllowed,
      extractLeadingSlashCommand,
      buildWecomBotHelpText,
      buildWecomBotStatusText,
    });
    isAdminUser = commandGuardResult.isAdminUser === true;
    commandBody = commandGuardResult.commandBody;
    if (!commandGuardResult.ok) {
      safeFinishStream(commandGuardResult.finishText);
      return;
    }

    const inboundContentResult = await buildBotInboundContent({
      api,
      botModeConfig,
      botProxyUrl,
      msgType,
      commandBody,
      normalizedImageUrls,
      normalizedFileUrl,
      normalizedFileName,
      normalizedQuote,
    });
    if (Array.isArray(inboundContentResult.tempPathsToCleanup)) {
      tempPathsToCleanup.push(...inboundContentResult.tempPathsToCleanup);
    }
    if (inboundContentResult.aborted) {
      safeFinishStream(inboundContentResult.abortText || "消息处理失败，请稍后重试。");
      return;
    }
    const messageText = String(inboundContentResult.messageText ?? "").trim();
    if (!messageText) {
      safeFinishStream("消息内容为空，请发送有效文本。");
      return;
    }

    const runtimeContext = await prepareWecomBotRuntimeContext({
      api,
      runtime,
      cfg,
      baseSessionId,
      fromUser,
      chatId,
      isGroupChat,
      msgId,
      messageText,
      commandBody,
      originalContent,
      fromAddress,
      groupChatPolicy,
      dynamicAgentPolicy,
      isAdminUser,
      resolveWecomAgentRoute,
      seedDynamicAgentWorkspace,
      buildWecomBotInboundEnvelopePayload,
      buildWecomBotInboundContextPayload,
    });
    routedAgentId = runtimeContext.routedAgentId;
    sessionId = runtimeContext.sessionId;
    const storePath = runtimeContext.storePath;
    const ctxPayload = runtimeContext.ctxPayload;
    const sessionRuntimeId = runtimeContext.sessionRuntimeId;

    const dispatchState = createWecomBotDispatchState();
    const replyRuntimePolicy = resolveWecomBotReplyRuntimePolicy({ botModeConfig });
    const readTranscriptFallback = ensureTranscriptFallbackReader();
    assertFunction("readTranscriptFallback", readTranscriptFallback);
    const runLateReplyWatcher = ensureLateReplyWatcherRunner();
    assertFunction("runLateReplyWatcher", runLateReplyWatcher);
    const lateReplyRuntime = createWecomBotLateReplyRuntime({
      logger: api.logger,
      sessionId,
      sessionRuntimeId,
      msgId,
      storePath,
      dispatchState,
      dispatchStartedAt,
      lateReplyWatchMs: replyRuntimePolicy.lateReplyWatchMs,
      lateReplyPollMs: replyRuntimePolicy.lateReplyPollMs,
      readTranscriptFallback,
      markTranscriptReplyDelivered,
      safeDeliverReply,
      runLateReplyWatcher,
      activeWatchers: ACTIVE_LATE_REPLY_WATCHERS,
    });
    readTranscriptFallbackResult = lateReplyRuntime.readTranscriptFallbackResult;
    const tryFinishFromTranscript = lateReplyRuntime.tryFinishFromTranscript;
    startLateReplyWatcher = lateReplyRuntime.startLateReplyWatcher;
    const dispatchHandlers = createWecomBotDispatchHandlers({
      api,
      streamId,
      state: dispatchState,
      hasBotStream,
      normalizeWecomBotOutboundMediaUrls,
      queueBotStreamMedia,
      updateBotStream,
      markdownToWecomText,
      isAgentFailureText,
      safeDeliverReply,
    });

    await withTimeout(
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        replyOptions: {
          disableBlockStreaming: false,
          routeOverrides:
            routedAgentId && sessionId
              ? {
                  sessionKey: sessionId,
                  agentId: routedAgentId,
                  accountId: "bot",
                }
              : undefined,
        },
        dispatcherOptions: {
          deliver: dispatchHandlers.deliver,
          onError: dispatchHandlers.onError,
        },
      }),
      replyRuntimePolicy.replyTimeoutMs,
      `dispatch timed out after ${replyRuntimePolicy.replyTimeoutMs}ms`,
    );

    const shouldReturnAfterFallback = await handleWecomBotPostDispatchFallback({
      api,
      sessionId,
      dispatchState,
      dispatchStartedAt,
      tryFinishFromTranscript,
      markdownToWecomText,
      safeDeliverReply,
      startLateReplyWatcher,
    });
    if (shouldReturnAfterFallback) return;
  } catch (err) {
    const shouldReturnFromError = await handleWecomBotDispatchError({
      api,
      err,
      dispatchStartedAt,
      isDispatchTimeoutError,
      startLateReplyWatcher,
      sessionId,
      fromUser,
      buildWecomBotSessionId,
      runtime,
      cfg,
      routedAgentId,
      readTranscriptFallbackResult,
      safeDeliverReply,
      markTranscriptReplyDelivered,
    });
    if (shouldReturnFromError) return;
  } finally {
    for (const filePath of tempPathsToCleanup) {
      scheduleTempFileCleanup(filePath, api.logger);
    }
  }
}
