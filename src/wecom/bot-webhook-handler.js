import crypto from "node:crypto";

export function createWecomBotWebhookHandler({
  api,
  botConfig,
  normalizedPath,
  readRequestBody,
  parseIncomingJson,
  computeMsgSignature,
  decryptWecom,
  parseWecomBotInboundMessage,
  describeWecomBotParsedMessage,
  cleanupExpiredBotStreams,
  getBotStream,
  buildWecomBotEncryptedResponse,
  markInboundMessageSeen,
  buildWecomBotSessionId,
  createBotStream,
  upsertBotResponseUrlCache,
  messageProcessLimiter,
  executeInboundTaskWithSessionQueue,
  processBotInboundMessage,
  deliverBotReplyText,
  finishBotStream,
} = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const msg_signature = url.searchParams.get("msg_signature") ?? "";
      const timestamp = url.searchParams.get("timestamp") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const echostr = url.searchParams.get("echostr") ?? "";

      if (req.method === "GET" && !echostr) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("wecom bot webhook ok");
        return;
      }

      if (req.method === "GET") {
        if (!msg_signature || !timestamp || !nonce || !echostr) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Missing query params");
          return;
        }
        const expected = computeMsgSignature({
          token: botConfig.token,
          timestamp,
          nonce,
          encrypt: echostr,
        });
        if (expected !== msg_signature) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid signature");
          return;
        }
        const { msg: plainEchostr } = decryptWecom({
          aesKey: botConfig.encodingAesKey,
          cipherTextBase64: echostr,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(plainEchostr);
        api.logger.info?.(`wecom(bot): verified callback URL at ${normalizedPath}`);
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.end();
        return;
      }

      let encryptedBody = "";
      try {
        const rawBody = await readRequestBody(req);
        const parsedBody = parseIncomingJson(rawBody);
        encryptedBody = String(parsedBody?.encrypt ?? "").trim();
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid request body");
        api.logger.warn?.(`wecom(bot): failed to parse callback body: ${String(err?.message || err)}`);
        return;
      }

      if (!msg_signature || !timestamp || !nonce || !encryptedBody) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Missing required params");
        return;
      }

      const expected = computeMsgSignature({
        token: botConfig.token,
        timestamp,
        nonce,
        encrypt: encryptedBody,
      });
      if (expected !== msg_signature) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid signature");
        return;
      }

      let incomingPayload = null;
      try {
        const { msg: decryptedPayload } = decryptWecom({
          aesKey: botConfig.encodingAesKey,
          cipherTextBase64: encryptedBody,
        });
        incomingPayload = parseIncomingJson(decryptedPayload);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Decrypt failed");
        api.logger.warn?.(`wecom(bot): failed to decrypt payload: ${String(err?.message || err)}`);
        return;
      }

      const parsed = parseWecomBotInboundMessage(incomingPayload);
      api.logger.info?.(`wecom(bot): inbound ${describeWecomBotParsedMessage(parsed)}`);
      if (!parsed) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");
        return;
      }

      if (parsed.kind === "stream-refresh") {
        cleanupExpiredBotStreams(botConfig.streamExpireMs);
        const streamId = parsed.streamId || `stream-${Date.now()}`;
        const stream = getBotStream(streamId);
        const feedbackId = String(parsed.feedbackId || stream?.feedbackId || "").trim();
        const streamPayload = {
          id: streamId,
          content: stream?.content ?? "会话已过期",
          finish: stream ? stream.finished === true : true,
        };
        if (Array.isArray(stream?.msgItem) && stream.msgItem.length > 0) {
          streamPayload.msg_item = stream.msgItem;
        }
        if (feedbackId) {
          streamPayload.feedback = { id: feedbackId };
        }
        const plainPayload = {
          msgtype: "stream",
          stream: streamPayload,
        };
        const encryptedResponse = buildWecomBotEncryptedResponse({
          token: botConfig.token,
          aesKey: botConfig.encodingAesKey,
          timestamp,
          nonce,
          plainPayload,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(encryptedResponse);
        return;
      }

      if (parsed.kind === "event") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");
        return;
      }

      if (parsed.kind === "unsupported" || parsed.kind === "invalid") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");
        return;
      }

      if (parsed.kind === "message") {
        const dedupeStub = {
          MsgId: parsed.msgId,
          FromUserName: parsed.fromUser,
          MsgType: parsed.msgType,
          Content: parsed.content,
          CreateTime: String(Math.floor(Date.now() / 1000)),
        };
        if (!markInboundMessageSeen(dedupeStub, "bot")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("success");
          return;
        }

        const botSessionId = buildWecomBotSessionId(parsed.fromUser);
        const streamId = `stream_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
        const feedbackId = String(parsed.feedbackId ?? "").trim();
        createBotStream(streamId, botConfig.placeholderText, {
          feedbackId,
          sessionId: botSessionId,
        });
        if (parsed.responseUrl) {
          upsertBotResponseUrlCache({
            sessionId: botSessionId,
            responseUrl: parsed.responseUrl,
          });
        }
        const initialStreamPayload = {
          id: streamId,
          content: botConfig.placeholderText,
          finish: false,
        };
        if (feedbackId) {
          initialStreamPayload.feedback = { id: feedbackId };
        }
        const encryptedResponse = buildWecomBotEncryptedResponse({
          token: botConfig.token,
          aesKey: botConfig.encodingAesKey,
          timestamp,
          nonce,
          plainPayload: {
            msgtype: "stream",
            stream: initialStreamPayload,
          },
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(encryptedResponse);

        messageProcessLimiter
          .execute(() =>
            executeInboundTaskWithSessionQueue({
              api,
              sessionId: botSessionId,
              isBot: true,
              task: () =>
                processBotInboundMessage({
                  api,
                  streamId,
                  fromUser: parsed.fromUser,
                  content: parsed.content,
                  msgType: parsed.msgType,
                  msgId: parsed.msgId,
                  chatId: parsed.chatId,
                  isGroupChat: parsed.isGroupChat,
                  imageUrls: parsed.imageUrls,
                  fileUrl: parsed.fileUrl,
                  fileName: parsed.fileName,
                  quote: parsed.quote,
                  responseUrl: parsed.responseUrl,
                }),
            }),
          )
          .catch((err) => {
            api.logger.error?.(`wecom(bot): async message processing failed: ${String(err?.message || err)}`);
            deliverBotReplyText({
              api,
              fromUser: parsed.fromUser,
              sessionId: botSessionId,
              streamId,
              responseUrl: parsed.responseUrl,
              text: `抱歉，当前模型请求失败，请稍后重试。\n故障信息: ${String(err?.message || err).slice(0, 160)}`,
              reason: "bot-async-processing-error",
            }).catch((deliveryErr) => {
              api.logger.warn?.(`wecom(bot): failed to deliver async error reply: ${String(deliveryErr?.message || deliveryErr)}`);
              finishBotStream(
                streamId,
                `抱歉，当前模型请求失败，请稍后重试。\n故障信息: ${String(err?.message || err).slice(0, 160)}`,
              );
            });
          });
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("success");
    } catch (err) {
      api.logger.error?.(`wecom(bot): webhook handler failed: ${String(err?.message || err)}`);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal error");
      }
    }
  };
}

