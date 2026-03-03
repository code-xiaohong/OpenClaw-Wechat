function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`createWecomResponseUrlSender: ${name} is required`);
  }
}

export function createWecomResponseUrlSender({
  attachWecomProxyDispatcher,
  parseWecomResponseUrlResult,
  fetchImpl = fetch,
} = {}) {
  assertFunction("attachWecomProxyDispatcher", attachWecomProxyDispatcher);
  assertFunction("parseWecomResponseUrlResult", parseWecomResponseUrlResult);
  assertFunction("fetchImpl", fetchImpl);

  return async function sendWecomBotPayloadViaResponseUrl({
    responseUrl,
    payload,
    logger,
    proxyUrl,
    timeoutMs = 8000,
  }) {
    const normalizedUrl = String(responseUrl ?? "").trim();
    if (!normalizedUrl) {
      throw new Error("missing response_url");
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("missing response payload");
    }
    const requestOptions = attachWecomProxyDispatcher(
      normalizedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000)),
      },
      { proxyUrl, logger },
    );
    const response = await fetchImpl(normalizedUrl, requestOptions);
    const responseBody = await response.text().catch(() => "");
    const result = parseWecomResponseUrlResult(response, responseBody);
    if (!result.accepted) {
      throw new Error(
        `response_url rejected: status=${response.status} errcode=${result.errcode ?? "unknown"} errmsg=${result.errmsg || "n/a"}`,
      );
    }
    return {
      status: response.status,
      errcode: result.errcode,
    };
  };
}
