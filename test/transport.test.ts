/**
 * The transport, driven over a scripted `fetch`.
 *
 * Bodies are the captured ones wherever a body matters, so the shapes under
 * test are the ones the Go handler actually writes.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MemoryResponseCache } from "../src/cache.js";
import { Credential } from "../src/credentials.js";
import {
  AbortError,
  ConnectionError,
  DependencyError,
  ProtocolError,
  RateLimitError,
  ResourceError,
  TimeoutError,
} from "../src/errors.js";
import { Transport, buildPath, type Diagnostic, type FetchLike } from "../src/transport.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const SUFFIX = "7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3";
const SECRET = `tc_sk_live_${SUFFIX}`;

interface Scripted {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  throws?: Error;
}

/** A `fetch` that plays a script and records what it was asked for. */
function scripted(steps: Scripted[]): FetchLike & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(index++, steps.length - 1)];
    if (step === undefined) throw new Error("script exhausted");
    if (step.throws) throw step.throws;
    // A hand-rolled double rather than `new Response(...)`: the platform
    // constructor refuses to build a 304 at all, and 304 is exactly what the
    // revalidation tests need to see.
    const body = step.body ?? "";
    return {
      status: step.status,
      headers: new Headers({ "Content-Type": "application/json", ...step.headers }),
      text: async () => body,
    } as unknown as Response;
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

function transport(fetchImpl: FetchLike, overrides: Record<string, unknown> = {}): Transport {
  return new Transport({
    baseUrl: "https://api.trackcore.dev",
    credential: Credential.create(SECRET),
    fetch: fetchImpl,
    // No real sleeping: the backoff policy is asserted in retry.test.ts.
    sleep: async () => {},
    random: () => 0,
    ...overrides,
  });
}

describe("a successful request", () => {
  it("sends Bearer auth, Accept, and reads X-Request-Id", async () => {
    const fetchImpl = scripted([
      { status: 200, body: fixture("food_detail.json"), headers: { "X-Request-Id": "req_abc", ETag: 'W/"tag"' } },
    ]);
    const result = await transport(fetchImpl).request({ path: "/v1/foods/tc_food_x" });

    expect(result.status).toBe(200);
    expect(result.requestId).toBe("req_abc");
    expect(result.etag).toBe('W/"tag"');

    const call = fetchImpl.calls[0];
    expect(call?.url).toBe("https://api.trackcore.dev/v1/foods/tc_food_x");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${SECRET}`);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("builds a query string, dropping undefined parameters", () => {
    expect(buildPath("/v1/foods/search", { q: "apple", page_size: 2, region: undefined })).toBe(
      "/v1/foods/search?q=apple&page_size=2",
    );
    expect(buildPath("/healthz")).toBe("/healthz");
    expect(buildPath("/v1/foods", { ids: "a,b" })).toBe("/v1/foods?ids=a%2Cb");
  });

  it("a custom header cannot override Authorization", async () => {
    const fetchImpl = scripted([{ status: 200, body: "{}" }]);
    await transport(fetchImpl, { defaultHeaders: { Authorization: "Bearer stolen" } }).request({
      path: "/healthz",
      headers: { Authorization: "Bearer also-stolen" },
    });
    const headers = fetchImpl.calls[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${SECRET}`);
  });
});

describe("errors", () => {
  it("maps a captured 410 envelope to a ResourceError", async () => {
    const fetchImpl = scripted([{ status: 410, body: fixture("err_food_gone.json") }]);
    await expect(transport(fetchImpl).request({ path: "/v1/foods/x" })).rejects.toThrowError(ResourceError);
  });

  it("maps a captured 502 envelope to a DependencyError", async () => {
    const fetchImpl = scripted([{ status: 502, body: fixture("err_upstream_unavailable.json") }]);
    await expect(transport(fetchImpl).request({ path: "/v1/foods/search" })).rejects.toThrowError(
      DependencyError,
    );
  });

  it("a non-envelope body becomes a ProtocolError with nothing leaked", async () => {
    const html = "<html>502 Bad Gateway — upstream 10.0.3.14 — token=sk_live_LEAK</html>";
    const fetchImpl = scripted([{ status: 502, body: html, headers: { "Content-Type": "text/html" } }]);
    let thrown: unknown;
    try {
      await transport(fetchImpl).request({ path: "/healthz" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProtocolError);
    expect((thrown as Error).message).not.toContain("sk_live_LEAK");
    expect((thrown as Error).message).not.toContain("10.0.3.14");
    expect((thrown as ProtocolError).bodySample).toContain("Bad Gateway");
  });

  it("a 200 whose body is not JSON is a ProtocolError", async () => {
    const fetchImpl = scripted([{ status: 200, body: "<html>captive portal</html>" }]);
    await expect(transport(fetchImpl).request({ path: "/healthz" })).rejects.toThrowError(ProtocolError);
  });

  it("a fetch rejection becomes a ConnectionError carrying the cause", async () => {
    const cause = new TypeError("fetch failed");
    const fetchImpl = scripted([{ status: 0, throws: cause }]);
    let thrown: unknown;
    try {
      await transport(fetchImpl, { retry: { maxAttempts: 1 } }).request({ path: "/healthz" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectionError);
    expect((thrown as Error).cause).toBe(cause);
  });
});

describe("retrying", () => {
  it("retries a 503 and returns the eventual success", async () => {
    const fetchImpl = scripted([
      { status: 503, body: fixture("err_capability_maintenance.json"), headers: { "Retry-After": "0" } },
      { status: 200, body: '{"status":"ok","version":"1"}' },
    ]);
    const result = await transport(fetchImpl).request({ path: "/healthz" });
    expect(result.status).toBe(200);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("retries a 502 exactly once, then surfaces it", async () => {
    const fetchImpl = scripted([{ status: 502, body: fixture("err_upstream_unavailable.json") }]);
    await expect(transport(fetchImpl).request({ path: "/healthz" })).rejects.toThrowError(DependencyError);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("does not retry a 410 at all", async () => {
    const fetchImpl = scripted([{ status: 410, body: fixture("err_food_gone.json") }]);
    await expect(transport(fetchImpl).request({ path: "/v1/foods/x" })).rejects.toThrowError(ResourceError);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("surfaces the last error after the ceiling", async () => {
    const fetchImpl = scripted([{ status: 429, body: fixture("err_rate_limited.json") }]);
    await expect(transport(fetchImpl).request({ path: "/healthz" })).rejects.toThrowError(RateLimitError);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("reports retries on the diagnostic hook, without the credential", async () => {
    const seen: Diagnostic[] = [];
    const fetchImpl = scripted([
      { status: 503, body: fixture("err_capability_maintenance.json"), headers: { "Retry-After": "0" } },
      { status: 200, body: "{}" },
    ]);
    await transport(fetchImpl, { onDiagnostic: (d: Diagnostic) => seen.push(d) }).request({
      path: "/healthz",
    });
    const retries = seen.filter((d) => d.event === "retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.status).toBe(503);
    expect(JSON.stringify(seen)).not.toContain(SUFFIX);
    // The base URL and the credential are not in the diagnostic path.
    expect(seen.every((d) => d.path.startsWith("/"))).toBe(true);
  });
});

describe("timeouts and cancellation", () => {
  it("a per-attempt timeout is a TimeoutError", async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await expect(
      transport(slow, { timeoutMs: 5, retry: { maxAttempts: 1 } }).request({ path: "/healthz" }),
    ).rejects.toThrowError(TimeoutError);
  });

  it("the overall deadline stops a retry loop", async () => {
    // The captured 503 carries retry_after_seconds: 600 in its body and, here,
    // no `Retry-After` header — which is what a header-normalising proxy
    // produces. 600s against a 1s deadline: sleeping would be a certain
    // failure, so the SDK gives the caller the time back instead.
    const fetchImpl = scripted([{ status: 503, body: fixture("err_capability_maintenance.json") }]);
    const t = transport(fetchImpl, {
      deadlineMs: 1_000,
      sleep: async () => {},
      retry: { maxAttempts: 5 },
    });
    await expect(
      t.request({ path: "/healthz" }),
    ).rejects.toThrowError();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("the caller's AbortSignal wins and is never retried", async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const promise = transport(fetchImpl).request({ path: "/healthz", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrowError(AbortError);
  });

  it("an already-aborted signal short-circuits before any fetch", async () => {
    const fetchImpl = scripted([{ status: 200, body: "{}" }]);
    await expect(
      transport(fetchImpl).request({ path: "/healthz", signal: AbortSignal.abort() }),
    ).rejects.toThrowError(AbortError);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe("ETag revalidation (SDK-O4)", () => {
  it("stores an ETag and replays the body on a 304", async () => {
    const cache = new MemoryResponseCache();
    const fetchImpl = scripted([
      { status: 200, body: fixture("food_detail.json"), headers: { ETag: 'W/"abc"' } },
      { status: 304, headers: { ETag: 'W/"abc"' } },
    ]);
    const t = transport(fetchImpl, { cache });

    const first = await t.request({ path: "/v1/foods/x", revalidate: true });
    expect(first.fromCache).toBe(false);
    expect(cache.size).toBe(1);

    const second = await t.request({ path: "/v1/foods/x", revalidate: true });
    expect(second.fromCache).toBe(true);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));

    // The revalidating request carried the validator.
    const headers = fetchImpl.calls[1]?.init.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('W/"abc"');
  });

  it("still asks the server every time — this is not an offline cache", async () => {
    const cache = new MemoryResponseCache();
    const fetchImpl = scripted([
      { status: 200, body: "{}", headers: { ETag: 'W/"abc"' } },
      { status: 304, headers: { ETag: 'W/"abc"' } },
      { status: 304, headers: { ETag: 'W/"abc"' } },
    ]);
    const t = transport(fetchImpl, { cache });
    await t.request({ path: "/v1/foods/x", revalidate: true });
    await t.request({ path: "/v1/foods/x", revalidate: true });
    await t.request({ path: "/v1/foods/x", revalidate: true });
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("is off unless the caller opts in", async () => {
    const cache = new MemoryResponseCache();
    const fetchImpl = scripted([{ status: 200, body: "{}", headers: { ETag: 'W/"abc"' } }]);
    await transport(fetchImpl, { cache }).request({ path: "/v1/foods/x" });
    expect(cache.size).toBe(0);
  });

  it("evicts least-recently-used entries at the published cap", () => {
    const cache = new MemoryResponseCache(2);
    cache.set("a", { etag: "1", body: null, storedAt: 0 });
    cache.set("b", { etag: "2", body: null, storedAt: 0 });
    cache.get("a"); // touch
    cache.set("c", { etag: "3", body: null, storedAt: 0 });
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
});

describe("configuration", () => {
  it("refuses a baseUrl that is not http(s)", () => {
    expect(() => transport(scripted([]), { baseUrl: "ftp://example.com" })).toThrow(/http/);
    expect(() => transport(scripted([]), { baseUrl: "not a url" })).toThrow(/valid URL/);
  });

  it("names the Node version when there is no fetch", () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      expect(
        () =>
          new Transport({ baseUrl: "https://api.trackcore.dev", credential: Credential.create(SECRET) }),
      ).toThrow(/Node 18/);
    } finally {
      vi.unstubAllGlobals();
      globalThis.fetch = original;
    }
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchImpl = scripted([{ status: 200, body: "{}" }]);
    await transport(fetchImpl, { baseUrl: "https://api.trackcore.dev///" }).request({ path: "/healthz" });
    expect(fetchImpl.calls[0]?.url).toBe("https://api.trackcore.dev/healthz");
  });
});
