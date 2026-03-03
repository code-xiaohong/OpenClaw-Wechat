export function createWecomPolicyResolvers({
  getGatewayRuntime,
  normalizeAccountId,
  resolveWecomBotModeConfig,
  resolveWecomProxyConfig,
  resolveWecomCommandPolicyConfig,
  resolveWecomAllowFromPolicyConfig,
  resolveWecomGroupChatConfig,
  resolveWecomDebounceConfig,
  resolveWecomStreamingConfig,
  resolveWecomDeliveryFallbackConfig,
  resolveWecomWebhookBotDeliveryConfig,
  resolveWecomStreamManagerConfig,
  resolveWecomObservabilityConfig,
  resolveWecomDynamicAgentConfig,
  processEnv = process.env,
} = {}) {
  if (typeof getGatewayRuntime !== "function") {
    throw new Error("createWecomPolicyResolvers: getGatewayRuntime is required");
  }
  if (typeof normalizeAccountId !== "function") {
    throw new Error("createWecomPolicyResolvers: normalizeAccountId is required");
  }

  function resolveWecomPolicyInputs(api) {
    const cfg = api?.config ?? getGatewayRuntime()?.config ?? {};
    return {
      channelConfig: cfg?.channels?.wecom ?? {},
      envVars: cfg?.env?.vars ?? {},
      processEnv,
    };
  }

  function resolveWecomBotConfig(api) {
    return resolveWecomBotModeConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomBotProxyConfig(api) {
    const inputs = resolveWecomPolicyInputs(api);
    return resolveWecomProxyConfig({
      ...inputs,
      accountId: "bot",
      accountConfig: {},
    });
  }

  function resolveWecomCommandPolicy(api) {
    return resolveWecomCommandPolicyConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomAllowFromPolicy(api, accountId, accountConfig = {}) {
    const inputs = resolveWecomPolicyInputs(api);
    return resolveWecomAllowFromPolicyConfig({
      ...inputs,
      accountId: normalizeAccountId(accountId ?? "default"),
      accountConfig: accountConfig ?? {},
    });
  }

  function resolveWecomGroupChatPolicy(api) {
    return resolveWecomGroupChatConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomTextDebouncePolicy(api) {
    return resolveWecomDebounceConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomReplyStreamingPolicy(api) {
    return resolveWecomStreamingConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomDeliveryFallbackPolicy(api) {
    return resolveWecomDeliveryFallbackConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomWebhookBotDeliveryPolicy(api) {
    return resolveWecomWebhookBotDeliveryConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomStreamManagerPolicy(api) {
    return resolveWecomStreamManagerConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomObservabilityPolicy(api) {
    return resolveWecomObservabilityConfig(resolveWecomPolicyInputs(api));
  }

  function resolveWecomDynamicAgentPolicy(api) {
    return resolveWecomDynamicAgentConfig(resolveWecomPolicyInputs(api));
  }

  return {
    resolveWecomPolicyInputs,
    resolveWecomBotConfig,
    resolveWecomBotProxyConfig,
    resolveWecomCommandPolicy,
    resolveWecomAllowFromPolicy,
    resolveWecomGroupChatPolicy,
    resolveWecomTextDebouncePolicy,
    resolveWecomReplyStreamingPolicy,
    resolveWecomDeliveryFallbackPolicy,
    resolveWecomWebhookBotDeliveryPolicy,
    resolveWecomStreamManagerPolicy,
    resolveWecomObservabilityPolicy,
    resolveWecomDynamicAgentPolicy,
  };
}
