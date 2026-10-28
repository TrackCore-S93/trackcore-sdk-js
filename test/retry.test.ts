/**
 * The retry policy (SDK-C4), and in particular the 502 cap.
 *
 * `upstream_unavailable` is P-020's catch-all: every unplanned dependency
 * failure becomes it, *including* an upstream rejecting a request TrackCore
 * forwarded. From outside the two are indistinguishable by design — PF-X3
 * forbids the provider's own message from crossing over — so a blind retry loop
 * on 502 turns a request that can never succeed into a storm.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, backoffDelay, decideRetry, parseRetryAfter } from "../src/retry.js";
import type { AttemptOutcome, RetryContext } from "../src/retry.js";

const base: RetryContext = {
  policy: DEFAULT_RETRY_POLICY,
  attempt: 1,
  method: "GET",
  hasIdempotencyKey: false,
  remainingMs: 30_000,
  random: () => 0.5,
};

const status = (code: number, retryAfterSeconds: number | null = null): AttemptOutcome => ({
  kind: "response",
  status: code,
  retryAfterSeconds,
});

describe("clear transients are retried", () => {
  for (const code of [408, 429, 503, 504]) {
    it(`${code} is retried`, () => {
      expect(decideRetry(status(code), base).retry).toBe(true);
    });
  }

  it("a connection failure is retried", () => {
    expect(decideRetry({ kind: "connection" }, base).retry).toBe(true);
  });

  it("an attempt timeout is retried", () => {
    expect(decideRetry({ kind: "timeout" }, base).retry).toBe(true);
  });
});

describe("502 is capped, not retried freely", () => {
  it("gets exactly one retry under the default policy", () => {
    const first = decideRetry(status(502), { ...base, attempt: 1 });
    expect(first.retry).toBe(true);

    const second = decideRetry(status(502), { ...base, attempt: 2 });
    expect(second.retry).toBe(false);
    expect(second.reason).toContain("indistinguishable");
  });

  it("stops before the general ceiling, which 503 does not", () => {
    // Same attempt number, different answer: that is the cap doing its job.
    expect(decideRetry(status(502), { ...base, attempt: 2 }).retry).toBe(false);
    expect(decideRetry(status(503), { ...base, attempt: 2 }).retry).toBe(true);
  });

  it("can be turned off entirely", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, max502Attempts: 1 };
    expect(decideRetry(status(502), { ...base, policy, attempt: 1 }).retry).toBe(false);
  });
});

describe("nothing else in the 4xx or 5xx ranges is retried", () => {
  for (const code of [400, 401, 402, 403, 404, 409, 410, 413, 415, 422, 500, 501]) {
    it(`${code} is not retried`, () => {
      const decision = decideRetry(status(code), base);
      expect(decision.retry).toBe(false);
      expect(decision.reason).toContain("not transient");
    });
  }

  it("500 in particular is not retried", () => {
    // TrackCore's own defect. It carries no detail by design, and repeating the
    // request does not make the bug go away.
    expect(decideRetry(status(500), base).retry).toBe(false);
  });
});

describe("the ceiling and the deadline", () => {
  it("stops at maxAttempts", () => {
    expect(decideRetry(status(503), { ...base, attempt: 3 }).retry).toBe(false);
    expect(decideRetry(status(503), { ...base, attempt: 2 }).retry).toBe(true);
  });

  it("refuses a backoff that would outrun the deadline", () => {
    const decision = decideRetry(status(429, 60), { ...base, remainingMs: 1_000 });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("deadline");
  });
});

describe("idempotency (SDK-C4)", () => {
  it("a POST without an Idempotency-Key is never retried", () => {
    const decision = decideRetry(status(503), { ...base, method: "POST" });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("Idempotency-Key");
  });

  it("a POST with one is", () => {
    expect(decideRetry(status(503), { ...base, method: "POST", hasIdempotencyKey: true }).retry).toBe(true);
  });

  it("GET, HEAD and OPTIONS are idempotent without one", () => {
    for (const method of ["GET", "get", "HEAD", "OPTIONS"]) {
      expect(decideRetry(status(503), { ...base, method }).retry, method).toBe(true);
    }
  });
});

describe("backoff", () => {
  it("Retry-After wins over the exponential schedule", () => {
    // PF-R2 and PF-X4 require the header on rate_limited and
    // capability_maintenance. The server knows when it will be ready; we do not.
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 1, 7)).toBe(7_000);
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 5, 0)).toBe(0);
  });

  it("a huge Retry-After is still capped", () => {
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 1, 86_400)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it("grows exponentially and is capped", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, jitter: "none" as const };
    expect(backoffDelay(policy, 1, null)).toBe(250);
    expect(backoffDelay(policy, 2, null)).toBe(500);
    expect(backoffDelay(policy, 3, null)).toBe(1_000);
    expect(backoffDelay(policy, 20, null)).toBe(policy.maxDelayMs);
  });

  it("full jitter spreads over [0, delay)", () => {
    // Not "delay ± 10%": the thing jitter is for is stopping a thousand clients
    // that failed at the same instant from retrying at the same instant.
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 3, null, () => 0)).toBe(0);
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 3, null, () => 0.999)).toBe(999);
    expect(backoffDelay(DEFAULT_RETRY_POLICY, 3, null, () => 0.5)).toBe(500);
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter(" 0 ")).toBe(0);
  });

  it("reads an HTTP-date, which a proxy may substitute", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(parseRetryAfter("Mon, 26 Oct 2026 12:00:30 GMT", now)).toBe(30);
    // A date in the past means "now", not a negative sleep.
    expect(parseRetryAfter("Mon, 26 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("returns null for anything else", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
    // `Date.parse` reads both of these as dates. Without the HTTP-date shape
    // gate they would be silently accepted as "retry immediately".
    expect(parseRetryAfter("tomorrow")).toBeNull();
    expect(parseRetryAfter("2026-10-26")).toBeNull();
    // But a bare integer is legitimate delta-seconds, however large.
    expect(parseRetryAfter("2026")).toBe(2026);
  });
});
