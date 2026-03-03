import assert from "node:assert/strict";
import test from "node:test";

import { createWecomAccountRuntime } from "../src/wecom/account-runtime.js";

function createRegistryMock() {
  return {
    normalizeAccountId: (id) => String(id ?? "").trim().toLowerCase() || "default",
    getWecomConfig: ({ gatewayRuntime, accountId }) => ({
      accountId: accountId || "default",
      runtimeTag: gatewayRuntime?.tag || "none",
    }),
    listWecomAccountIds: () => ["default", "ops"],
    listEnabledWecomAccounts: () => [{ accountId: "default" }],
    listWebhookTargetAliases: () => ["ops"],
    listAllWebhookTargetAliases: () => ["ops", "alerts"],
    groupAccountsByWebhookPath: () => new Map([["/wecom/callback", [{ accountId: "default" }]]]),
  };
}

test("createWecomAccountRuntime resolves config via gateway runtime", () => {
  const runtime = createWecomAccountRuntime({
    wecomAccountRegistry: createRegistryMock(),
    getGatewayRuntime: () => ({ tag: "gw" }),
  });

  assert.equal(runtime.normalizeAccountId(" OPS "), "ops");
  assert.deepEqual(runtime.getWecomConfig({}, "ops"), { accountId: "ops", runtimeTag: "gw" });
  assert.deepEqual(runtime.listWecomAccountIds({}), ["default", "ops"]);
  assert.equal(runtime.groupAccountsByWebhookPath({}) instanceof Map, true);
});
