export class RateLimiter {
  constructor({ maxConcurrent = 3, minInterval = 200 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.minInterval = minInterval;
    this.running = 0;
    this.queue = [];
    this.lastExecution = 0;
  }

  async execute(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const waitTime = Math.max(0, this.lastExecution + this.minInterval - now);
    if (waitTime > 0) {
      setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    this.running += 1;
    this.lastExecution = Date.now();
    const { fn, resolve, reject } = this.queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.running -= 1;
      this.processQueue();
    }
  }
}

export function createWecomDefaultLimiters() {
  return {
    apiLimiter: new RateLimiter({ maxConcurrent: 3, minInterval: 200 }),
    messageProcessLimiter: new RateLimiter({ maxConcurrent: 2, minInterval: 0 }),
  };
}
