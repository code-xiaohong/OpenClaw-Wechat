import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function runNodeScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

const enabled = String(process.env.WECOM_E2E_ENABLE ?? "").trim() === "1";
const botUrl = String(process.env.WECOM_E2E_BOT_URL ?? "").trim();
const agentUrl = String(process.env.WECOM_E2E_AGENT_URL ?? "").trim();
const timeoutMs = String(process.env.WECOM_E2E_TIMEOUT_MS ?? "15000").trim() || "15000";
const pollCount = String(process.env.WECOM_E2E_POLL_COUNT ?? "20").trim() || "20";
const pollIntervalMs = String(process.env.WECOM_E2E_POLL_INTERVAL_MS ?? "1000").trim() || "1000";
const content = String(process.env.WECOM_E2E_CONTENT ?? "/status").trim() || "/status";
const fromUser = String(process.env.WECOM_E2E_FROM_USER ?? "").trim();
const configPath = String(process.env.WECOM_E2E_CONFIG ?? process.env.OPENCLAW_CONFIG_PATH ?? "").trim();
const accountId = String(process.env.WECOM_E2E_ACCOUNT ?? "default").trim() || "default";

test(
  "remote wecom bot e2e selfcheck",
  {
    skip: !enabled || !botUrl,
  },
  async () => {
    const args = ["--url", botUrl, "--content", content, "--timeout-ms", timeoutMs, "--poll-count", pollCount, "--poll-interval-ms", pollIntervalMs];
    if (fromUser) args.push("--from-user", fromUser);
    if (configPath) args.push("--config", configPath);
    await runNodeScript("./scripts/wecom-bot-selfcheck.mjs", args);
    assert.equal(true, true);
  },
);

test(
  "remote wecom agent e2e selfcheck",
  {
    skip: !enabled || !agentUrl,
  },
  async () => {
    const args = [
      "--url",
      agentUrl,
      "--account",
      accountId,
      "--content",
      content,
      "--timeout-ms",
      timeoutMs,
    ];
    if (fromUser) args.push("--from-user", fromUser);
    if (configPath) args.push("--config", configPath);
    await runNodeScript("./scripts/wecom-agent-selfcheck.mjs", args);
    assert.equal(true, true);
  },
);

