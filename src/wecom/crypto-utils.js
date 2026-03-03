import crypto from "node:crypto";

export function decodeWecomAesKey(aesKey) {
  const base64 = String(aesKey ?? "").endsWith("=") ? String(aesKey ?? "") : `${String(aesKey ?? "")}=`;
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error(`Invalid callbackAesKey: expected 32-byte key, got ${key.length}`);
  }
  return key;
}

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

function pkcs7Pad(buf, blockSize = 32) {
  const amountToPad = blockSize - (buf.length % blockSize || blockSize);
  const pad = Buffer.alloc(amountToPad === 0 ? blockSize : amountToPad, amountToPad === 0 ? blockSize : amountToPad);
  return Buffer.concat([buf, pad]);
}

export function decryptWecomPayload({ aesKey, cipherTextBase64 }) {
  const key = decodeWecomAesKey(aesKey);
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(cipherTextBase64, "base64")),
    decipher.final(),
  ]);
  const unpadded = pkcs7Unpad(plain);

  const msgLen = unpadded.readUInt32BE(16);
  const msgStart = 20;
  const msgEnd = msgStart + msgLen;
  const msg = unpadded.subarray(msgStart, msgEnd).toString("utf8");
  const corpId = unpadded.subarray(msgEnd).toString("utf8");
  return { msg, corpId };
}

export function decryptWecomMediaBuffer({ aesKey, encryptedBuffer }) {
  if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length === 0) {
    throw new Error("empty media buffer");
  }
  const key = decodeWecomAesKey(aesKey);
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  const padLen = decrypted[decrypted.length - 1];
  if (!Number.isFinite(padLen) || padLen < 1 || padLen > 32) {
    return decrypted;
  }
  for (let i = decrypted.length - padLen; i < decrypted.length; i += 1) {
    if (decrypted[i] !== padLen) return decrypted;
  }
  return decrypted.subarray(0, decrypted.length - padLen);
}

export function encryptWecomPayload({ aesKey, plainText, corpId = "" }) {
  const key = decodeWecomAesKey(aesKey);
  const iv = key.subarray(0, 16);
  const random16 = crypto.randomBytes(16);
  const msgBuffer = Buffer.from(String(plainText ?? ""), "utf8");
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32BE(msgBuffer.length, 0);
  const corpBuffer = Buffer.from(String(corpId ?? ""), "utf8");
  const raw = Buffer.concat([random16, lenBuffer, msgBuffer, corpBuffer]);
  const padded = pkcs7Pad(raw, 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

