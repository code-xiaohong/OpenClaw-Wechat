import assert from "node:assert/strict";
import test from "node:test";

import { createWecomPluginBaseServices } from "../src/wecom/plugin-base-services.js";

test("createWecomPluginBaseServices returns shared runtime/network bindings", () => {
  const services = createWecomPluginBaseServices();
  assert.equal(typeof services.sendWecomText, "function");
  assert.equal(typeof services.fetchMediaFromUrl, "function");
  assert.equal(typeof services.buildWecomBotEncryptedResponse, "function");
  assert.equal(typeof services.setGatewayRuntime, "function");
  assert.equal(typeof services.getGatewayRuntime, "function");
  assert.equal(typeof services.messageProcessLimiter.execute, "function");
});
