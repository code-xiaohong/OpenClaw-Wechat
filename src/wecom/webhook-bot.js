import crypto from "node:crypto";

const WEBHOOK_SEND_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send";
const WEBHOOK_UPLOAD_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media";

function resolveTimeout(timeoutMs, fallback = 15000) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function extractWebhookKey(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return String(parsed.searchParams.get("key") ?? "").trim();
  } catch {
    return "";
  }
}

export function resolveWebhookBotSendUrl({ url, key } = {}) {
  const explicitUrl = String(url ?? "").trim();
  if (explicitUrl) return explicitUrl;
  const webhookKey = String(key ?? "").trim();
  if (!webhookKey) return "";
  return `${WEBHOOK_SEND_URL}?key=${encodeURIComponent(webhookKey)}`;
}

async function postWebhookJson({
  url,
  body,
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const requestUrl = String(url ?? "").trim();
  if (!requestUrl) throw new Error("webhook url is required");
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(resolveTimeout(timeoutMs)),
  };
  if (dispatcher) {
    options.dispatcher = dispatcher;
  }
  const response = await fetchImpl(requestUrl, options);
  const responseText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseText || "{}");
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(`webhook request failed: ${response.status} ${response.statusText}`.trim());
  }
  const errcode = Number(parsed?.errcode ?? NaN);
  if (!Number.isFinite(errcode) || errcode !== 0) {
    throw new Error(`webhook rejected: errcode=${parsed?.errcode ?? "unknown"} errmsg=${parsed?.errmsg ?? ""}`.trim());
  }
  return parsed;
}

export async function webhookSendText({
  url,
  key,
  content,
  mentionedList,
  mentionedMobileList,
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const sendUrl = resolveWebhookBotSendUrl({ url, key });
  if (!sendUrl) throw new Error("missing webhook bot url/key");
  const body = {
    msgtype: "text",
    text: {
      content: String(content ?? ""),
      ...(Array.isArray(mentionedList) && mentionedList.length > 0 ? { mentioned_list: mentionedList } : {}),
      ...(Array.isArray(mentionedMobileList) && mentionedMobileList.length > 0
        ? { mentioned_mobile_list: mentionedMobileList }
        : {}),
    },
  };
  return postWebhookJson({
    url: sendUrl,
    body,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
}

export async function webhookSendMarkdown({
  url,
  key,
  content,
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const sendUrl = resolveWebhookBotSendUrl({ url, key });
  if (!sendUrl) throw new Error("missing webhook bot url/key");
  const body = {
    msgtype: "markdown",
    markdown: {
      content: String(content ?? ""),
    },
  };
  return postWebhookJson({
    url: sendUrl,
    body,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
}

export async function webhookSendImage({
  url,
  key,
  base64,
  md5,
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const sendUrl = resolveWebhookBotSendUrl({ url, key });
  if (!sendUrl) throw new Error("missing webhook bot url/key");
  const body = {
    msgtype: "image",
    image: {
      base64: String(base64 ?? ""),
      md5: String(md5 ?? ""),
    },
  };
  return postWebhookJson({
    url: sendUrl,
    body,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
}

export async function webhookUploadFile({
  url,
  key,
  buffer,
  filename = "file.bin",
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const sendUrl = resolveWebhookBotSendUrl({ url, key });
  if (!sendUrl) throw new Error("missing webhook bot url/key");
  const webhookKey = extractWebhookKey(sendUrl);
  if (!webhookKey) throw new Error("invalid webhook bot url: missing key");

  const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "");
  const boundary = `----OpenClawWebhookBoundary${crypto.randomBytes(12).toString("hex")}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="${filename}"; filelength=${fileBuffer.length}\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const multipartBody = Buffer.concat([header, fileBuffer, footer]);
  const uploadUrl = `${WEBHOOK_UPLOAD_URL}?key=${encodeURIComponent(webhookKey)}&type=file`;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(multipartBody.length),
    },
    body: multipartBody,
    signal: AbortSignal.timeout(resolveTimeout(timeoutMs)),
  };
  if (dispatcher) {
    options.dispatcher = dispatcher;
  }
  const response = await fetchImpl(uploadUrl, options);
  const responseText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseText || "{}");
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(`webhook upload failed: ${response.status} ${response.statusText}`.trim());
  }
  if (!parsed?.media_id) {
    throw new Error(`webhook upload rejected: errcode=${parsed?.errcode ?? "unknown"} errmsg=${parsed?.errmsg ?? ""}`);
  }
  return String(parsed.media_id);
}

export async function webhookSendFile({
  url,
  key,
  mediaId,
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const sendUrl = resolveWebhookBotSendUrl({ url, key });
  if (!sendUrl) throw new Error("missing webhook bot url/key");
  const body = {
    msgtype: "file",
    file: {
      media_id: String(mediaId ?? ""),
    },
  };
  return postWebhookJson({
    url: sendUrl,
    body,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
}

export async function webhookSendFileBuffer({
  url,
  key,
  buffer,
  filename = "file.bin",
  timeoutMs = 15000,
  dispatcher,
  fetchImpl = fetch,
} = {}) {
  const mediaId = await webhookUploadFile({
    url,
    key,
    buffer,
    filename,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
  return webhookSendFile({
    url,
    key,
    mediaId,
    timeoutMs,
    dispatcher,
    fetchImpl,
  });
}

