import { Errors } from "./errors.js";

interface Bucket {
  tokens: number;
  last: number;
}

/** 内存令牌桶：单实例自托管足够；多实例部署时可换 Redis。 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private ratePerMinute: number,
    private burst = ratePerMinute,
  ) {}

  /** 通过则静默返回，否则抛 429。 */
  take(key: string): void {
    const now = Date.now();
    const refill = this.ratePerMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.burst, last: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.last) * refill);
    b.last = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      throw Errors.rateLimited();
    }
    b.tokens -= 1;
    this.buckets.set(key, b);

    // 粗略清理：防止长期运行下 map 无限增长
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets) {
        if (now - v.last > 3_600_000) this.buckets.delete(k);
      }
    }
  }
}
