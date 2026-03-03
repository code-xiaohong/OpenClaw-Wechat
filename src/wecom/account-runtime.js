export function createWecomAccountRuntime({ wecomAccountRegistry, getGatewayRuntime } = {}) {
  if (!wecomAccountRegistry) {
    throw new Error("createWecomAccountRuntime: wecomAccountRegistry is required");
  }
  if (typeof getGatewayRuntime !== "function") {
    throw new Error("createWecomAccountRuntime: getGatewayRuntime is required");
  }

  function normalizeAccountId(accountId) {
    return wecomAccountRegistry.normalizeAccountId(accountId);
  }

  function getWecomConfig(api, accountId = null) {
    return wecomAccountRegistry.getWecomConfig({
      api,
      gatewayRuntime: getGatewayRuntime(),
      accountId,
    });
  }

  function listWecomAccountIds(api) {
    return wecomAccountRegistry.listWecomAccountIds({
      api,
      gatewayRuntime: getGatewayRuntime(),
    });
  }

  function listEnabledWecomAccounts(api) {
    return wecomAccountRegistry.listEnabledWecomAccounts({
      api,
      gatewayRuntime: getGatewayRuntime(),
    });
  }

  function listWebhookTargetAliases(accountConfig) {
    return wecomAccountRegistry.listWebhookTargetAliases(accountConfig);
  }

  function listAllWebhookTargetAliases(api) {
    return wecomAccountRegistry.listAllWebhookTargetAliases({
      api,
      gatewayRuntime: getGatewayRuntime(),
    });
  }

  function groupAccountsByWebhookPath(api) {
    return wecomAccountRegistry.groupAccountsByWebhookPath({
      api,
      gatewayRuntime: getGatewayRuntime(),
    });
  }

  return {
    normalizeAccountId,
    getWecomConfig,
    listWecomAccountIds,
    listEnabledWecomAccounts,
    listWebhookTargetAliases,
    listAllWebhookTargetAliases,
    groupAccountsByWebhookPath,
  };
}
