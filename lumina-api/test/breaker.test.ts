import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../src/breaker.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续失败达到阈值后熔断", () => {
    const b = new CircuitBreaker("p", 3, 10_000);
    b.onFailure();
    b.onFailure();
    expect(b.allow()).toBe(true);
    b.onFailure();
    expect(b.isOpen).toBe(true);
    expect(b.allow()).toBe(false);
  });

  it("冷却后半开探测：成功闭合", () => {
    const b = new CircuitBreaker("p", 1, 1_000);
    b.onFailure();
    expect(b.allow()).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect(b.allow()).toBe(true); // half-open，放行探测
    b.onSuccess();
    expect(b.isOpen).toBe(false);
    expect(b.allow()).toBe(true);
  });

  it("半开探测失败则重新熔断", () => {
    const b = new CircuitBreaker("p", 1, 1_000);
    b.onFailure();
    vi.advanceTimersByTime(1_100);
    expect(b.allow()).toBe(true);
    b.onFailure();
    expect(b.allow()).toBe(false);
  });
});
