import assert from "node:assert/strict";
import test from "node:test";

import { RateLimiter, createWecomDefaultLimiters } from "../src/wecom/rate-limiter.js";

test("RateLimiter executes queued tasks", async () => {
  const limiter = new RateLimiter({ maxConcurrent: 1, minInterval: 0 });
  const order = [];
  const p1 = limiter.execute(async () => {
    order.push("a-start");
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push("a-end");
    return "a";
  });
  const p2 = limiter.execute(async () => {
    order.push("b-start");
    return "b";
  });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "a");
  assert.equal(r2, "b");
  assert.deepEqual(order, ["a-start", "a-end", "b-start"]);
});

test("createWecomDefaultLimiters returns api/message limiters", async () => {
  const { apiLimiter, messageProcessLimiter } = createWecomDefaultLimiters();
  assert.equal(typeof apiLimiter.execute, "function");
  assert.equal(typeof messageProcessLimiter.execute, "function");
});
