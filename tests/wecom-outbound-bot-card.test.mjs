import assert from "node:assert/strict";
import test from "node:test";

import { buildWecomBotCardPayload } from "../src/wecom/outbound-bot-card.js";

test("buildWecomBotCardPayload returns null when disabled or media exists", () => {
  const disabled = buildWecomBotCardPayload({
    text: "hello",
    cardPolicy: { enabled: false },
  });
  assert.equal(disabled, null);

  const hasMedia = buildWecomBotCardPayload({
    text: "hello",
    cardPolicy: { enabled: true, mode: "markdown" },
    hasMedia: true,
  });
  assert.equal(hasMedia, null);
});

test("buildWecomBotCardPayload builds markdown payload", () => {
  const payload = buildWecomBotCardPayload({
    text: "这是正文",
    cardPolicy: {
      enabled: true,
      mode: "markdown",
      title: "标题",
      subtitle: "副标题",
      footer: "底部",
      maxContentLength: 1200,
    },
  });
  assert.equal(payload?.msgtype, "markdown");
  assert.match(String(payload?.markdown?.content ?? ""), /### 标题/);
  assert.match(String(payload?.markdown?.content ?? ""), /这是正文/);
});

test("buildWecomBotCardPayload builds template card payload", () => {
  const payload = buildWecomBotCardPayload({
    text: "这是正文",
    cardPolicy: {
      enabled: true,
      mode: "template_card",
      title: "标题",
      subtitle: "副标题",
      footer: "底部",
    },
  });
  assert.equal(payload?.msgtype, "template_card");
  assert.equal(payload?.template_card?.card_type, "text_notice");
  assert.equal(payload?.template_card?.main_title?.title, "标题");
  assert.equal(payload?.template_card?.main_title?.desc, "副标题");
  assert.equal(payload?.template_card?.quote_area?.quote_text, "底部");
});
