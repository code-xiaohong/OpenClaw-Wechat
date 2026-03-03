export function computeStreamingTailText({ finalText, streamedText } = {}) {
  const normalizedFinal = String(finalText ?? "").trim();
  const normalizedStreamed = String(streamedText ?? "").trim();
  if (!normalizedFinal || !normalizedStreamed) return "";
  if (!normalizedFinal.startsWith(normalizedStreamed)) return "";
  return normalizedFinal.slice(normalizedStreamed.length).trim();
}

export function buildWorkspaceAutoSendHints(workspaceAutoMedia = {}) {
  const hints = [];
  if ((workspaceAutoMedia?.sentCount ?? 0) > 0) {
    hints.push(`已按回复中的 /workspace 路径自动回传 ${workspaceAutoMedia.sentCount} 个文件。`);
  }
  if (Array.isArray(workspaceAutoMedia?.failed) && workspaceAutoMedia.failed.length > 0) {
    const failedPreview = workspaceAutoMedia.failed
      .slice(0, 3)
      .map((item) => `${item.workspacePath}（${String(item.reason ?? "失败").slice(0, 60)}）`)
      .join("\n");
    hints.push(`以下文件自动回传失败：\n${failedPreview}`);
  }
  return hints;
}
