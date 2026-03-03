export function createWecomApiClient({
  fetchImpl = fetch,
  proxyAgentCtor,
  sleep,
  splitWecomText,
  getByteLength,
  apiLimiter,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("createWecomApiClient: fetchImpl is required");
  if (typeof proxyAgentCtor !== "function") throw new Error("createWecomApiClient: proxyAgentCtor is required");
  if (typeof sleep !== "function") throw new Error("createWecomApiClient: sleep is required");
  if (typeof splitWecomText !== "function") throw new Error("createWecomApiClient: splitWecomText is required");
  if (typeof getByteLength !== "function") throw new Error("createWecomApiClient: getByteLength is required");
  if (!apiLimiter || typeof apiLimiter.execute !== "function") {
    throw new Error("createWecomApiClient: apiLimiter.execute is required");
  }

  const accessTokenCaches = new Map();
  const proxyDispatcherCache = new Map();
  const invalidProxyCache = new Set();

  function isWecomApiUrl(url) {
    const raw = typeof url === "string" ? url : String(url ?? "");
    if (!raw) return false;
    try {
      const parsed = new URL(raw);
      return parsed.hostname === "qyapi.weixin.qq.com";
    } catch {
      return raw.includes("qyapi.weixin.qq.com");
    }
  }

  function isLikelyHttpProxyUrl(proxyUrl) {
    return /^https?:\/\/\S+$/i.test(proxyUrl);
  }

  function sanitizeProxyForLog(proxyUrl) {
    const raw = String(proxyUrl ?? "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password) {
        parsed.username = "***";
        parsed.password = "***";
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }

  function resolveWecomProxyDispatcher(proxyUrl, logger) {
    const normalized = String(proxyUrl ?? "").trim();
    if (!normalized) return null;
    const printableProxy = sanitizeProxyForLog(normalized);
    if (proxyDispatcherCache.has(normalized)) {
      return proxyDispatcherCache.get(normalized);
    }
    if (!isLikelyHttpProxyUrl(normalized)) {
      if (!invalidProxyCache.has(normalized)) {
        invalidProxyCache.add(normalized);
        logger?.warn?.(`wecom: outboundProxy ignored (invalid url): ${printableProxy}`);
      }
      return null;
    }
    try {
      const dispatcher = new proxyAgentCtor(normalized);
      proxyDispatcherCache.set(normalized, dispatcher);
      logger?.info?.(`wecom: outbound proxy enabled (${printableProxy})`);
      return dispatcher;
    } catch (err) {
      if (!invalidProxyCache.has(normalized)) {
        invalidProxyCache.add(normalized);
        logger?.warn?.(
          `wecom: outboundProxy init failed (${printableProxy}): ${String(err?.message || err)}`,
        );
      }
      return null;
    }
  }

  function attachWecomProxyDispatcher(url, options = {}, { proxyUrl, logger } = {}) {
    const shouldForceProxy = options?.forceProxy === true;
    if (!isWecomApiUrl(url) && !shouldForceProxy) return options;
    if (options?.dispatcher) return options;
    const dispatcher = resolveWecomProxyDispatcher(proxyUrl, logger);
    if (!dispatcher) return options;
    const { forceProxy, ...restOptions } = options || {};
    return {
      ...restOptions,
      dispatcher,
    };
  }

  async function fetchWithRetry(url, options = {}, maxRetries = 3, initialDelay = 1000, requestContext = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const requestOptions = attachWecomProxyDispatcher(url, options, requestContext);
        const res = await fetchImpl(url, requestOptions);

        if (!res.ok && attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.clone().json();
          if (json?.errcode === -1 && attempt < maxRetries) {
            const delay = initialDelay * Math.pow(2, attempt);
            await sleep(delay);
            continue;
          }
        }

        return res;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
      }
    }
    throw lastError || new Error(`Fetch failed after ${maxRetries} retries`);
  }

  async function getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger }) {
    const cacheKey = corpId;
    let cache = accessTokenCaches.get(cacheKey);

    if (!cache) {
      cache = { token: null, expiresAt: 0, refreshPromise: null };
      accessTokenCaches.set(cacheKey, cache);
    }

    const now = Date.now();
    if (cache.token && cache.expiresAt > now + 60000) {
      return cache.token;
    }

    if (cache.refreshPromise) {
      return cache.refreshPromise;
    }

    cache.refreshPromise = (async () => {
      try {
        const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
        const tokenRes = await fetchWithRetry(tokenUrl, {}, 3, 1000, { proxyUrl, logger });
        const tokenJson = await tokenRes.json();
        if (!tokenJson?.access_token) {
          throw new Error(`WeCom gettoken failed: ${JSON.stringify(tokenJson)}`);
        }
        cache.token = tokenJson.access_token;
        cache.expiresAt = Date.now() + (tokenJson.expires_in || 7200) * 1000;
        return cache.token;
      } finally {
        cache.refreshPromise = null;
      }
    })();

    return cache.refreshPromise;
  }

  function buildWecomMessageSendRequest({
    accessToken,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    msgType,
    payload,
  }) {
    const isAppChat = Boolean(chatId);
    if (!isAppChat && !toUser && !toParty && !toTag) {
      throw new Error("missing WeCom target: need toUser/toParty/toTag/chatId");
    }
    if (isAppChat) {
      return {
        sendUrl: `https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${encodeURIComponent(accessToken)}`,
        body: {
          chatid: chatId,
          msgtype: msgType,
          ...payload,
          safe: 0,
        },
        isAppChat,
      };
    }
    return {
      sendUrl: `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
      body: {
        touser: toUser,
        toparty: toParty,
        totag: toTag,
        msgtype: msgType,
        agentid: agentId,
        ...payload,
        safe: 0,
      },
      isAppChat,
    };
  }

  async function sendWecomTextSingle({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    text,
    logger,
    proxyUrl,
  }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const { sendUrl, body, isAppChat } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType: "text",
        payload: {
          text: { content: text },
        },
      });
      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        throw new Error(`WeCom ${isAppChat ? "appchat/send" : "message/send"} failed: ${JSON.stringify(sendJson)}`);
      }
      const targetLabel = isAppChat ? `chat:${chatId}` : [toUser, toParty, toTag].filter(Boolean).join("|");
      logger?.info?.(`wecom: message sent ok (to=${targetLabel || "unknown"}, msgid=${sendJson?.msgid || "n/a"})`);
      return sendJson;
    });
  }

  async function sendWecomText({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    text,
    logger,
    proxyUrl,
  }) {
    const chunks = splitWecomText(text);

    logger?.info?.(`wecom: splitting message into ${chunks.length} chunks, total bytes=${getByteLength(text)}`);

    for (let i = 0; i < chunks.length; i += 1) {
      logger?.info?.(`wecom: sending chunk ${i + 1}/${chunks.length}, bytes=${getByteLength(chunks[i])}`);
      await sendWecomTextSingle({
        corpId,
        corpSecret,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        text: chunks[i],
        logger,
        proxyUrl,
      });
      if (i < chunks.length - 1) {
        await sleep(300);
      }
    }
  }

  async function uploadWecomMedia({ corpId, corpSecret, type, buffer, filename, logger, proxyUrl }) {
    const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
    const uploadUrl = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=${encodeURIComponent(type)}`;

    const boundary = `----WecomMediaUpload${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    const res = await fetchWithRetry(
      uploadUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
      3,
      1000,
      { proxyUrl, logger },
    );

    const json = await res.json();
    if (json?.errcode !== 0) {
      throw new Error(`WeCom media upload failed: ${JSON.stringify(json)}`);
    }
    return json.media_id;
  }

  async function sendWecomImage({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const { sendUrl, body } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType: "image",
        payload: {
          image: { media_id: mediaId },
        },
      });

      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        throw new Error(`WeCom image send failed: ${JSON.stringify(sendJson)}`);
      }
      return sendJson;
    });
  }

  async function sendWecomVideo({
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    mediaId,
    title,
    description,
    logger,
    proxyUrl,
  }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const videoPayload = {
        media_id: mediaId,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      };
      const { sendUrl, body } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType: "video",
        payload: {
          video: videoPayload,
        },
      });
      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        throw new Error(`WeCom video send failed: ${JSON.stringify(sendJson)}`);
      }
      return sendJson;
    });
  }

  async function sendWecomFile({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const { sendUrl, body } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType: "file",
        payload: {
          file: { media_id: mediaId },
        },
      });
      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        throw new Error(`WeCom file send failed: ${JSON.stringify(sendJson)}`);
      }
      return sendJson;
    });
  }

  async function sendWecomVoice({ corpId, corpSecret, agentId, toUser, toParty, toTag, chatId, mediaId, logger, proxyUrl }) {
    return apiLimiter.execute(async () => {
      const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
      const { sendUrl, body } = buildWecomMessageSendRequest({
        accessToken,
        agentId,
        toUser,
        toParty,
        toTag,
        chatId,
        msgType: "voice",
        payload: {
          voice: { media_id: mediaId },
        },
      });
      const sendRes = await fetchWithRetry(
        sendUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        3,
        1000,
        { proxyUrl, logger },
      );
      const sendJson = await sendRes.json();
      if (sendJson?.errcode !== 0) {
        throw new Error(`WeCom voice send failed: ${JSON.stringify(sendJson)}`);
      }
      return sendJson;
    });
  }

  async function downloadWecomMedia({ corpId, corpSecret, mediaId, proxyUrl, logger }) {
    const accessToken = await getWecomAccessToken({ corpId, corpSecret, proxyUrl, logger });
    const mediaUrl = `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`;

    const res = await fetchWithRetry(mediaUrl, {}, 3, 1000, { proxyUrl, logger });
    if (!res.ok) {
      throw new Error(`Failed to download media: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      throw new Error(`WeCom media download failed: ${JSON.stringify(json)}`);
    }

    const buffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(buffer),
      contentType,
    };
  }

  return {
    attachWecomProxyDispatcher,
    fetchWithRetry,
    getWecomAccessToken,
    buildWecomMessageSendRequest,
    sendWecomText,
    uploadWecomMedia,
    sendWecomImage,
    sendWecomVideo,
    sendWecomFile,
    sendWecomVoice,
    downloadWecomMedia,
  };
}
