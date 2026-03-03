export function createWecomSessionQueueManager({
  WecomSessionTaskQueue,
  resolveWecomStreamManagerPolicy,
  setBotStreamExpireMs,
  initialMaxConcurrentPerSession = 1,
} = {}) {
  if (typeof WecomSessionTaskQueue !== "function") {
    throw new Error("createWecomSessionQueueManager: WecomSessionTaskQueue is required");
  }
  if (typeof resolveWecomStreamManagerPolicy !== "function") {
    throw new Error("createWecomSessionQueueManager: resolveWecomStreamManagerPolicy is required");
  }
  if (typeof setBotStreamExpireMs !== "function") {
    throw new Error("createWecomSessionQueueManager: setBotStreamExpireMs is required");
  }

  const botSessionTaskQueue = new WecomSessionTaskQueue({
    maxConcurrentPerSession: initialMaxConcurrentPerSession,
  });
  const wecomSessionTaskQueue = new WecomSessionTaskQueue({
    maxConcurrentPerSession: initialMaxConcurrentPerSession,
  });

  function syncWecomSessionQueuePolicy(api) {
    const policy = resolveWecomStreamManagerPolicy(api);
    wecomSessionTaskQueue.setMaxConcurrentPerSession(policy.maxConcurrentPerSession);
    botSessionTaskQueue.setMaxConcurrentPerSession(policy.maxConcurrentPerSession);
    setBotStreamExpireMs(policy.timeoutMs);
    return policy;
  }

  function executeInboundTaskWithSessionQueue({ api, sessionId, isBot = false, task }) {
    const policy = syncWecomSessionQueuePolicy(api);
    if (!policy.enabled) {
      return task();
    }
    const queue = isBot ? botSessionTaskQueue : wecomSessionTaskQueue;
    return queue.enqueue(sessionId, task);
  }

  return {
    syncWecomSessionQueuePolicy,
    executeInboundTaskWithSessionQueue,
    botSessionTaskQueue,
    wecomSessionTaskQueue,
  };
}
