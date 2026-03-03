import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeWecomAesKey,
  decryptWecomPayload,
  encryptWecomPayload,
} from "../src/wecom/crypto-utils.js";

test("wecom crypto payload roundtrip works", () => {
  const aesKey = Buffer.alloc(32, 7).toString("base64").replace(/=+$/g, "");
  const plainText = JSON.stringify({ hello: "world", at: Date.now() });
  const corpId = "ww-test-corp";

  const encrypted = encryptWecomPayload({ aesKey, plainText, corpId });
  const decrypted = decryptWecomPayload({ aesKey, cipherTextBase64: encrypted });

  assert.equal(decrypted.msg, plainText);
  assert.equal(decrypted.corpId, corpId);
});

test("decodeWecomAesKey validates key length", () => {
  assert.throws(() => decodeWecomAesKey("short-key"), /Invalid callbackAesKey/);
});

