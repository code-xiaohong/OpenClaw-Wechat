import assert from "node:assert/strict";
import test from "node:test";

import { createWecomTargetResolver } from "../src/wecom/target-utils.js";

test("normalizeWecomResolvedTarget prefers explicit object fields", () => {
  const { normalizeWecomResolvedTarget } = createWecomTargetResolver({
    resolveWecomTarget: () => null,
  });

  const result = normalizeWecomResolvedTarget({ toUser: " alice ", chatId: " c1 " });
  assert.deepEqual(result, { toUser: "alice", chatId: "c1" });
});

test("normalizeWecomResolvedTarget falls back to resolver", () => {
  const { normalizeWecomResolvedTarget } = createWecomTargetResolver({
    resolveWecomTarget: (raw) => (raw === "@bob" ? { toUser: "bob" } : null),
  });

  assert.deepEqual(normalizeWecomResolvedTarget("@bob"), { toUser: "bob" });
  assert.equal(normalizeWecomResolvedTarget(""), null);
});

test("formatWecomTargetForLog formats webhook/chat/direct", () => {
  const { formatWecomTargetForLog } = createWecomTargetResolver({
    resolveWecomTarget: () => null,
  });

  assert.equal(formatWecomTargetForLog({ webhook: "ops" }), "webhook:ops");
  assert.equal(formatWecomTargetForLog({ chatId: "chat-1" }), "chat:chat-1");
  assert.equal(formatWecomTargetForLog({ toUser: "u1", toTag: "t1" }), "user:u1|tag:t1");
});
