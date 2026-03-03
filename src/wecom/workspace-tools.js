import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempFileCleanupScheduler({ unlinkImpl = unlink, defaultRetentionMs = 30 * 60 * 1000 } = {}) {
  function scheduleTempFileCleanup(filePath, logger, delayMs = defaultRetentionMs) {
    if (!filePath) return;
    const timer = setTimeout(() => {
      unlinkImpl(filePath).catch((err) => {
        logger?.warn?.(`wecom: failed to cleanup temp file ${filePath}: ${String(err?.message || err)}`);
      });
    }, delayMs);
    timer.unref?.();
  }

  return {
    scheduleTempFileCleanup,
  };
}

export function resolveOpenClawStateDir(cfg, { processEnv = process.env, tmpdirFn = tmpdir, joinFn = join } = {}) {
  const configured = String(cfg?.state?.dir ?? "").trim();
  if (configured) return configured;
  if (processEnv.OPENCLAW_STATE_DIR && String(processEnv.OPENCLAW_STATE_DIR).trim()) {
    return String(processEnv.OPENCLAW_STATE_DIR).trim();
  }
  const home = String(processEnv.HOME ?? "").trim();
  return home ? joinFn(home, ".openclaw", "state") : joinFn(tmpdirFn(), "openclaw-state");
}

export function resolveAgentWorkspaceDir(agentId, cfg, options = {}) {
  const normalizedAgentId = String(agentId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
  const stateDir = resolveOpenClawStateDir(cfg, options);
  const joinFn = options?.joinFn ?? join;
  return joinFn(stateDir, `workspace-${normalizedAgentId || "main"}`);
}

export function createDynamicWorkspaceSeeder({
  bootstrapTemplateFiles,
  seededAgentWorkspaces,
  resolveAgentWorkspaceDirFn = resolveAgentWorkspaceDir,
  readdirImpl = readdir,
  statImpl = stat,
  copyFileImpl = copyFile,
  mkdirImpl = mkdir,
  joinFn = join,
} = {}) {
  if (!(bootstrapTemplateFiles instanceof Set)) {
    throw new Error("createDynamicWorkspaceSeeder: bootstrapTemplateFiles Set is required");
  }
  if (!(seededAgentWorkspaces instanceof Set)) {
    throw new Error("createDynamicWorkspaceSeeder: seededAgentWorkspaces Set is required");
  }

  async function seedDynamicAgentWorkspace({ api, agentId, workspaceTemplate }) {
    const templateDir = String(workspaceTemplate ?? "").trim();
    const normalizedAgentId = String(agentId ?? "").trim().toLowerCase();
    if (!templateDir || !normalizedAgentId) return;

    const cacheKey = `${normalizedAgentId}::${templateDir}`;
    if (seededAgentWorkspaces.has(cacheKey)) return;

    let entries = [];
    try {
      entries = await readdirImpl(templateDir, { withFileTypes: true });
    } catch (err) {
      api?.logger?.warn?.(`wecom: workspaceTemplate unavailable (${templateDir}): ${String(err?.message || err)}`);
      return;
    }

    const workspaceDir = resolveAgentWorkspaceDirFn(normalizedAgentId, api?.config);
    await mkdirImpl(workspaceDir, { recursive: true });

    let copiedCount = 0;
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      const fileName = String(entry.name ?? "").trim();
      if (!bootstrapTemplateFiles.has(fileName)) continue;
      const sourcePath = joinFn(templateDir, fileName);
      const destPath = joinFn(workspaceDir, fileName);
      try {
        await statImpl(destPath);
        continue;
      } catch {
        // destination missing
      }
      await copyFileImpl(sourcePath, destPath);
      copiedCount += 1;
      api?.logger?.info?.(`wecom: seeded workspace file agent=${normalizedAgentId} file=${fileName}`);
    }

    seededAgentWorkspaces.add(cacheKey);
    if (copiedCount > 0) {
      api?.logger?.info?.(
        `wecom: workspace template seeded agent=${normalizedAgentId} files=${copiedCount} dir=${workspaceDir}`,
      );
    }
  }

  return {
    seedDynamicAgentWorkspace,
  };
}

export function createWorkspaceAutoSender({
  extractWorkspacePathsFromText,
  resolveWorkspacePathToHost,
  statImpl = stat,
  sendWecomOutboundMediaBatch,
} = {}) {
  if (typeof extractWorkspacePathsFromText !== "function") {
    throw new Error("createWorkspaceAutoSender: extractWorkspacePathsFromText is required");
  }
  if (typeof resolveWorkspacePathToHost !== "function") {
    throw new Error("createWorkspaceAutoSender: resolveWorkspacePathToHost is required");
  }
  if (typeof sendWecomOutboundMediaBatch !== "function") {
    throw new Error("createWorkspaceAutoSender: sendWecomOutboundMediaBatch is required");
  }

  async function autoSendWorkspaceFilesFromReplyText({
    text,
    routeAgentId,
    corpId,
    corpSecret,
    agentId,
    toUser,
    toParty,
    toTag,
    chatId,
    logger,
    proxyUrl,
    maxDetect = 6,
  } = {}) {
    const normalizedText = String(text ?? "");
    const normalizedRouteAgentId = String(routeAgentId ?? "").trim();
    if (!normalizedText || !normalizedRouteAgentId) {
      return {
        detectedCount: 0,
        matchedCount: 0,
        sentCount: 0,
        failed: [],
        sentPaths: [],
      };
    }

    const workspacePaths = extractWorkspacePathsFromText(normalizedText, maxDetect);
    if (workspacePaths.length === 0) {
      return {
        detectedCount: 0,
        matchedCount: 0,
        sentCount: 0,
        failed: [],
        sentPaths: [],
      };
    }

    const resolved = [];
    for (const workspacePath of workspacePaths) {
      const hostPath = resolveWorkspacePathToHost({
        workspacePath,
        agentId: normalizedRouteAgentId,
      });
      if (!hostPath) continue;
      try {
        const fileStat = await statImpl(hostPath);
        if (!fileStat.isFile()) continue;
        resolved.push({ workspacePath, hostPath });
      } catch {
        // ignore missing files
      }
    }

    if (resolved.length === 0) {
      return {
        detectedCount: workspacePaths.length,
        matchedCount: 0,
        sentCount: 0,
        failed: [],
        sentPaths: [],
      };
    }

    const mediaResult = await sendWecomOutboundMediaBatch({
      corpId,
      corpSecret,
      agentId,
      toUser,
      toParty,
      toTag,
      chatId,
      mediaUrls: resolved.map((item) => item.hostPath),
      logger,
      proxyUrl,
    });

    const failedByPath = new Map();
    for (const item of mediaResult.failed) {
      failedByPath.set(String(item?.url ?? ""), String(item?.reason ?? "unknown"));
    }

    const failed = [];
    const sentPaths = [];
    for (const item of resolved) {
      const failReason = failedByPath.get(item.hostPath);
      if (failReason) {
        failed.push({
          workspacePath: item.workspacePath,
          hostPath: item.hostPath,
          reason: failReason,
        });
      } else {
        sentPaths.push(item.workspacePath);
      }
    }

    if (sentPaths.length > 0) {
      logger?.info?.(
        `wecom: auto-sent workspace files agent=${normalizedRouteAgentId} sent=${sentPaths.length} detected=${workspacePaths.length}`,
      );
    }

    return {
      detectedCount: workspacePaths.length,
      matchedCount: resolved.length,
      sentCount: sentPaths.length,
      failed,
      sentPaths,
    };
  }

  return {
    autoSendWorkspaceFilesFromReplyText,
  };
}
