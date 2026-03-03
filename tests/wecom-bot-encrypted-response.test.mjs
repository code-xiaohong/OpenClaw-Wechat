import assert from "node:assert/strict";
import test from "node:test";

import { createWecomBotEncryptedResponseBuilder } from "../src/wecom/bot-encrypted-response.js";

test("buildWecomBotEncryptedResponse signs encrypted payload", () => {
  const { buildWecomBotEncryptedResponse } = createWecomBotEncryptedResponseBuilder({
    encryptWecom: ({ plainText }) => `enc:${plainText}`,
    computeMsgSignature: ({ encrypt, token, timestamp, nonce }) => `sig:${encrypt}:${token}:${timestamp}:${nonce}`,
  });

  const raw = buildWecomBotEncryptedResponse({
    token: "t1",
    aesKey: "k1",
    timestamp: "100",
    nonce: "n1",
    plainPayload: { ok: true },
  });

  const parsed = JSON.parse(raw);
  assert.equal(parsed.encrypt, 'enc:{"ok":true}');
  assert.equal(parsed.msgsignature, 'sig:enc:{"ok":true}:t1:100:n1');
  assert.equal(parsed.timestamp, "100");
  assert.equal(parsed.nonce, "n1");
});
