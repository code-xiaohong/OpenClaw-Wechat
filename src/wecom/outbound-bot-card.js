function clampCardContent(text, maxLength = 1400) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "";
  const limit = Math.max(200, Number(maxLength) || 1400);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function buildMarkdownCardBody({
  title,
  subtitle,
  content,
  footer,
} = {}) {
  const sections = [];
  const normalizedTitle = String(title ?? "").trim();
  const normalizedSubtitle = String(subtitle ?? "").trim();
  const normalizedFooter = String(footer ?? "").trim();
  const normalizedContent = String(content ?? "").trim();

  if (normalizedTitle) {
    sections.push(`### ${normalizedTitle}`);
  }
  if (normalizedSubtitle) {
    sections.push(`> ${normalizedSubtitle}`);
  }
  if (normalizedContent) {
    sections.push(normalizedContent);
  }
  if (normalizedFooter) {
    sections.push(`> ${normalizedFooter}`);
  }
  return sections.join("\n\n").trim();
}

function buildTemplateCardBody({
  title,
  subtitle,
  content,
  footer,
} = {}) {
  const normalizedTitle = String(title ?? "").trim() || "OpenClaw-Wechat";
  const normalizedSubtitle = String(subtitle ?? "").trim();
  const normalizedContent = String(content ?? "").trim();
  const normalizedFooter = String(footer ?? "").trim();

  const payload = {
    msgtype: "template_card",
    template_card: {
      card_type: "text_notice",
      main_title: {
        title: normalizedTitle,
      },
      sub_title_text: normalizedContent,
    },
  };
  if (normalizedSubtitle) {
    payload.template_card.main_title.desc = normalizedSubtitle;
  }
  if (normalizedFooter) {
    payload.template_card.quote_area = {
      type: 0,
      quote_text: normalizedFooter,
    };
  }
  return payload;
}

export function buildWecomBotCardPayload({
  text = "",
  cardPolicy = {},
  hasMedia = false,
} = {}) {
  const enabled = cardPolicy?.enabled === true;
  if (!enabled || hasMedia) return null;

  const content = clampCardContent(text, cardPolicy?.maxContentLength);
  if (!content) return null;

  const mode = String(cardPolicy?.mode ?? "markdown").trim().toLowerCase();
  if (mode === "template_card") {
    return buildTemplateCardBody({
      title: cardPolicy?.title,
      subtitle: cardPolicy?.subtitle,
      content,
      footer: cardPolicy?.footer,
    });
  }

  const markdownContent = buildMarkdownCardBody({
    title: cardPolicy?.title,
    subtitle: cardPolicy?.subtitle,
    content,
    footer: cardPolicy?.footer,
  });
  if (!markdownContent) return null;
  return {
    msgtype: "markdown",
    markdown: {
      content: markdownContent,
    },
  };
}
