function assertFunction(name, fn) {
  if (typeof fn !== "function") {
    throw new Error(`createWecomBotEncryptedResponseBuilder: ${name} is required`);
  }
}

export function createWecomBotEncryptedResponseBuilder({ encryptWecom, computeMsgSignature } = {}) {
  assertFunction("encryptWecom", encryptWecom);
  assertFunction("computeMsgSignature", computeMsgSignature);

  function buildWecomBotEncryptedResponse({ token, aesKey, timestamp, nonce, plainPayload }) {
    const plainText = JSON.stringify(plainPayload ?? {});
    const encrypt = encryptWecom({
      aesKey,
      plainText,
      corpId: "",
    });
    const msgsignature = computeMsgSignature({
      token,
      timestamp,
      nonce,
      encrypt,
    });
    return JSON.stringify({
      encrypt,
      msgsignature,
      timestamp: String(timestamp ?? ""),
      nonce: String(nonce ?? ""),
    });
  }

  return {
    buildWecomBotEncryptedResponse,
  };
}
