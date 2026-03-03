export function createWecomRegisterRuntime({
  setGatewayRuntime,
  syncWecomSessionQueuePolicy,
  resolveWecomDeliveryFallbackPolicy,
  resolveWecomWebhookBotDeliveryPolicy,
  resolveWecomObservabilityPolicy,
  resolveWecomDynamicAgentPolicy,
  resolveWecomBotConfig,
  getWecomConfig,
  wecomChannelPlugin,
  wecomRouteRegistrar,
} = {}) {
  if (typeof setGatewayRuntime !== "function") {
    throw new Error("createWecomRegisterRuntime: setGatewayRuntime is required");
  }
  if (typeof syncWecomSessionQueuePolicy !== "function") {
    throw new Error("createWecomRegisterRuntime: syncWecomSessionQueuePolicy is required");
  }
  if (typeof resolveWecomDeliveryFallbackPolicy !== "function") {
    throw new Error("createWecomRegisterRuntime: resolveWecomDeliveryFallbackPolicy is required");
  }
  if (typeof resolveWecomWebhookBotDeliveryPolicy !== "function") {
    throw new Error("createWecomRegisterRuntime: resolveWecomWebhookBotDeliveryPolicy is required");
  }
  if (typeof resolveWecomObservabilityPolicy !== "function") {
    throw new Error("createWecomRegisterRuntime: resolveWecomObservabilityPolicy is required");
  }
  if (typeof resolveWecomDynamicAgentPolicy !== "function") {
    throw new Error("createWecomRegisterRuntime: resolveWecomDynamicAgentPolicy is required");
  }
  if (typeof resolveWecomBotConfig !== "function") {
    throw new Error("createWecomRegisterRuntime: resolveWecomBotConfig is required");
  }
  if (typeof getWecomConfig !== "function") {
    throw new Error("createWecomRegisterRuntime: getWecomConfig is required");
  }
  if (!wecomChannelPlugin || typeof wecomChannelPlugin !== "object") {
    throw new Error("createWecomRegisterRuntime: wecomChannelPlugin is required");
  }
  if (!wecomRouteRegistrar || typeof wecomRouteRegistrar !== "object") {
    throw new Error("createWecomRegisterRuntime: wecomRouteRegistrar is required");
  }

  function register(api) {
    setGatewayRuntime(api.runtime);
    const streamManagerPolicy = syncWecomSessionQueuePolicy(api);
    const fallbackPolicy = resolveWecomDeliveryFallbackPolicy(api);
    const webhookBotPolicy = resolveWecomWebhookBotDeliveryPolicy(api);
    const observabilityPolicy = resolveWecomObservabilityPolicy(api);
    const dynamicAgentPolicy = resolveWecomDynamicAgentPolicy(api);

    const botModeConfig = resolveWecomBotConfig(api);
    const cfg = getWecomConfig(api);
    if (cfg) {
      api.logger.info?.(
        `wecom: config loaded (corpId=${cfg.corpId?.slice(0, 8)}..., proxy=${cfg.outboundProxy ? "on" : "off"})`,
      );
    } else if (botModeConfig.enabled) {
      api.logger.info?.(
        `wecom(bot): config loaded (webhook=${botModeConfig.webhookPath}, streamExpireMs=${botModeConfig.streamExpireMs})`,
      );
    } else {
      api.logger.warn?.("wecom: no configuration found (check channels.wecom in openclaw.json)");
    }
    api.logger.info?.(
      `wecom: stream.manager ${streamManagerPolicy.enabled ? "on" : "off"} (timeoutMs=${streamManagerPolicy.timeoutMs}, perSession=${streamManagerPolicy.maxConcurrentPerSession})`,
    );
    api.logger.info?.(
      `wecom: delivery.fallback ${fallbackPolicy.enabled ? "on" : "off"} (order=${fallbackPolicy.order.join(">")})`,
    );
    if (webhookBotPolicy.enabled) {
      api.logger.info?.(
        `wecom: webhookBot fallback enabled (${webhookBotPolicy.url || webhookBotPolicy.key ? "configured" : "missing-url"})`,
      );
    }
    if (observabilityPolicy.enabled) {
      api.logger.info?.(
        `wecom: observability enabled (payloadMeta=${observabilityPolicy.logPayloadMeta ? "on" : "off"})`,
      );
    }
    if (dynamicAgentPolicy.enabled) {
      api.logger.info?.(
        `wecom: dynamic-agent on (mode=${dynamicAgentPolicy.mode}, userMap=${Object.keys(dynamicAgentPolicy.userMap || {}).length}, groupMap=${Object.keys(dynamicAgentPolicy.groupMap || {}).length}, mentionMap=${Object.keys(dynamicAgentPolicy.mentionMap || {}).length})`,
      );
    }

    api.registerChannel({ plugin: wecomChannelPlugin });
    const botRouteRegistered = wecomRouteRegistrar.registerWecomBotWebhookRoute(api);
    const webhookGroups = wecomRouteRegistrar.registerWecomAgentWebhookRoutes(api);
    if (webhookGroups.size === 0 && !botRouteRegistered) {
      api.logger.warn?.("wecom: no enabled account with valid config found; webhook route not registered");
      return;
    }
  }

  return {
    register,
  };
}
