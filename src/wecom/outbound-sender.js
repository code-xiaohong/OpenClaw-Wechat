export function createWecomOutboundSender({
  resolveWecomWebhookTargetConfig,
  resolveWebhookBotSendUrl,
  attachWecomProxyDispatcher,
  splitWecomText,
  webhookSendText,
  webhookSendImage,
  webhookSendFileBuffer,
  fetchImpl = fetch,
  sleep,
  normalizeOutboundMediaUrls,
  resolveWecomOutboundMediaTarget,
  fetchMediaFromUrl,
  buildTinyFileFallbackText,
  sendWecomText,
  uploadWecomMedia,
  sendWecomImage,
  sendWecomVideo,
  sendWecomVoice,
  sendWecomFile,
  createHash,
  minFileSize = 5,
} = {}) {
  if (typeof resolveWecomWebhookTargetConfig !== "function") {
    throw new Error("createWecomOutboundSender: resolveWecomWebhookTargetConfig is required");
  }
  if (typeof resolveWebhookBotSendUrl !== "function") {
    throw new Error("createWecomOutboundSender: resolveWebhookBotSendUrl is required");
  }
  if (typeof attachWecomProxyDispatcher !== "function") {
    throw new Error("createWecomOutboundSender: attachWecomProxyDispatcher is required");
  }
  if (typeof splitWecomText !== "function") {
    throw new Error("createWecomOutboundSender: splitWecomText is required");
  }
  if (typeof webhookSendText !== "function") {
    throw new Error("createWecomOutboundSender: webhookSendText is required");
  }
  if (typeof webhookSendImage !== "function") {
    throw new Error("createWecomOutboundSender: webhookSendImage is required");
  }
  if (typeof webhookSendFileBuffer !== "function") {
    throw new Error("createWecomOutboundSender: webhookSendFileBuffer is required");
  }
  if (typeof sleep !== "function") {
    throw new Error("createWecomOutboundSender: sleep is required");
  }
  if (typeof normalizeOutboundMediaUrls !== "function") {
    throw new Error("createWecomOutboundSender: normalizeOutboundMediaUrls is required");
  }
  if (typeof resolveWecomOutboundMediaTarget !== "function") {
    throw new Error("createWecomOutboundSender: resolveWecomOutboundMediaTarget is required");
  }
  if (typeof fetchMediaFromUrl !== "function") {
    throw new Error("createWecomOutboundSender: fetchMediaFromUrl is required");
  }
  if (typeof buildTinyFileFallbackText !== "function") {
    throw new Error("createWecomOutboundSender: buildTinyFileFallbackText is required");
  }
  if (typeof sendWecomText !== "function") {
    throw new Error("createWecomOutboundSender: sendWecomText is required");
  }
  if (typeof uploadWecomMedia !== "function") {
    throw new Error("createWecomOutboundSender: uploadWecomMedia is required");
  }
  if (typeof sendWecomImage !== "function") {
    throw new Error("createWecomOutboundSender: sendWecomImage is required");
  }
  if (typeof sendWecomVideo !== "function") {
    throw new Error("createWecomOutboundSender: sendWecomVideo is required");
  }
  if (typeof sendWecomVoice !== "function") {
    throw new Error("createWecomOutboundSender: sendWecomVoice is required");
  }
  if (typeof sendWecomFile !== "function") {
    throw new Error("createWecomOutboundSender: sendWecomFile is required");
  }
  if (typeof createHash !== "function") {
    throw new Error("createWecomOutboundSender: createHash is required");
  }

  async function sendWecomWebhookText({ webhook, webhookTargets, text, logger, proxyUrl }) {
    const target = resolveWecomWebhookTargetConfig(webhook, webhookTargets);
    if (!target) {
      throw new Error("invalid webhook target");
    }
    const sendUrl = resolveWebhookBotSendUrl({
      url: target.url,
      key: target.key,
    });
    if (!sendUrl) {
      throw new Error("invalid webhook target url/key");
    }
    const dispatcher = attachWecomProxyDispatcher(sendUrl, {}, { proxyUrl, logger })?.dispatcher;
    const chunks = splitWecomText(String(text ?? ""));
    for (let i = 0; i < chunks.length; i += 1) {
      await webhookSendText({
        url: target.url,
        key: target.key,
        content: chunks[i],
        timeoutMs: 15000,
        dispatcher,
        fetchImpl,
      });
      if (i < chunks.length - 1) {
        await sleep(200);
      }
    }
    logger?.info?.(`wecom: webhook text sent chunks=${chunks.length}`);
  }

  async function sendWecomWebhookMediaBatch({
    webhook,
    webhookTargets,
    mediaUrl,
    mediaUrls,
    mediaType,
    logger,
    proxyUrl,
    maxBytes = 20 * 1024 * 1024,
  } = {}) {
    const target = resolveWecomWebhookTargetConfig(webhook, webhookTargets);
    if (!target) {
      throw new Error("invalid webhook target");
    }
    const sendUrl = resolveWebhookBotSendUrl({
      url: target.url,
      key: target.key,
    });
    if (!sendUrl) {
      throw new Error("invalid webhook target url/key");
    }
    const dispatcher = attachWecomProxyDispatcher(sendUrl, {}, { proxyUrl, logger })?.dispatcher;
    const candidates = normalizeOutboundMediaUrls({ mediaUrl, mediaUrls });
    if (candidates.length === 0) {
      return { total: 0, sentCount: 0, failed: [] };
    }

    let sentCount = 0;
    const failed = [];
    for (const candidate of candidates) {
      try {
        const mediaTarget = resolveWecomOutboundMediaTarget({
          mediaUrl: candidate,
          mediaType: candidates.length === 1 ? mediaType : undefined,
        });
        const { buffer } = await fetchMediaFromUrl(candidate, {
          proxyUrl,
          logger,
          forceProxy: Boolean(proxyUrl),
          maxBytes,
        });
        if (mediaTarget.type === "image") {
          const base64 = buffer.toString("base64");
          const md5 = createHash("md5", buffer);
          await webhookSendImage({
            url: target.url,
            key: target.key,
            base64,
            md5,
            timeoutMs: 15000,
            dispatcher,
            fetchImpl,
          });
        } else {
          await webhookSendFileBuffer({
            url: target.url,
            key: target.key,
            buffer,
            filename: mediaTarget.filename,
            timeoutMs: 15000,
            dispatcher,
            fetchImpl,
          });
        }
        sentCount += 1;
      } catch (err) {
        failed.push({
          url: candidate,
          reason: String(err?.message || err),
        });
        logger?.warn?.(`wecom: webhook media send failed ${candidate}: ${String(err?.message || err)}`);
      }
    }
    return {
      total: candidates.length,
      sentCount,
      failed,
    };
  }

  async function sendWecomOutboundMediaBatch({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    mediaUrl,
    mediaUrls,
    mediaType,
    logger,
    proxyUrl,
    maxBytes = 20 * 1024 * 1024,
  } = {}) {
    const candidates = normalizeOutboundMediaUrls({ mediaUrl, mediaUrls });
    if (candidates.length === 0) {
      return { total: 0, sentCount: 0, failed: [] };
    }

    let sentCount = 0;
    const failed = [];

    for (const candidate of candidates) {
      try {
        const target = resolveWecomOutboundMediaTarget({
          mediaUrl: candidate,
          mediaType: candidates.length === 1 ? mediaType : undefined,
        });
        const { buffer } = await fetchMediaFromUrl(candidate, {
          proxyUrl,
          logger,
          forceProxy: Boolean(proxyUrl),
          maxBytes,
        });
        if (target.type === "file" && buffer.length < minFileSize) {
          const fallbackText = buildTinyFileFallbackText({
            fileName: target.filename,
            buffer,
          });
          await sendWecomText({
            corpId,
            corpSecret,
            agentId,
            toUser,
            toParty,
            toTag,
            chatId,
            text: fallbackText,
            logger,
            proxyUrl,
          });
          logger?.info?.(
            `wecom: tiny file fallback as text (${buffer.length} bytes) target=${candidate.slice(0, 120)}`,
          );
          sentCount += 1;
          continue;
        }
        const mediaId = await uploadWecomMedia({
          corpId,
          corpSecret,
          type: target.type === "voice" ? "voice" : target.type,
          buffer,
          filename: target.filename,
          logger,
          proxyUrl,
        });
        if (target.type === "image") {
          await sendWecomImage({
            corpId,
            corpSecret,
            agentId,
            toUser,
            toParty,
            toTag,
            chatId,
            mediaId,
            logger,
            proxyUrl,
          });
        } else if (target.type === "video") {
          await sendWecomVideo({
            corpId,
            corpSecret,
            agentId,
            toUser,
            toParty,
            toTag,
            chatId,
            mediaId,
            logger,
            proxyUrl,
          });
        } else if (target.type === "voice") {
          await sendWecomVoice({
            corpId,
            corpSecret,
            agentId,
            toUser,
            toParty,
            toTag,
            chatId,
            mediaId,
            logger,
            proxyUrl,
          });
        } else {
          await sendWecomFile({
            corpId,
            corpSecret,
            agentId,
            toUser,
            toParty,
            toTag,
            chatId,
            mediaId,
            logger,
            proxyUrl,
          });
        }
        sentCount += 1;
      } catch (err) {
        failed.push({
          url: candidate,
          reason: String(err?.message || err),
        });
        logger?.warn?.(`wecom: failed to send outbound media ${candidate}: ${String(err?.message || err)}`);
      }
    }

    return {
      total: candidates.length,
      sentCount,
      failed,
    };
  }

  return {
    sendWecomWebhookText,
    sendWecomWebhookMediaBatch,
    sendWecomOutboundMediaBatch,
  };
}
