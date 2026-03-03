function assertFunction(name, fn) {
  if (typeof fn !== "function") {
    throw new Error(`createWecomChannelPlugin: ${name} is required`);
  }
}

export function createWecomChannelPlugin({
  listWecomAccountIds,
  getWecomConfig,
  getGatewayRuntime,
  normalizeWecomResolvedTarget,
  formatWecomTargetForLog,
  sendWecomWebhookText,
  sendWecomWebhookMediaBatch,
  sendWecomOutboundMediaBatch,
  sendWecomText,
} = {}) {
  assertFunction("listWecomAccountIds", listWecomAccountIds);
  assertFunction("getWecomConfig", getWecomConfig);
  assertFunction("getGatewayRuntime", getGatewayRuntime);
  assertFunction("normalizeWecomResolvedTarget", normalizeWecomResolvedTarget);
  assertFunction("formatWecomTargetForLog", formatWecomTargetForLog);
  assertFunction("sendWecomWebhookText", sendWecomWebhookText);
  assertFunction("sendWecomWebhookMediaBatch", sendWecomWebhookMediaBatch);
  assertFunction("sendWecomOutboundMediaBatch", sendWecomOutboundMediaBatch);
  assertFunction("sendWecomText", sendWecomText);

  return {
    id: "wecom",
    meta: {
      id: "wecom",
      label: "WeCom",
      selectionLabel: "WeCom (企业微信自建应用)",
      docsPath: "/channels/wecom",
      blurb: "Enterprise WeChat internal app via callback + send API.",
      aliases: ["wework", "qiwei", "wxwork"],
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      media: {
        inbound: true,
        outbound: true,
      },
      markdown: true,
    },
    config: {
      listAccountIds: (cfg) => listWecomAccountIds({ config: cfg }),
      resolveAccount: (cfg, accountId) =>
        (getWecomConfig({ config: cfg }, accountId ?? "default") ?? {
          accountId: accountId ?? "default",
        }),
    },
    outbound: {
      deliveryMode: "direct",
      resolveTarget: ({ to }) => {
        const target = normalizeWecomResolvedTarget(to);
        if (!target) return { ok: false, error: new Error("WeCom requires --to <target>") };
        return { ok: true, to: target };
      },
      sendText: async ({ to, text, accountId }) => {
        const runtime = getGatewayRuntime();
        const target = normalizeWecomResolvedTarget(to);
        if (!target) {
          return { ok: false, error: new Error("WeCom target invalid") };
        }
        const config = getWecomConfig({ config: runtime?.config }, accountId);
        if (target.webhook) {
          await sendWecomWebhookText({
            webhook: target.webhook,
            webhookTargets: config?.webhooks,
            text,
            logger: runtime?.logger,
            proxyUrl: config?.outboundProxy,
          });
          runtime?.logger?.info?.(`wecom: outbound sendText target=${formatWecomTargetForLog(target)}`);
          return { ok: true, provider: "wecom-webhook" };
        }
        if (!config?.corpId || !config?.corpSecret || !config?.agentId) {
          return { ok: false, error: new Error("WeCom not configured (check channels.wecom in openclaw.json)") };
        }
        await sendWecomText({
          corpId: config.corpId,
          corpSecret: config.corpSecret,
          agentId: config.agentId,
          toUser: target.toUser,
          toParty: target.toParty,
          toTag: target.toTag,
          chatId: target.chatId,
          text,
          logger: runtime?.logger,
          proxyUrl: config.outboundProxy,
        });
        runtime?.logger?.info?.(`wecom: outbound sendText target=${formatWecomTargetForLog(target)}`);
        return { ok: true, provider: "wecom" };
      },
    },
    inbound: {
      deliverReply: async ({ to, text, accountId, mediaUrl, mediaUrls, mediaType }) => {
        const runtime = getGatewayRuntime();
        const target = normalizeWecomResolvedTarget(to);
        if (!target) {
          throw new Error("WeCom deliverReply target invalid");
        }
        const config = getWecomConfig({ config: runtime?.config }, accountId);
        const proxyUrl = config?.outboundProxy;
        if (target.webhook) {
          const webhookMediaResult = await sendWecomWebhookMediaBatch({
            webhook: target.webhook,
            webhookTargets: config?.webhooks,
            mediaUrl,
            mediaUrls,
            mediaType,
            logger: runtime?.logger,
            proxyUrl,
          });
          if (webhookMediaResult.failed.length > 0) {
            runtime?.logger?.warn?.(
              `wecom: webhook target failed to send ${webhookMediaResult.failed.length} media item(s)`,
            );
          }
          if (text) {
            await sendWecomWebhookText({
              webhook: target.webhook,
              webhookTargets: config?.webhooks,
              text,
              logger: runtime?.logger,
              proxyUrl,
            });
          }
          if (!text && webhookMediaResult.total > 0 && webhookMediaResult.sentCount === 0) {
            throw new Error("WeCom webhook media send failed");
          }
          return { ok: true };
        }
        if (!config?.corpId || !config?.corpSecret || !config?.agentId) {
          throw new Error("WeCom not configured (check channels.wecom in openclaw.json)");
        }
        const mediaResult = await sendWecomOutboundMediaBatch({
          corpId: config.corpId,
          corpSecret: config.corpSecret,
          agentId: config.agentId,
          toUser: target.toUser,
          toParty: target.toParty,
          toTag: target.toTag,
          chatId: target.chatId,
          mediaUrl,
          mediaUrls,
          mediaType,
          logger: runtime?.logger,
          proxyUrl,
        });
        if (mediaResult.failed.length > 0) {
          runtime?.logger?.warn?.(`wecom: failed to send ${mediaResult.failed.length} outbound media item(s)`);
        }
        if (text) {
          await sendWecomText({
            corpId: config.corpId,
            corpSecret: config.corpSecret,
            agentId: config.agentId,
            toUser: target.toUser,
            toParty: target.toParty,
            toTag: target.toTag,
            chatId: target.chatId,
            text,
            logger: runtime?.logger,
            proxyUrl,
          });
        }
        return { ok: true };
      },
    },
  };
}
