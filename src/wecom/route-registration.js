export function createWecomRouteRegistrar({
  resolveWecomBotConfig,
  normalizePluginHttpPath,
  ensureBotStreamCleanupTimer,
  cleanupExpiredBotStreams,
  createWecomBotWebhookHandler,
  createWecomAgentWebhookHandler,
  readRequestBody,
  parseIncomingJson,
  parseIncomingXml,
  pickAccountBySignature,
  decryptWecom,
  computeMsgSignature,
  parseWecomBotInboundMessage,
  describeWecomBotParsedMessage,
  markInboundMessageSeen,
  extractWecomXmlInboundEnvelope,
  buildWecomSessionId,
  buildWecomBotSessionId,
  buildWecomBotEncryptedResponse,
  createBotStream,
  getBotStream,
  upsertBotResponseUrlCache,
  messageProcessLimiter,
  executeInboundTaskWithSessionQueue,
  processBotInboundMessage,
  processInboundMessage,
  scheduleTextInboundProcessing,
  deliverBotReplyText,
  finishBotStream,
  groupAccountsByWebhookPath,
} = {}) {
  if (typeof resolveWecomBotConfig !== "function") throw new Error("createWecomRouteRegistrar: resolveWecomBotConfig is required");
  if (typeof normalizePluginHttpPath !== "function") {
    throw new Error("createWecomRouteRegistrar: normalizePluginHttpPath is required");
  }
  if (typeof ensureBotStreamCleanupTimer !== "function") {
    throw new Error("createWecomRouteRegistrar: ensureBotStreamCleanupTimer is required");
  }
  if (typeof cleanupExpiredBotStreams !== "function") {
    throw new Error("createWecomRouteRegistrar: cleanupExpiredBotStreams is required");
  }
  if (typeof createWecomBotWebhookHandler !== "function") {
    throw new Error("createWecomRouteRegistrar: createWecomBotWebhookHandler is required");
  }
  if (typeof createWecomAgentWebhookHandler !== "function") {
    throw new Error("createWecomRouteRegistrar: createWecomAgentWebhookHandler is required");
  }
  if (typeof groupAccountsByWebhookPath !== "function") {
    throw new Error("createWecomRouteRegistrar: groupAccountsByWebhookPath is required");
  }

  function registerWecomBotWebhookRoute(api) {
    const botConfig = resolveWecomBotConfig(api);
    if (!botConfig.enabled) return false;
    if (!botConfig.token || !botConfig.encodingAesKey) {
      api.logger.warn?.("wecom(bot): enabled but missing token/encodingAesKey; route not registered");
      return false;
    }

    const normalizedPath =
      normalizePluginHttpPath(botConfig.webhookPath ?? "/wecom/bot/callback", "/wecom/bot/callback") ??
      "/wecom/bot/callback";
    ensureBotStreamCleanupTimer(botConfig.streamExpireMs, api.logger);
    cleanupExpiredBotStreams(botConfig.streamExpireMs);

    const handler = createWecomBotWebhookHandler({
      api,
      botConfig,
      normalizedPath,
      readRequestBody,
      parseIncomingJson,
      computeMsgSignature,
      decryptWecom,
      parseWecomBotInboundMessage,
      describeWecomBotParsedMessage,
      cleanupExpiredBotStreams,
      getBotStream,
      buildWecomBotEncryptedResponse,
      markInboundMessageSeen,
      buildWecomBotSessionId,
      createBotStream,
      upsertBotResponseUrlCache,
      messageProcessLimiter,
      executeInboundTaskWithSessionQueue,
      processBotInboundMessage,
      deliverBotReplyText,
      finishBotStream,
    });

    api.registerHttpRoute({
      path: normalizedPath,
      auth: "plugin",
      handler,
    });

    api.logger.info?.(`wecom(bot): registered webhook at ${normalizedPath}`);
    return true;
  }

  function registerWecomAgentWebhookRoutes(api) {
    const webhookGroups = groupAccountsByWebhookPath(api);
    for (const [normalizedPath, accounts] of webhookGroups.entries()) {
      const handler = createWecomAgentWebhookHandler({
        api,
        accounts,
        readRequestBody,
        parseIncomingXml,
        pickAccountBySignature,
        decryptWecom,
        markInboundMessageSeen,
        extractWecomXmlInboundEnvelope,
        buildWecomSessionId,
        scheduleTextInboundProcessing,
        messageProcessLimiter,
        executeInboundTaskWithSessionQueue,
        processInboundMessage,
      });
      api.registerHttpRoute({
        path: normalizedPath,
        auth: "plugin",
        handler,
      });

      const accountIds = accounts.map((a) => a.accountId).join(", ");
      api.logger.info?.(`wecom: registered webhook at ${normalizedPath} (accounts=${accountIds})`);
    }
    return webhookGroups;
  }

  return {
    registerWecomBotWebhookRoute,
    registerWecomAgentWebhookRoutes,
  };
}
