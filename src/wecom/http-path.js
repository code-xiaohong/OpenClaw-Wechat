function normalizeHttpPathLike(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const noQuery = raw.split("?")[0].split("#")[0].trim();
  if (!noQuery) return "";
  const withLeadingSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  const dedupedSlash = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (dedupedSlash.length > 1 && dedupedSlash.endsWith("/")) {
    return dedupedSlash.slice(0, -1);
  }
  return dedupedSlash;
}

export function normalizePluginHttpPath(path, fallback = "/") {
  const normalized = normalizeHttpPathLike(path);
  if (normalized) return normalized;
  const normalizedFallback = normalizeHttpPathLike(fallback);
  return normalizedFallback || "/";
}
