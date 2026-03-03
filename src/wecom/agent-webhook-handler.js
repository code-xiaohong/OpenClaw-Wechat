export function createWecomAgentWebhookHandler({
  api,
  accounts,
  readRequestBody,
  parseIncomingXml,
  pickAccountBySignature,
  decryptWecom,
  markInboundMessageSeen,
  extractWecomXmlInboundEnvelope,
  buildWecomSessionId,
  scheduleTextInboundProcessing,
  messageProcessLimiter,
  executeInboundTaskWithSessionQueue,
  processInboundMessage,
} = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const msg_signature = url.searchParams.get("msg_signature") ?? "";
      const timestamp = url.searchParams.get("timestamp") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const echostr = url.searchParams.get("echostr") ?? "";
      const signedAccounts = accounts.filter((a) => a.callbackToken && a.callbackAesKey);

      if (req.method === "GET" && !echostr) {
        res.statusCode = signedAccounts.length > 0 ? 200 : 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(signedAccounts.length > 0 ? "wecom webhook ok" : "wecom webhook not configured");
        return;
      }

      if (signedAccounts.length === 0) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("WeCom plugin not configured (missing callbackToken/callbackAesKey)");
        return;
      }

      if (req.method === "GET") {
        const matchedAccount = pickAccountBySignature({
          accounts: signedAccounts,
          msgSignature: msg_signature,
          timestamp,
          nonce,
          encrypt: echostr,
        });
        if (!matchedAccount) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid signature");
          return;
        }

        const { msg: plainEchostr } = decryptWecom({
          aesKey: matchedAccount.callbackAesKey,
          cipherTextBase64: echostr,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(plainEchostr);
        api.logger.info?.(`wecom: verified callback URL for account=${matchedAccount.accountId}`);
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.end();
        return;
      }

      let encrypt = "";
      try {
        const rawXml = await readRequestBody(req);
        const incoming = parseIncomingXml(rawXml);
        encrypt = String(incoming?.Encrypt ?? "");
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid request body");
        api.logger.warn?.(`wecom: failed to parse callback body: ${String(err?.message || err)}`);
        return;
      }

      if (!encrypt) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Missing Encrypt");
        return;
      }

      const matchedAccount = pickAccountBySignature({
        accounts: signedAccounts,
        msgSignature: msg_signature,
        timestamp,
        nonce,
        encrypt,
      });
      if (!matchedAccount) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid signature");
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("success");

      let msgObj;
      try {
        const { msg: decryptedXml } = decryptWecom({
          aesKey: matchedAccount.callbackAesKey,
          cipherTextBase64: encrypt,
        });
        msgObj = parseIncomingXml(decryptedXml);
      } catch (err) {
        api.logger.error?.(`wecom: failed to decrypt payload for account=${matchedAccount.accountId}: ${String(err?.message || err)}`);
        return;
      }

      if (!markInboundMessageSeen(msgObj, matchedAccount.accountId)) {
        api.logger.info?.(`wecom: duplicate inbound skipped msgId=${msgObj?.MsgId ?? "n/a"}`);
        return;
      }

      const inbound = extractWecomXmlInboundEnvelope(msgObj);
      if (!inbound?.msgType) {
        api.logger.warn?.("wecom: inbound message missing MsgType, dropped");
        return;
      }

      const chatId = inbound.chatId || null;
      const isGroupChat = Boolean(chatId);
      const fromUser = inbound.fromUser;
      const msgType = inbound.msgType;
      const msgId = inbound.msgId;

      api.logger.info?.(
        `wecom inbound: account=${matchedAccount.accountId} from=${fromUser} msgType=${msgType} chatId=${chatId || "N/A"} content=${(inbound?.content ?? "").slice?.(0, 80)}`,
      );

      if (!fromUser) {
        api.logger.warn?.("wecom: inbound message missing FromUserName, dropped");
        return;
      }

      const basePayload = {
        api,
        accountId: matchedAccount.accountId,
        fromUser,
        chatId,
        isGroupChat,
        msgId,
      };
      const inboundSessionId = buildWecomSessionId(fromUser);

      if (msgType === "text" && inbound.content) {
        scheduleTextInboundProcessing(api, basePayload, inbound.content);
      } else if (msgType === "image" && inbound.mediaId) {
        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: inboundSessionId,
              isBot: false,
              task: () =>
                processInboundMessage({
                  ...basePayload,
                  mediaId: inbound.mediaId,
                  msgType: "image",
                  picUrl: inbound.picUrl,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom: async image processing failed: ${err.message}`);
          });
      } else if (msgType === "voice" && inbound.mediaId) {
        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: inboundSessionId,
              isBot: false,
              task: () =>
                processInboundMessage({
                  ...basePayload,
                  mediaId: inbound.mediaId,
                  msgType: "voice",
                  recognition: inbound.recognition,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom: async voice processing failed: ${err.message}`);
          });
      } else if (msgType === "video" && inbound.mediaId) {
        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: inboundSessionId,
              isBot: false,
              task: () =>
                processInboundMessage({
                  ...basePayload,
                  mediaId: inbound.mediaId,
                  msgType: "video",
                  thumbMediaId: inbound.thumbMediaId,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom: async video processing failed: ${err.message}`);
          });
      } else if (msgType === "file" && inbound.mediaId) {
        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: inboundSessionId,
              isBot: false,
              task: () =>
                processInboundMessage({
                  ...basePayload,
                  mediaId: inbound.mediaId,
                  msgType: "file",
                  fileName: inbound.fileName,
                  fileSize: inbound.fileSize,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom: async file processing failed: ${err.message}`);
          });
      } else if (msgType === "link") {
        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: inboundSessionId,
              isBot: false,
              task: () =>
                processInboundMessage({
                  ...basePayload,
                  msgType: "link",
                  linkTitle: inbound.linkTitle,
                  linkDescription: inbound.linkDescription,
                  linkUrl: inbound.linkUrl,
                  linkPicUrl: inbound.linkPicUrl,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom: async link processing failed: ${err.message}`);
          });
      } else {
        api.logger.info?.(`wecom: ignoring unsupported message type=${msgType}`);
      }
    } catch (err) {
      api.logger.error?.(`wecom: webhook handler failed: ${String(err?.message || err)}`);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal error");
      }
    }
  };
}

