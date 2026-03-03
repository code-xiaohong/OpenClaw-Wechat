export function createWecomTargetResolver({ resolveWecomTarget } = {}) {
  if (typeof resolveWecomTarget !== "function") {
    throw new Error("createWecomTargetResolver: resolveWecomTarget is required");
  }

  function normalizeWecomResolvedTarget(rawTarget) {
    if (rawTarget && typeof rawTarget === "object") {
      const toUser = String(rawTarget.toUser ?? "").trim();
      const toParty = String(rawTarget.toParty ?? "").trim();
      const toTag = String(rawTarget.toTag ?? "").trim();
      const chatId = String(rawTarget.chatId ?? "").trim();
      const webhook = String(rawTarget.webhook ?? "").trim();
      if (toUser || toParty || toTag || chatId || webhook) {
        return {
          ...(toUser ? { toUser } : {}),
          ...(toParty ? { toParty } : {}),
          ...(toTag ? { toTag } : {}),
          ...(chatId ? { chatId } : {}),
          ...(webhook ? { webhook } : {}),
        };
      }
    }
    const resolved = resolveWecomTarget(rawTarget);
    return resolved && typeof resolved === "object" ? resolved : null;
  }

  function formatWecomTargetForLog(target) {
    if (!target || typeof target !== "object") return "unknown";
    if (target.webhook) return `webhook:${target.webhook}`;
    if (target.chatId) return `chat:${target.chatId}`;
    const parts = [];
    if (target.toUser) parts.push(`user:${target.toUser}`);
    if (target.toParty) parts.push(`party:${target.toParty}`);
    if (target.toTag) parts.push(`tag:${target.toTag}`);
    return parts.join("|") || "unknown";
  }

  return {
    normalizeWecomResolvedTarget,
    formatWecomTargetForLog,
  };
}
