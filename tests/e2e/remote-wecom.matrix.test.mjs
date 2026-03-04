import assert from "node:assert/strict";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { decryptWecomPayload, encryptWecomPayload } from "../../src/wecom/crypto-utils.js";

function pickFirstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function joinBaseUrl(baseUrl, path) {
  const safeBase = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const safePath = String(path ?? "").trim();
  if (!safeBase || !safePath) return "";
  return `${safeBase}${safePath.startsWith("/") ? safePath : `/${safePath}`}`;
}

function computeMsgSignature({ token, timestamp, nonce, encrypt }) {
  const payload = [token, timestamp, nonce, encrypt].map((item) => String(item ?? "")).sort().join("");
  return crypto.createHash("sha1").update(payload).digest("hex");
}

async function requestWebhook({ url, method = "GET", query = {}, jsonBody = null, timeoutMs = 15000 }) {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    endpoint.searchParams.set(key, String(value));
  }
  const response = await fetch(endpoint, {
    method,
    headers: jsonBody ? { "content-type": "application/json" } : undefined,
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 15000)),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    contentType: response.headers.get("content-type") || "",
  };
}

function decodeEncryptedJsonResponse({ rawText, aesKey, token }) {
  const payload = JSON.parse(rawText);
  assert.equal(typeof payload?.encrypt, "string");
  assert.equal(typeof payload?.msgsignature, "string");
  assert.equal(typeof payload?.timestamp, "string");
  assert.equal(typeof payload?.nonce, "string");

  const expectedSignature = computeMsgSignature({
    token,
    timestamp: payload.timestamp,
    nonce: payload.nonce,
    encrypt: payload.encrypt,
  });
  assert.equal(payload.msgsignature, expectedSignature);

  const decrypted = decryptWecomPayload({
    aesKey,
    cipherTextBase64: payload.encrypt,
  });
  return JSON.parse(decrypted.msg);
}

function createSignedEncryptedMessage({ token, aesKey, payload, signatureOverride = "" }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `mx${Math.random().toString(16).slice(2, 10)}`;
  const encrypt = encryptWecomPayload({
    aesKey,
    plainText: JSON.stringify(payload ?? {}),
    corpId: "",
  });
  return {
    timestamp,
    nonce,
    encrypt,
    signature: signatureOverride || computeMsgSignature({ token, timestamp, nonce, encrypt }),
  };
}

const matrixEnabled = pickFirstEnv("WECOM_E2E_MATRIX_ENABLE", "E2E_WECOM_MATRIX_ENABLE") === "1";
const baseUrl = pickFirstEnv("WECOM_E2E_BASE_URL", "E2E_WECOM_BASE_URL");
const botPath = pickFirstEnv("WECOM_E2E_BOT_PATH", "E2E_WECOM_WEBHOOK_PATH") || "/wecom/bot/callback";
const botUrl = pickFirstEnv("WECOM_E2E_BOT_URL") || joinBaseUrl(baseUrl, botPath);
const botToken = pickFirstEnv("WECOM_BOT_TOKEN", "WECOM_E2E_TOKEN", "E2E_WECOM_TOKEN");
const botAesKey = pickFirstEnv("WECOM_BOT_ENCODING_AES_KEY", "WECOM_E2E_ENCODING_AES_KEY", "E2E_WECOM_ENCODING_AES_KEY");
const timeoutMs = Number(pickFirstEnv("WECOM_E2E_MATRIX_TIMEOUT_MS", "WECOM_E2E_TIMEOUT_MS", "E2E_WECOM_STREAM_TIMEOUT_MS")) || 20000;
const pollCount = Number(pickFirstEnv("WECOM_E2E_MATRIX_POLL_COUNT", "WECOM_E2E_POLL_COUNT")) || 6;
const pollIntervalMs = Number(pickFirstEnv("WECOM_E2E_MATRIX_POLL_INTERVAL_MS", "WECOM_E2E_POLL_INTERVAL_MS")) || 900;

const skipReason = (() => {
  if (!matrixEnabled) return "matrix e2e disabled (set WECOM_E2E_MATRIX_ENABLE=1)";
  if (!botUrl) return "missing bot callback url (WECOM_E2E_BOT_URL or base+path)";
  if (!botToken) return "missing bot token (WECOM_BOT_TOKEN / E2E_WECOM_TOKEN)";
  if (!botAesKey) return "missing bot aes key (WECOM_BOT_ENCODING_AES_KEY / E2E_WECOM_ENCODING_AES_KEY)";
  return false;
})();

test(
  "matrix: health GET returns bot webhook status",
  { skip: skipReason },
  async () => {
    const res = await requestWebhook({
      url: botUrl,
      method: "GET",
      timeoutMs,
    });
    assert.ok([200, 500].includes(res.status), `unexpected status=${res.status}`);
    if (res.status === 200) {
      assert.match(res.text, /wecom bot webhook/i);
    }
  },
);

test(
  "matrix: GET verify succeeds with valid signature",
  { skip: skipReason },
  async () => {
    const plainEcho = `matrix-echostr-${Date.now()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `mx${Math.random().toString(16).slice(2, 10)}`;
    const echostr = encryptWecomPayload({
      aesKey: botAesKey,
      plainText: plainEcho,
      corpId: "",
    });
    const msg_signature = computeMsgSignature({
      token: botToken,
      timestamp,
      nonce,
      encrypt: echostr,
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "GET",
      query: {
        msg_signature,
        timestamp,
        nonce,
        echostr,
      },
      timeoutMs,
    });
    assert.equal(res.status, 200);
    assert.equal(res.text, plainEcho);
  },
);

test(
  "matrix: GET verify rejects invalid signature",
  { skip: skipReason },
  async () => {
    const echostr = encryptWecomPayload({
      aesKey: botAesKey,
      plainText: "matrix-invalid-signature",
      corpId: "",
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "GET",
      query: {
        msg_signature: "deadbeef",
        timestamp: String(Math.floor(Date.now() / 1000)),
        nonce: "mxdeadbeef",
        echostr,
      },
      timeoutMs,
    });
    assert.equal(res.status, 401);
    assert.match(res.text, /invalid signature/i);
  },
);

test(
  "matrix: POST rejects missing query params",
  { skip: skipReason },
  async () => {
    const signed = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload: {
        msgtype: "text",
        msgid: `mx-missing-${Date.now()}`,
        from: { userid: `mx-user-${Date.now().toString(36)}` },
        chattype: "single",
        text: { content: "/status" },
      },
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "POST",
      jsonBody: { encrypt: signed.encrypt },
      timeoutMs,
    });
    assert.equal(res.status, 400);
    assert.match(res.text, /missing/i);
  },
);

test(
  "matrix: POST rejects invalid signature",
  { skip: skipReason },
  async () => {
    const signed = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload: {
        msgtype: "text",
        msgid: `mx-invalid-${Date.now()}`,
        from: { userid: `mx-user-${Date.now().toString(36)}` },
        chattype: "single",
        text: { content: "/status" },
      },
      signatureOverride: "deadbeef",
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "POST",
      query: {
        msg_signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      },
      jsonBody: { encrypt: signed.encrypt },
      timeoutMs,
    });
    assert.equal(res.status, 401);
    assert.match(res.text, /invalid signature/i);
  },
);

test(
  "matrix: unsupported msgtype is acknowledged with success",
  { skip: skipReason },
  async () => {
    const signed = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload: {
        msgtype: "unknown_matrix_type",
        msgid: `mx-unsupported-${Date.now()}`,
        from: { userid: `mx-user-${Date.now().toString(36)}` },
        chattype: "single",
      },
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "POST",
      query: {
        msg_signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      },
      jsonBody: { encrypt: signed.encrypt },
      timeoutMs,
    });
    assert.equal(res.status, 200);
    assert.equal(res.text.trim().toLowerCase(), "success");
  },
);

test(
  "matrix: stream-refresh on unknown stream returns expired stream payload",
  { skip: skipReason },
  async () => {
    const streamId = `mx-missing-stream-${Date.now()}`;
    const signed = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload: {
        msgtype: "stream",
        stream: { id: streamId },
      },
    });
    const res = await requestWebhook({
      url: botUrl,
      method: "POST",
      query: {
        msg_signature: signed.signature,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
      },
      jsonBody: { encrypt: signed.encrypt },
      timeoutMs,
    });
    assert.equal(res.status, 200);
    const plain = decodeEncryptedJsonResponse({
      rawText: res.text,
      aesKey: botAesKey,
      token: botToken,
    });
    assert.equal(plain?.msgtype, "stream");
    assert.equal(plain?.stream?.id, streamId);
    assert.equal(plain?.stream?.finish, true);
    assert.equal(typeof plain?.stream?.content, "string");
  },
);

test(
  "matrix: text inbound returns stream and duplicate msgid is deduped",
  { skip: skipReason },
  async () => {
    const msgId = `mx-msg-${Date.now()}`;
    const userId = `mx-user-${Date.now().toString(36)}`;
    const payload = {
      msgtype: "text",
      msgid: msgId,
      from: { userid: userId },
      chattype: "single",
      text: { content: "/status" },
      response_url: "https://example.invalid/openclaw-wechat-matrix",
    };

    const firstSigned = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload,
    });
    const first = await requestWebhook({
      url: botUrl,
      method: "POST",
      query: {
        msg_signature: firstSigned.signature,
        timestamp: firstSigned.timestamp,
        nonce: firstSigned.nonce,
      },
      jsonBody: { encrypt: firstSigned.encrypt },
      timeoutMs,
    });
    assert.equal(first.status, 200);
    const firstPlain = decodeEncryptedJsonResponse({
      rawText: first.text,
      aesKey: botAesKey,
      token: botToken,
    });
    assert.equal(firstPlain?.msgtype, "stream");
    assert.equal(typeof firstPlain?.stream?.id, "string");
    assert.ok(firstPlain.stream.id.length > 0);
    assert.equal(firstPlain?.stream?.finish, false);

    const streamId = firstPlain.stream.id;

    const duplicateSigned = createSignedEncryptedMessage({
      token: botToken,
      aesKey: botAesKey,
      payload,
    });
    const duplicate = await requestWebhook({
      url: botUrl,
      method: "POST",
      query: {
        msg_signature: duplicateSigned.signature,
        timestamp: duplicateSigned.timestamp,
        nonce: duplicateSigned.nonce,
      },
      jsonBody: { encrypt: duplicateSigned.encrypt },
      timeoutMs,
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.text.trim().toLowerCase(), "success");

    let latestPlain = null;
    for (let i = 0; i < pollCount; i += 1) {
      if (i > 0) {
        // Avoid aggressive refresh spamming on remote deployments.
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }
      const refreshSigned = createSignedEncryptedMessage({
        token: botToken,
        aesKey: botAesKey,
        payload: {
          msgtype: "stream",
          stream: { id: streamId },
        },
      });
      // eslint-disable-next-line no-await-in-loop
      const refresh = await requestWebhook({
        url: botUrl,
        method: "POST",
        query: {
          msg_signature: refreshSigned.signature,
          timestamp: refreshSigned.timestamp,
          nonce: refreshSigned.nonce,
        },
        jsonBody: { encrypt: refreshSigned.encrypt },
        timeoutMs,
      });
      assert.equal(refresh.status, 200);
      latestPlain = decodeEncryptedJsonResponse({
        rawText: refresh.text,
        aesKey: botAesKey,
        token: botToken,
      });
      if (latestPlain?.stream?.finish === true) break;
    }
    assert.equal(latestPlain?.msgtype, "stream");
    assert.equal(latestPlain?.stream?.id, streamId);
    assert.equal(typeof latestPlain?.stream?.content, "string");
    assert.equal(typeof latestPlain?.stream?.finish, "boolean");
  },
);
