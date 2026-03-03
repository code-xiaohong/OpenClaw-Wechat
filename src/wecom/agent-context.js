export function buildWecomInboundEnvelopePayload({
  fromUser,
  chatId,
  isGroupChat,
  messageText,
  timestamp = Date.now(),
} = {}) {
  return {
    channel: "WeCom",
    from: isGroupChat && chatId ? `${fromUser} (group:${chatId})` : fromUser,
    timestamp,
    body: messageText,
    chatType: isGroupChat ? "group" : "direct",
    sender: {
      name: fromUser,
      id: fromUser,
    },
  };
}

export function buildWecomInboundContextPayload({
  body,
  messageText,
  originalContent,
  commandBody,
  fromAddress,
  sessionId,
  accountId,
  isGroupChat,
  chatId,
  fromUser,
  msgId,
  timestamp = Date.now(),
} = {}) {
  return {
    Body: body,
    BodyForAgent: messageText,
    RawBody: originalContent,
    CommandBody: commandBody,
    From: fromAddress,
    To: fromAddress,
    SessionKey: sessionId,
    AccountId: accountId || "default",
    ChatType: isGroupChat ? "group" : "direct",
    ConversationLabel: isGroupChat && chatId ? `group:${chatId}` : fromUser,
    SenderName: fromUser,
    SenderId: fromUser,
    Provider: "wecom",
    Surface: "wecom",
    MessageSid: msgId || `wecom-${timestamp}`,
    Timestamp: timestamp,
    OriginatingChannel: "wecom",
    OriginatingTo: fromAddress,
  };
}
