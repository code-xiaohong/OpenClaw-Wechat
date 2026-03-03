import { createWecomAgentMediaSender } from "./outbound-agent-media-sender.js";
import { createWecomWebhookOutboundSender } from "./outbound-webhook-sender.js";

export function createWecomOutboundSender({
  resolveWecomWebhookTargetConfig,
  resolveWebhookBotSendUrl,
  attachWecomProxyDispatcher,
  splitWecomText,
  webhookSendText,
  webhookSendImage,
  webhookSendFileBuffer,
  fetchImpl = fetch,
  sleep,
  normalizeOutboundMediaUrls,
  resolveWecomOutboundMediaTarget,
  fetchMediaFromUrl,
  buildTinyFileFallbackText,
  sendWecomText,
  uploadWecomMedia,
  sendWecomImage,
  sendWecomVideo,
  sendWecomVoice,
  sendWecomFile,
  createHash,
  minFileSize = 5,
} = {}) {
  const webhookSender = createWecomWebhookOutboundSender({
    resolveWecomWebhookTargetConfig,
    resolveWebhookBotSendUrl,
    attachWecomProxyDispatcher,
    splitWecomText,
    webhookSendText,
    webhookSendImage,
    webhookSendFileBuffer,
    normalizeOutboundMediaUrls,
    resolveWecomOutboundMediaTarget,
    fetchMediaFromUrl,
    createHash,
    sleep,
    fetchImpl,
  });

  const mediaSender = createWecomAgentMediaSender({
    normalizeOutboundMediaUrls,
    resolveWecomOutboundMediaTarget,
    fetchMediaFromUrl,
    buildTinyFileFallbackText,
    sendWecomText,
    uploadWecomMedia,
    sendWecomImage,
    sendWecomVideo,
    sendWecomVoice,
    sendWecomFile,
    minFileSize,
  });

  return {
    sendWecomWebhookText: webhookSender.sendWecomWebhookText,
    sendWecomWebhookMediaBatch: webhookSender.sendWecomWebhookMediaBatch,
    sendWecomOutboundMediaBatch: mediaSender.sendWecomOutboundMediaBatch,
  };
}
