export function createWecomAgentInboundProcessor(deps = {}) {
  const {
    getWecomConfig,
    buildWecomSessionId,
    resolveWecomGroupChatPolicy,
    resolveWecomDynamicAgentPolicy,
    shouldTriggerWecomGroupResponse,
    shouldStripWecomGroupMentions,
    stripWecomGroupMentions,
    resolveWecomCommandPolicy,
    resolveWecomAllowFromPolicy,
    isWecomSenderAllowed,
    sendWecomText,
    extractLeadingSlashCommand,
    COMMANDS,
    buildInboundContent,
    resolveWecomAgentRoute,
    seedDynamicAgentWorkspace,
    resolveWecomReplyStreamingPolicy,
    asNumber,
    requireEnv,
    getByteLength,
    markdownToWecomText,
    autoSendWorkspaceFilesFromReplyText,
    sendWecomOutboundMediaBatch,
    sleep,
    resolveSessionTranscriptFilePath,
    readTranscriptAppendedChunk,
    parseLateAssistantReplyFromTranscriptLine,
    hasTranscriptReplyBeenDelivered,
    markTranscriptReplyDelivered,
    withTimeout,
    isDispatchTimeoutError,
    isAgentFailureText,
    scheduleTempFileCleanup,
    ACTIVE_LATE_REPLY_WATCHERS,
  } = deps;

  async function processInboundMessage({
  api,
  accountId,
  fromUser,
  content,
  msgType,
  mediaId,
  picUrl,
  recognition,
  thumbMediaId,
  fileName,
  fileSize,
  linkTitle,
  linkDescription,
  linkUrl,
  linkPicUrl,
  chatId,
  isGroupChat,
  msgId,
}) {
  const config = getWecomConfig(api, accountId);
  const cfg = api.config;
  const runtime = api.runtime;

  if (!config?.corpId || !config?.corpSecret || !config?.agentId) {
    api.logger.warn?.("wecom: not configured (check channels.wecom in openclaw.json)");
    return;
  }

  const { corpId, corpSecret, agentId, outboundProxy: proxyUrl } = config;

  try {
    // 一用户一会话：群聊和私聊统一归并到 wecom:<userid>
    const baseSessionId = buildWecomSessionId(fromUser);
    let sessionId = baseSessionId;
    let routedAgentId = "";
    const fromAddress = `wecom:${fromUser}`;
    const normalizedFromUser = String(fromUser ?? "").trim().toLowerCase();
    const originalContent = content || "";
    let commandBody = originalContent;
    const groupChatPolicy = resolveWecomGroupChatPolicy(api);
    const dynamicAgentPolicy = resolveWecomDynamicAgentPolicy(api);
    api.logger.info?.(`wecom: processing ${msgType} message for session ${sessionId}${isGroupChat ? " (group)" : ""}`);

    // 群聊触发策略（仅对文本消息）
    if (msgType === "text" && isGroupChat) {
      if (!groupChatPolicy.enabled) {
        api.logger.info?.(`wecom: group chat processing disabled, skipped chatId=${chatId || "unknown"}`);
        return;
      }
      if (!shouldTriggerWecomGroupResponse(commandBody, groupChatPolicy)) {
        api.logger.info?.(
          `wecom: group message skipped by trigger policy chatId=${chatId || "unknown"} mode=${groupChatPolicy.triggerMode || "direct"}`,
        );
        return;
      }
      if (shouldStripWecomGroupMentions(groupChatPolicy)) {
        commandBody = stripWecomGroupMentions(commandBody, groupChatPolicy.mentionPatterns);
      }
      if (!commandBody.trim()) {
        api.logger.info?.(`wecom: group message became empty after mention strip chatId=${chatId || "unknown"}`);
        return;
      }
    }

    const commandPolicy = resolveWecomCommandPolicy(api);
    const isAdminUser = commandPolicy.adminUsers.includes(normalizedFromUser);
    const allowFromPolicy = resolveWecomAllowFromPolicy(api, config.accountId || accountId || "default", config);
    const senderAllowed = isAdminUser || isWecomSenderAllowed({
      senderId: normalizedFromUser,
      allowFrom: allowFromPolicy.allowFrom,
    });
    if (!senderAllowed) {
      api.logger.warn?.(
        `wecom: sender blocked by allowFrom account=${config.accountId || "default"} user=${normalizedFromUser}`,
      );
      if (allowFromPolicy.rejectMessage) {
        await sendWecomText({
          corpId,
          corpSecret,
          agentId,
          toUser: fromUser,
          text: allowFromPolicy.rejectMessage,
          logger: api.logger,
          proxyUrl,
        });
      }
      return;
    }

    // 命令检测（仅对文本消息）
    if (msgType === "text") {
      let commandKey = extractLeadingSlashCommand(commandBody);
      if (commandKey === "/clear") {
        api.logger.info?.("wecom: translating /clear to native /reset command");
        commandBody = commandBody.replace(/^\/clear\b/i, "/reset");
        commandKey = "/reset";
      }
      if (commandKey) {
        const commandAllowed =
          commandPolicy.allowlist.includes(commandKey) ||
          (commandKey === "/reset" && commandPolicy.allowlist.includes("/clear"));
        if (commandPolicy.enabled && !isAdminUser && !commandAllowed) {
          api.logger.info?.(`wecom: command blocked by allowlist user=${fromUser} command=${commandKey}`);
          await sendWecomText({
            corpId,
            corpSecret,
            agentId,
            toUser: fromUser,
            text: commandPolicy.rejectMessage,
            logger: api.logger,
            proxyUrl,
          });
          return;
        }
        const handler = COMMANDS[commandKey];
        if (handler) {
          api.logger.info?.(`wecom: handling command ${commandKey}`);
          await handler({
            api,
            fromUser,
            corpId,
            corpSecret,
            agentId,
            accountId: config.accountId || "default",
            proxyUrl,
            chatId,
            isGroupChat,
          });
          return; // 命令已处理，不再调用 AI
        }
      }
    }

    const inboundResult = await buildInboundContent({
      api,
      corpId,
      corpSecret,
      agentId,
      proxyUrl,
      fromUser,
      msgType,
      baseText: msgType === "text" ? commandBody : originalContent,
      mediaId,
      picUrl,
      recognition,
      fileName,
      fileSize,
      linkTitle,
      linkDescription,
      linkUrl,
    });
    if (inboundResult.aborted) {
      return;
    }
    let messageText = String(inboundResult.messageText ?? "");
    const tempPathsToCleanup = Array.isArray(inboundResult.tempPathsToCleanup)
      ? inboundResult.tempPathsToCleanup
      : [];
    if (!messageText) {
      api.logger.warn?.("wecom: empty message content");
      return;
    }

    // 获取路由信息
    const route = resolveWecomAgentRoute({
      runtime,
      cfg,
      channel: "wecom",
      accountId: config.accountId || "default",
      sessionKey: baseSessionId,
      fromUser,
      chatId,
      isGroupChat,
      content: commandBody || messageText,
      mentionPatterns: groupChatPolicy.mentionPatterns,
      dynamicConfig: dynamicAgentPolicy,
      isAdminUser,
      logger: api.logger,
    });
    routedAgentId = String(route?.agentId ?? "").trim();
    sessionId = String(route?.sessionKey ?? "").trim() || baseSessionId;
    api.logger.info?.(
      `wecom: routed agent=${route.agentId} session=${sessionId} matchedBy=${route.dynamicMatchedBy || route.matchedBy || "default"}`,
    );
    try {
      await seedDynamicAgentWorkspace({
        api,
        agentId: route.agentId,
        workspaceTemplate: dynamicAgentPolicy.workspaceTemplate,
      });
    } catch (seedErr) {
      api.logger.warn?.(`wecom: workspace seed failed: ${String(seedErr?.message || seedErr)}`);
    }

    // 获取 storePath
    const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });

    // 格式化消息体
    const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const body = runtime.channel.reply.formatInboundEnvelope({
      channel: "WeCom",
      from: isGroupChat && chatId ? `${fromUser} (group:${chatId})` : fromUser,
      timestamp: Date.now(),
      body: messageText,
      chatType: isGroupChat ? "group" : "direct",
      sender: {
        name: fromUser,
        id: fromUser,
      },
      ...envelopeOptions,
    });

    // 构建 Session 上下文对象
    const ctxPayload = runtime.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: messageText,
      RawBody: originalContent,
      CommandBody: commandBody,
      From: fromAddress,
      To: fromAddress,
      SessionKey: sessionId,
      AccountId: config.accountId || "default",
      ChatType: isGroupChat ? "group" : "direct",
      ConversationLabel: isGroupChat && chatId ? `group:${chatId}` : fromUser,
      SenderName: fromUser,
      SenderId: fromUser,
      Provider: "wecom",
      Surface: "wecom",
      MessageSid: msgId || `wecom-${Date.now()}`,
      Timestamp: Date.now(),
      OriginatingChannel: "wecom",
      OriginatingTo: fromAddress,
    });

    // 注册会话到 Sessions UI
    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey: sessionId,
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: sessionId,
        channel: "wecom",
        to: fromUser,
        accountId: config.accountId || "default",
      },
      onRecordError: (err) => {
        api.logger.warn?.(`wecom: failed to record session: ${err}`);
      },
    });
    api.logger.info?.(`wecom: session registered for ${sessionId}`);

    // 记录渠道活动
    runtime.channel.activity.record({
      channel: "wecom",
      accountId: config.accountId || "default",
      direction: "inbound",
    });

    api.logger.info?.(`wecom: dispatching message via agent runtime for session ${sessionId}`);

    // 使用 gateway 内部 agent runtime API 调用 AI
    // 对标 Telegram 的 dispatchReplyWithBufferedBlockDispatcher

    let hasDeliveredReply = false;
    let hasDeliveredPartialReply = false;
    let hasSentProgressNotice = false;
    let blockTextFallback = "";
    let streamChunkBuffer = "";
    let streamChunkLastSentAt = 0;
    let streamChunkSentCount = 0;
    let streamChunkSendChain = Promise.resolve();
    let suppressLateDispatcherDeliveries = false;
    let progressNoticeTimer = null;
    let lateReplyWatcherPromise = null;
    const streamingPolicy = resolveWecomReplyStreamingPolicy(api);
    const streamingEnabled = streamingPolicy.enabled === true;
    const replyTimeoutMs = Math.max(
      15000,
      asNumber(cfg?.env?.vars?.WECOM_REPLY_TIMEOUT_MS ?? requireEnv("WECOM_REPLY_TIMEOUT_MS"), 90000),
    );
    const progressNoticeDelayMs = Math.max(
      0,
      asNumber(cfg?.env?.vars?.WECOM_PROGRESS_NOTICE_MS ?? requireEnv("WECOM_PROGRESS_NOTICE_MS"), 0),
    );
    const lateReplyWatchMs = Math.max(
      30000,
      Math.min(
        10 * 60 * 1000,
        asNumber(
          cfg?.env?.vars?.WECOM_LATE_REPLY_WATCH_MS ?? requireEnv("WECOM_LATE_REPLY_WATCH_MS"),
          Math.max(replyTimeoutMs, 180000),
        ),
      ),
    );
    const lateReplyPollMs = Math.max(
      500,
      Math.min(
        10000,
        asNumber(cfg?.env?.vars?.WECOM_LATE_REPLY_POLL_MS ?? requireEnv("WECOM_LATE_REPLY_POLL_MS"), 2000),
      ),
    );
    // 自建应用模式默认不发送“处理中”提示，避免打扰用户。
    const processingNoticeText = "";
    const queuedNoticeText = "";
    const enqueueStreamingChunk = async (text, reason = "stream") => {
      const chunkText = String(text ?? "").trim();
      if (!chunkText || hasDeliveredReply) return;
      hasDeliveredPartialReply = true;
      streamChunkSendChain = streamChunkSendChain
        .then(async () => {
          await sendWecomText({
            corpId,
            corpSecret,
            agentId,
            toUser: fromUser,
            text: chunkText,
            logger: api.logger,
            proxyUrl,
          });
          streamChunkLastSentAt = Date.now();
          streamChunkSentCount += 1;
          api.logger.info?.(
            `wecom: streamed block chunk ${streamChunkSentCount} (${reason}), bytes=${getByteLength(chunkText)}`,
          );
        })
        .catch((streamErr) => {
          api.logger.warn?.(`wecom: failed to send streaming block chunk: ${String(streamErr)}`);
        });
      await streamChunkSendChain;
    };
    const flushStreamingBuffer = async ({ force = false, reason = "stream" } = {}) => {
      if (!streamingEnabled || hasDeliveredReply) return false;
      const pendingText = String(streamChunkBuffer ?? "");
      const candidate = markdownToWecomText(pendingText).trim();
      if (!candidate) return false;

      const minChars = Math.max(20, Number(streamingPolicy.minChars || 120));
      const minIntervalMs = Math.max(200, Number(streamingPolicy.minIntervalMs || 1200));
      if (!force) {
        if (candidate.length < minChars) return false;
        if (Date.now() - streamChunkLastSentAt < minIntervalMs) return false;
      }

      streamChunkBuffer = "";
      await enqueueStreamingChunk(candidate, reason);
      return true;
    };
    const sendProgressNotice = async (text = processingNoticeText) => {
      const noticeText = String(text ?? "").trim();
      if (!noticeText) return;
      if (hasDeliveredReply || hasDeliveredPartialReply || hasSentProgressNotice) return;
      hasSentProgressNotice = true;
      await sendWecomText({
        corpId,
        corpSecret,
        agentId,
        toUser: fromUser,
        text: noticeText,
        logger: api.logger,
        proxyUrl,
      });
    };
    const sendFailureFallback = async (reason) => {
      if (hasDeliveredReply) return;
      hasDeliveredReply = true;
      const reasonText = String(reason ?? "unknown").slice(0, 160);
      await sendWecomText({
        corpId,
        corpSecret,
        agentId,
        toUser: fromUser,
        text: `抱歉，当前模型请求超时或网络不稳定，请稍后重试。\n故障信息: ${reasonText}`,
        logger: api.logger,
        proxyUrl,
      });
    };
    const startLateReplyWatcher = async (reason = "pending-final") => {
      if (hasDeliveredReply || hasDeliveredPartialReply || lateReplyWatcherPromise) return;

      const watchStartedAt = Date.now();
      const watchId = `${sessionId}:${msgId || watchStartedAt}:${Math.random().toString(36).slice(2, 8)}`;
      ACTIVE_LATE_REPLY_WATCHERS.set(watchId, {
        sessionId,
        sessionKey: sessionId,
        accountId: config.accountId || "default",
        startedAt: watchStartedAt,
        reason,
      });

      lateReplyWatcherPromise = (async () => {
        try {
          const transcriptPath = await resolveSessionTranscriptFilePath({
            storePath,
            sessionKey: sessionId,
            sessionId: ctxPayload.SessionId || sessionId,
            logger: api.logger,
          });
          let offset = 0;
          let remainder = "";
          try {
            const fileStat = await stat(transcriptPath);
            offset = Number(fileStat.size ?? 0);
          } catch {
            offset = 0;
          }

          const deadline = watchStartedAt + lateReplyWatchMs;
          api.logger.info?.(
            `wecom: late reply watcher started session=${sessionId} reason=${reason} timeoutMs=${lateReplyWatchMs}`,
          );

          while (Date.now() < deadline) {
            if (hasDeliveredReply) return;
            await sleep(lateReplyPollMs);
            if (hasDeliveredReply) return;

            const { nextOffset, chunk } = await readTranscriptAppendedChunk(transcriptPath, offset);
            offset = nextOffset;
            if (!chunk) continue;

            const combined = remainder + chunk;
            const lines = combined.split("\n");
            remainder = lines.pop() ?? "";

            for (const line of lines) {
              const parsed = parseLateAssistantReplyFromTranscriptLine(line, watchStartedAt);
              if (!parsed) continue;
              if (hasTranscriptReplyBeenDelivered(sessionId, parsed.transcriptMessageId)) continue;
              if (hasDeliveredReply) return;

              const formattedReply = markdownToWecomText(parsed.text);
              if (!formattedReply) continue;

              await sendWecomText({
                corpId,
                corpSecret,
                agentId,
                toUser: fromUser,
                text: formattedReply,
                logger: api.logger,
                proxyUrl,
              });
              markTranscriptReplyDelivered(sessionId, parsed.transcriptMessageId);
              hasDeliveredReply = true;
              api.logger.info?.(
                `wecom: delivered async late reply session=${sessionId} transcriptMessageId=${parsed.transcriptMessageId}`,
              );
              return;
            }
          }

          if (!hasDeliveredReply) {
            api.logger.warn?.(
              `wecom: late reply watcher timed out session=${sessionId} timeoutMs=${lateReplyWatchMs}`,
            );
            await sendFailureFallback(`late reply watcher timed out after ${lateReplyWatchMs}ms`);
          }
        } catch (err) {
          api.logger.warn?.(`wecom: late reply watcher failed: ${String(err?.message || err)}`);
          if (!hasDeliveredReply) {
            await sendFailureFallback(err);
          }
        } finally {
          ACTIVE_LATE_REPLY_WATCHERS.delete(watchId);
          lateReplyWatcherPromise = null;
        }
      })();
    };

    try {
      if (progressNoticeDelayMs > 0) {
        progressNoticeTimer = setTimeout(() => {
          sendProgressNotice().catch((noticeErr) => {
            api.logger.warn?.(`wecom: failed to send progress notice: ${String(noticeErr)}`);
          });
        }, progressNoticeDelayMs);
      }

      let dispatchResult = null;
      api.logger.info?.(`wecom: waiting for agent reply (timeout=${replyTimeoutMs}ms)`);
      dispatchResult = await withTimeout(
        runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: ctxPayload,
          cfg,
          dispatcherOptions: {
            deliver: async (payload, info) => {
              if (suppressLateDispatcherDeliveries) {
                api.logger.info?.("wecom: suppressed late dispatcher delivery after timeout handoff");
                return;
              }
              if (hasDeliveredReply) {
                api.logger.info?.("wecom: ignoring late reply because a reply was already delivered");
                return;
              }
              if (info.kind === "block") {
                if (payload.text) {
                  if (blockTextFallback) blockTextFallback += "\n";
                  blockTextFallback += payload.text;
                  if (streamingEnabled) {
                    streamChunkBuffer += payload.text;
                    await flushStreamingBuffer({ force: false, reason: "block" });
                  }
                }
                return;
              }
              if (info.kind !== "final") return;
              // 发送回复到企业微信
              let deliveredFinalText = false;
              if (payload.text) {
                if (isAgentFailureText(payload.text)) {
                  api.logger.warn?.(`wecom: upstream returned failure-like payload: ${payload.text}`);
                  await sendFailureFallback(payload.text);
                  return;
                }

                api.logger.info?.(`wecom: delivering ${info.kind} reply, length=${payload.text.length}`);
                if (streamingEnabled) {
                  await flushStreamingBuffer({ force: true, reason: "final" });
                  await streamChunkSendChain;
                  if (streamChunkSentCount > 0) {
                    const finalText = markdownToWecomText(payload.text).trim();
                    const streamedText = markdownToWecomText(blockTextFallback).trim();
                    const tailText =
                      finalText && streamedText && finalText.startsWith(streamedText)
                        ? finalText.slice(streamedText.length).trim()
                        : "";
                    if (tailText) {
                      await sendWecomText({
                        corpId,
                        corpSecret,
                        agentId,
                        toUser: fromUser,
                        text: tailText,
                        logger: api.logger,
                        proxyUrl,
                      });
                    }
                    hasDeliveredReply = true;
                    deliveredFinalText = true;
                    api.logger.info?.(
                      `wecom: streaming reply completed for ${fromUser}, chunks=${streamChunkSentCount}${tailText ? " +tail" : ""}`,
                    );
                  }
                }

                // 应用 Markdown 转换
                if (!deliveredFinalText) {
                  const formattedReply = markdownToWecomText(payload.text);
                  const workspaceAutoMedia = await autoSendWorkspaceFilesFromReplyText({
                    text: formattedReply,
                    routeAgentId: routedAgentId,
                    corpId,
                    corpSecret,
                    agentId,
                    toUser: fromUser,
                    logger: api.logger,
                    proxyUrl,
                  });
                  const workspaceHints = [];
                  if (workspaceAutoMedia.sentCount > 0) {
                    workspaceHints.push(
                      `已按回复中的 /workspace 路径自动回传 ${workspaceAutoMedia.sentCount} 个文件。`,
                    );
                  }
                  if (workspaceAutoMedia.failed.length > 0) {
                    const failedPreview = workspaceAutoMedia.failed
                      .slice(0, 3)
                      .map((item) => `${item.workspacePath}（${String(item.reason ?? "失败").slice(0, 60)}）`)
                      .join("\n");
                    workspaceHints.push(`以下文件自动回传失败：\n${failedPreview}`);
                  }
                  const finalReplyText = [formattedReply, ...workspaceHints].filter(Boolean).join("\n\n");
                  await sendWecomText({
                    corpId,
                    corpSecret,
                    agentId,
                    toUser: fromUser,
                    text: finalReplyText,
                    logger: api.logger,
                    proxyUrl,
                  });
                  hasDeliveredReply = true;
                  deliveredFinalText = true;
                  api.logger.info?.(`wecom: sent AI reply to ${fromUser}: ${finalReplyText.slice(0, 50)}...`);
                }
              }

              if (payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0) {
                const mediaResult = await sendWecomOutboundMediaBatch({
                  corpId,
                  corpSecret,
                  agentId,
                  toUser: fromUser,
                  mediaUrl: payload.mediaUrl,
                  mediaUrls: payload.mediaUrls,
                  mediaType: payload.mediaType,
                  logger: api.logger,
                  proxyUrl,
                });
                if (mediaResult.sentCount > 0) {
                  hasDeliveredReply = true;
                }
                if (mediaResult.failed.length > 0 && mediaResult.sentCount > 0) {
                  await sendWecomText({
                    corpId,
                    corpSecret,
                    agentId,
                    toUser: fromUser,
                    text: `已回传 ${mediaResult.sentCount} 个媒体，另有 ${mediaResult.failed.length} 个失败。`,
                    logger: api.logger,
                    proxyUrl,
                  });
                }
                if (mediaResult.sentCount === 0 && !deliveredFinalText) {
                  await sendWecomText({
                    corpId,
                    corpSecret,
                    agentId,
                    toUser: fromUser,
                    text: "已收到模型返回的媒体结果，但媒体回传失败，请稍后重试。",
                    logger: api.logger,
                    proxyUrl,
                  });
                  hasDeliveredReply = true;
                }
              }
            },
            onError: async (err, info) => {
              if (suppressLateDispatcherDeliveries) return;
              api.logger.error?.(`wecom: ${info.kind} reply failed: ${String(err)}`);
              try {
                await sendFailureFallback(err);
              } catch (fallbackErr) {
                api.logger.error?.(`wecom: failed to send fallback reply: ${fallbackErr.message}`);
              }
            },
          },
          replyOptions: {
            // 企业微信不支持编辑消息；开启流式时会以“多条文本消息”模拟增量输出。
            disableBlockStreaming: !streamingEnabled,
            routeOverrides:
              routedAgentId && sessionId
                ? {
                    sessionKey: sessionId,
                    agentId: routedAgentId,
                    accountId: config.accountId || "default",
                  }
                : undefined,
          },
        }),
        replyTimeoutMs,
        `dispatch timed out after ${replyTimeoutMs}ms`,
      );

      if (streamingEnabled) {
        await flushStreamingBuffer({ force: true, reason: "post-dispatch" });
        await streamChunkSendChain;
      }

      if (!hasDeliveredReply && !hasDeliveredPartialReply) {
        const blockText = String(blockTextFallback || "").trim();
        if (blockText) {
          await sendWecomText({
            corpId,
            corpSecret,
            agentId,
            toUser: fromUser,
            text: markdownToWecomText(blockText),
            logger: api.logger,
            proxyUrl,
          });
          hasDeliveredReply = true;
          api.logger.info?.("wecom: delivered accumulated block reply as final fallback");
        }
      }

      if (!hasDeliveredReply && !hasDeliveredPartialReply) {
        const counts = dispatchResult?.counts ?? {};
        const queuedFinal = dispatchResult?.queuedFinal === true;
        const deliveredCount = Number(counts.final ?? 0) + Number(counts.block ?? 0) + Number(counts.tool ?? 0);
        if (!queuedFinal && deliveredCount === 0) {
          // 常见于同一会话已有活跃 run：当前消息被排队，暂无可立即发送的最终回复
          api.logger.warn?.("wecom: no immediate deliverable reply (likely queued behind active run)");
          await sendProgressNotice(queuedNoticeText);
          await startLateReplyWatcher("queued-no-final");
        } else {
          // 进入这里说明 dispatcher 有输出或已排队，但当前回调还没有拿到可立即下发的 final。
          // 自建应用不主动发处理中提示，仅转入异步补发观察。
          api.logger.warn?.(
            "wecom: dispatch finished without direct final delivery; waiting via late watcher",
          );
          await sendProgressNotice(processingNoticeText);
          await startLateReplyWatcher("dispatch-finished-without-final");
        }
      }
    } catch (dispatchErr) {
      api.logger.warn?.(`wecom: dispatch failed: ${String(dispatchErr)}`);
      if (isDispatchTimeoutError(dispatchErr)) {
        suppressLateDispatcherDeliveries = true;
        await sendProgressNotice(queuedNoticeText);
        await startLateReplyWatcher("dispatch-timeout");
      } else {
        await sendFailureFallback(dispatchErr);
      }
    } finally {
      if (progressNoticeTimer) clearTimeout(progressNoticeTimer);
      for (const filePath of tempPathsToCleanup) {
        scheduleTempFileCleanup(filePath, api.logger);
      }
    }

  } catch (err) {
    api.logger.error?.(`wecom: failed to process message: ${err.message}`);
    api.logger.error?.(`wecom: stack trace: ${err.stack}`);

    // 发送错误提示给用户
    try {
      await sendWecomText({
        corpId,
        corpSecret,
        agentId,
        toUser: fromUser,
        text: `抱歉，处理您的消息时出现错误，请稍后重试。\n错误: ${err.message?.slice(0, 100) || "未知错误"}`,
        logger: api.logger,
        proxyUrl,
      });
    } catch (sendErr) {
      api.logger.error?.(`wecom: failed to send error message: ${sendErr.message}`);
      api.logger.error?.(`wecom: send error stack: ${sendErr.stack}`);
      api.logger.error?.(`wecom: original error was: ${err.message}`);
    }
  }
  }


  return processInboundMessage;
}
