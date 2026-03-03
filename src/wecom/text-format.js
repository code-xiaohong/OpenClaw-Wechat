export function markdownToWecomText(markdown) {
  if (!markdown) return markdown;

  let text = markdown;

  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const lines = code.trim().split("\n").map((line) => `  ${line}`).join("\n");
    return lang ? `[${lang}]\n${lines}` : lines;
  });

  text = text.replace(/`([^`]+)`/g, "$1");

  text = text.replace(/^### (.+)$/gm, "▸ $1");
  text = text.replace(/^## (.+)$/gm, "■ $1");
  text = text.replace(/^# (.+)$/gm, "◆ $1");

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/___([^_]+)___/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  text = text.replace(/^[\*\-] /gm, "• ");
  text = text.replace(/^[-*_]{3,}$/gm, "────────────");
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
