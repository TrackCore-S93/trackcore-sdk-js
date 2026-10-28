/**
 * The HTTP layer: one request, up to `maxAttempts` tries, one typed result.
 *
 * `fetch` and nothing else (SDK-W4). Node 18 has it globally, every modern
 * browser has it, every edge runtime has it. No `http.Agent`, no `XMLHttpRequest`
 * branch, no Node-only import anywhere on this path — SDK-W2 requires that the
 * browser bundle contain no Node API, and the cheapest way to guarantee that is
 * not to have one.
 *
 * # Two clocks
 *
 * `timeoutMs` bounds **one attempt**. `deadlineMs` bounds **the whole call**,
 * retries and backoff included. Both are needed: a per-attempt timeout alone
 * lets three attempts plus two backoffs run far past what the caller expected,
 * and a deadline alone lets a single hung socket eat all of it. The deadline is
 * also what stops the policy sleeping 20 seconds for a retry that could not
 * possibly land in time.
 *
 * # Responses are never parsed with `JSON.parse`
 *
 * Every body goes through `parseJson`, which preserves each number's exact
 * lexeme. See `src/json.ts` for why, and `test/no-naive-parse.test.ts` for the
 * test that keeps it that way.
 */

import { Credential } from "./credentials.js";
import {
  AbortError,
  ConfigurationError,
  ConnectionError,
  ProtocolError,
  TimeoutError,
  TrackCoreAPIError,
  errorFromEnvelope,
} from "./errors.js";
import { parseJson, type JsonValue } from "./json.js";
import {
  DEFAULT_RETRY_POLICY,
  decideRetry,
  parseRetryAfter,
  type AttemptOutcome,
  type RetryPolicy,
} from "./retry.js";
import type { CacheEntry, ResponseCache } from "./cache.js";

/** The subset of `fetch` this SDK uses, so a customer can supply their own. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Diagnostics. Never contains a credential, and never an end user's query. */
export interface Diagnostic {
  readonly event: "retry" | "cache_hit" | "request" | "response";
  readonly method: string;
  /** Path and query only — the base URL and credentials are not included. */
  readonly path: string;
  readonly attempt: number;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly delayMs?: number;
  readonly reason?: string;
}

export interface TransportOptions {
  readonly baseUrl: string;
  readonly credential: Credential;
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  readonly deadlineMs?: number | undefined;
  readonly retry?: Partial<RetryPolicy> | undefined;
  readonly cache?: ResponseCache | undefined;
  readonly defaultHeaders?: Readonly<Record<string, string>> | undefined;
  readonly onDiagnostic?: ((d: Diagnostic) => void) | undefined;
  /** Injectable clock for tests. */
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly userAgent?: string | undefined;
}

export interface RequestOptions {
  readonly method?: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>> | undefined;
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Opt in to ETag revalidation for this request. GETs only. */
  readonly revalidate?: boolean | undefined;
}

export interface SuccessfulResponse {
  readonly status: number;
  readonly body: JsonValue;
  readonly requestId: string | null;
  readonly etag: string | null;
  /** True when a `304` meant the cached body was reused. */
  readonly fromCache: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DEADLINE_MS = 30_000;

export class Transport {
  readonly #baseUrl: string;
  readonly #credential: Credential;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #deadlineMs: number;
  readonly #retry: RetryPolicy;
  readonly #cache: ResponseCache | undefined;
  readonly #defaultHeaders: Record<string, string>;
  readonly #onDiagnostic: (d: Diagnostic) => void;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  constructor(options: TransportOptions) {
    this.#baseUrl = normaliseBaseUrl(options.baseUrl);
    this.#credential = options.credential;

    const resolved = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (typeof resolved !== "function") {
      throw new ConfigurationError(
        "fetch_unavailable",
        "This runtime has no global `fetch`. TrackCore's JavaScript SDK needs Node 18.17 or " +
          "later, or a `fetch` implementation passed as the `fetch` option.",
      );
    }
    this.#fetch = resolved;

    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.#retry = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.#cache = options.cache;
    this.#defaultHeaders = { ...options.defaultHeaders };
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  /** The credential's public description. The key itself is not reachable. */
  describeCredential(): string {
    return this.#credential.describe();
  }

  async request(options: RequestOptions): Promise<SuccessfulResponse> {
    const method = (options.method ?? "GET").toUpperCase();
    const path = buildPath(options.path, options.query);
    const url = this.#baseUrl + path;

    const cacheKey = options.revalidate === true && method === "GET" ? `${method} ${url}` : null;
    const cached = cacheKey !== null ? this.#cache?.get(cacheKey) : undefined;

    const startedAt = Date.now();
    let attempt = 0;
    let lastOutcome: AttemptOutcome | null = null;
    let lastError: unknown;

    for (;;) {
      attempt++;
      throwIfAborted(options.signal);

      const remaining = this.#deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new TimeoutError("deadline", this.#deadlineMs);

      this.#onDiagnostic({ event: "request", method, path, attempt });

      let outcome: AttemptOutcome;
      let response: Response | undefined;
      let bodyText = "";

      try {
        response = await this.#attempt(method, url, options, cached, Math.min(this.#timeoutMs, remaining));
        bodyText = await response.text();
        outcome = {
          kind: "response",
          status: response.status,
          retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
        };
      } catch (cause) {
        if (isCallerAbort(cause, options.signal)) throw new AbortError();
        if (isAbort(cause)) {
          outcome = { kind: "timeout" };
          lastError = new TimeoutError("attempt", this.#timeoutMs);
        } else {
          outcome = { kind: "connection" };
          // The cause is attached, not interpolated: a `fetch` failure message
          // can contain the full URL, and the URL has no credential in it
          // today but this SDK should not depend on that staying true.
          lastError = new ConnectionError(
            "the request could not be delivered to TrackCore",
            { cause },
          );
        }
      }

      lastOutcome = outcome;

      if (outcome.kind === "response" && response !== undefined) {
        const requestId = response.headers.get("X-Request-Id");
        this.#onDiagnostic({ event: "response", method, path, attempt, status: response.status, requestId });

        // 304: the stored body is still correct (SDK-O4).
        if (response.status === 304 && cached !== undefined && cacheKey !== null) {
          this.#onDiagnostic({ event: "cache_hit", method, path, attempt, status: 304, requestId });
          return { status: 304, body: cached.body, requestId, etag: cached.etag, fromCache: true };
        }

        if (response.status >= 200 && response.status < 300) {
          const body = this.#decode(bodyText, response.status, requestId);
          const etag = response.headers.get("ETag");
          if (cacheKey !== null && etag !== null) {
            this.#cache?.set(cacheKey, { etag, body, storedAt: Date.now() } satisfies CacheEntry);
          }
          return { status: response.status, body, requestId, etag, fromCache: false };
        }

        const error = this.#toError(bodyText, response.status, requestId);
        lastError = error;

        // PF-R2 and PF-X4 put the delay in *two* places: the `Retry-After`
        // header and the envelope's `retry_after_seconds`. The header is read
        // first because it is cheaper, but a proxy that normalises headers can
        // strip it while leaving the body untouched — and on
        // `capability_maintenance` the delay is the difference between one
        // polite retry and a client hammering a service that was switched off
        // on purpose. So the field is the fallback.
        if (outcome.retryAfterSeconds === null && error instanceof TrackCoreAPIError) {
          outcome = { ...outcome, retryAfterSeconds: error.retryAfterSeconds };
        }
      }

      const decision = decideRetry(outcome, {
        policy: this.#retry,
        attempt,
        method,
        hasIdempotencyKey: options.idempotencyKey !== undefined,
        remainingMs: this.#deadlineMs - (Date.now() - startedAt),
        random: this.#random,
      });

      if (!decision.retry) throw lastError;

      this.#onDiagnostic({
        event: "retry",
        method,
        path,
        attempt,
        delayMs: decision.delayMs,
        reason: decision.reason,
        ...(outcome.kind === "response" ? { status: outcome.status } : {}),
      });

      try {
        await this.#sleep(decision.delayMs, options.signal);
      } catch (cause) {
        if (isCallerAbort(cause, options.signal)) throw new AbortError();
        throw cause;
      }
    }
    // Unreachable: every path above either returns or throws. `lastOutcome` is
    // read here only so the compiler sees it used.
    void lastOutcome;
  }

  async #attempt(
    method: string,
    url: string,
    options: RequestOptions,
    cached: CacheEntry | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });

    const headers: Record<string, string> = {
      ...this.#defaultHeaders,
      ...options.headers,
      Accept: "application/json",
      Authorization: this.#credential.authorizationHeader,
    };
    if (cached !== undefined) headers["If-None-Match"] = cached.etag;
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;

    const init: RequestInit = { method, headers, signal: controller.signal };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    try {
      return await this.#fetch(url, init);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Decodes a 2xx body. A body that is not JSON is a protocol violation. */
  #decode(text: string, status: number, requestId: string | null): JsonValue {
    try {
      return parseJson(text);
    } catch {
      throw new ProtocolError(
        "TrackCore answered with a body that is not valid JSON. This usually means something " +
          "between your code and TrackCore answered instead — a proxy, a captive portal or a " +
          "load balancer. The body is on `error.bodySample`.",
        { status, requestId, body: text },
      );
    }
  }

  /**
   * Turns a non-2xx response into a typed error.
   *
   * **This is where the no-leak rule lives.** A conforming envelope gives us a
   * code from the closed enumeration and a message the server rendered from a
   * template; that is safe to surface. Anything else — HTML, a proxy's JSON, a
   * code we do not know — produces a `ProtocolError` whose message is fixed
   * text, with the body parked on a non-enumerable property.
   */
  #toError(text: string, status: number, requestId: string | null): TrackCoreAPIError | ProtocolError {
    let body: JsonValue | undefined;
    try {
      body = parseJson(text);
    } catch {
      body = undefined;
    }

    const apiError = errorFromEnvelope(body, status, requestId);
    if (apiError !== null) return apiError;

    return new ProtocolError(
      `TrackCore answered ${status} but not in the documented error envelope. Every non-2xx ` +
        `response from TrackCore carries {"error":{"code",…}} with a code from the published ` +
        `enumeration, so this response did not come from TrackCore. The body is on ` +
        `\`error.bodySample\`.`,
      { status, requestId, body: text },
    );
  }
}

// ---------------------------------------------------------------------------

function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("base_url_invalid", `\`baseUrl\` is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigurationError("base_url_invalid", `\`baseUrl\` must be http or https, not ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

/** Builds `/v1/foods/search?q=apple`. Undefined parameters are omitted. */
export function buildPath(
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
): string {
  const search = new URLSearchParams();
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return suffix === "" ? prefixed : `${prefixed}?${suffix}`;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AbortError();
}

function isAbort(cause: unknown): boolean {
  return (
    cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")
  );
}

function isCallerAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  if (cause instanceof AbortError) return true;
  return signal?.aborted === true && isAbort(cause);
}
