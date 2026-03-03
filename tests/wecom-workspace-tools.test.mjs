import assert from "node:assert/strict";
import test from "node:test";

import {
  createDynamicWorkspaceSeeder,
  createTempFileCleanupScheduler,
  createWorkspaceAutoSender,
  resolveAgentWorkspaceDir,
  resolveOpenClawStateDir,
} from "../src/wecom/workspace-tools.js";

test("resolveOpenClawStateDir prefers config then env", () => {
  assert.equal(resolveOpenClawStateDir({ state: { dir: "/tmp/custom" } }, { processEnv: {} }), "/tmp/custom");
  assert.equal(resolveOpenClawStateDir({}, { processEnv: { OPENCLAW_STATE_DIR: "/tmp/env" } }), "/tmp/env");
});

test("resolveAgentWorkspaceDir normalizes agent id", () => {
  const out = resolveAgentWorkspaceDir("Main Agent#1", { state: { dir: "/tmp/state" } });
  assert.equal(out, "/tmp/state/workspace-main-agent-1");
});

test("createTempFileCleanupScheduler triggers unlink", async () => {
  const unlinked = [];
  const { scheduleTempFileCleanup } = createTempFileCleanupScheduler({
    unlinkImpl: async (path) => {
      unlinked.push(path);
    },
    defaultRetentionMs: 1,
  });

  scheduleTempFileCleanup("/tmp/test.file", { warn() {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(unlinked, ["/tmp/test.file"]);
});

test("createDynamicWorkspaceSeeder copies bootstrap files once", async () => {
  const calls = {
    copy: [],
    mkdir: 0,
  };
  const entries = [
    { name: "AGENTS.md", isFile: () => true },
    { name: "README.md", isFile: () => true },
  ];
  const seeded = new Set();

  const { seedDynamicAgentWorkspace } = createDynamicWorkspaceSeeder({
    bootstrapTemplateFiles: new Set(["AGENTS.md"]),
    seededAgentWorkspaces: seeded,
    readdirImpl: async () => entries,
    statImpl: async () => {
      throw new Error("missing");
    },
    copyFileImpl: async (src, dst) => {
      calls.copy.push([src, dst]);
    },
    mkdirImpl: async () => {
      calls.mkdir += 1;
    },
  });

  const api = { config: { state: { dir: "/tmp/state" } }, logger: { info() {}, warn() {} } };
  await seedDynamicAgentWorkspace({ api, agentId: "main", workspaceTemplate: "/tmp/template" });
  await seedDynamicAgentWorkspace({ api, agentId: "main", workspaceTemplate: "/tmp/template" });

  assert.equal(calls.mkdir, 1);
  assert.equal(calls.copy.length, 1);
  assert.equal(calls.copy[0][0], "/tmp/template/AGENTS.md");
  assert.equal(calls.copy[0][1], "/tmp/state/workspace-main/AGENTS.md");
});

test("createWorkspaceAutoSender sends existing workspace files", async () => {
  const sent = [];
  const { autoSendWorkspaceFilesFromReplyText } = createWorkspaceAutoSender({
    extractWorkspacePathsFromText: () => ["/workspace/main/a.txt", "/workspace/main/missing.txt"],
    resolveWorkspacePathToHost: ({ workspacePath }) => workspacePath.replace("/workspace/main", "/host/main"),
    statImpl: async (hostPath) => {
      if (hostPath.includes("missing")) throw new Error("missing");
      return { isFile: () => true };
    },
    sendWecomOutboundMediaBatch: async ({ mediaUrls }) => {
      sent.push(...mediaUrls);
      return { failed: [] };
    },
  });

  const result = await autoSendWorkspaceFilesFromReplyText({
    text: "reply",
    routeAgentId: "main",
    corpId: "ww1",
    corpSecret: "s",
    agentId: "1001",
    logger: { info() {}, warn() {} },
  });

  assert.equal(result.detectedCount, 2);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.sentCount, 1);
  assert.deepEqual(sent, ["/host/main/a.txt"]);
});
