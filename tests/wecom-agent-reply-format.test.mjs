import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceAutoSendHints, computeStreamingTailText } from "../src/wecom/agent-reply-format.js";

test("computeStreamingTailText returns only unseen tail when final starts with streamed", () => {
  const tail = computeStreamingTailText({
    finalText: "第一段\n第二段",
    streamedText: "第一段",
  });
  assert.equal(tail, "第二段");
});

test("computeStreamingTailText returns empty when final does not start with streamed", () => {
  const tail = computeStreamingTailText({
    finalText: "foo bar",
    streamedText: "bar",
  });
  assert.equal(tail, "");
});

test("buildWorkspaceAutoSendHints builds sent and failed hints", () => {
  const hints = buildWorkspaceAutoSendHints({
    sentCount: 2,
    failed: [
      { workspacePath: "/workspace/a.txt", reason: "missing" },
      { workspacePath: "/workspace/b.txt", reason: "permission denied" },
    ],
  });

  assert.equal(hints.length, 2);
  assert.match(hints[0], /自动回传 2 个文件/);
  assert.match(hints[1], /以下文件自动回传失败/);
  assert.match(hints[1], /\/workspace\/a\.txt/);
  assert.match(hints[1], /\/workspace\/b\.txt/);
});
