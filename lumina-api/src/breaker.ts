/**
 * 极简熔断器（对标原版 Resilience4j 语义的子集）：
 * 连续失败 ≥ threshold → open（冷却期）→ half-open 放一个探测请求 →
 * 成功则 close，失败则重新 open。
 */
export class CircuitBreaker {
  private failures = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private openedAt = 0;

  constructor(
    public readonly name: string,
    private threshold = 5,
    private cooldownMs = 30_000,
  ) {}

  /** 是否放行本次请求。 */
  allow(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    if (this.state === "half-open") return true; // 半开态只放行探测请求（本实现同一时刻仅一个在途）
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    if (this.state === "half-open") {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.trip();
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = Date.now();
    this.failures = 0;
  }

  get isOpen(): boolean {
    return this.state === "open";
  }
}
