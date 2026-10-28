/**
 * The retry policy (SDK-C4).
 *
 * # The 502 rule, which is the only interesting decision here
 *
 * The obvious policy is "retry 5xx". It is wrong for this API, and the reason
 * is in the server's own source.
 *
 * `upstream_unavailable` (502) is P-020's catch-all: **every** unplanned
 * dependency failure becomes it. That includes the upstream provider being
 * down — transient, worth retrying — and it also includes the upstream
 * rejecting a request TrackCore forwarded. In the captured behaviour the second
 * kind is produced by, among other things, a malformed parameter reaching the
 * provider: `services/nutrition/internal/httpapi/foods.go` maps anything from
 * the client that is not a recognised not-found into `502 upstream_unavailable`
 * via `Fail`. From outside, the two are **indistinguishable** — same code, same
 * message, same `upstream` field, by design, because PF-X3 forbids the
 * provider's own message from crossing over.
 *
 * So a blind retry loop on 502 does the worst possible thing: a request that
 * can never succeed is sent again and again, at full backoff, burning the
 * customer's rate-limit budget and TrackCore's provider quota, and the customer
 * sees a 30-second hang instead of an error in 200 ms. Multiply by a retry
 * ceiling of 3 and a client-side fan-out and it is an outage amplifier.
 *
 * The policy therefore is: **502 gets at most one retry** (`max502Attempts: 2`,
 * meaning two attempts in total), which covers a genuine blip without turning a
 * permanent failure into a storm. Everything genuinely transient — connect
 * failure, timeout, 408, 429, 503, 504 — gets the full ceiling.
 *
 * 500 is not retried at all. It is TrackCore's own defect (`CategoryServer`),
 * it carries no detail by design, and nothing about repeating the request makes
 * the bug go away.
 *
 * # Idempotency
 *
 * SDK-C4: "Non-idempotent requests are retried only when an `Idempotency-Key`
 * is set." Today this SDK only issues GETs, so the rule never fires — it is
 * implemented and tested now anyway, because the diary writes that will need it
 * are the ones where getting it wrong means duplicate entries in a user's food
 * log.
 */

/** Everything the policy needs to know about one finished attempt. */
export type AttemptOutcome =
  | { kind: "response"; status: number; retryAfterSeconds: number | null }
  | { kind: "connection" }
  | { kind: "timeout" };

export interface RetryPolicy {
  /** Total attempts, including the first. `1` disables retrying. Default 3. */
  readonly maxAttempts: number;
  /**
   * Total attempts allowed for `502 upstream_unavailable`, capped separately.
   * Default 2 — one retry. See the note at the top of this file.
   */
  readonly max502Attempts: number;
  /** Delay before the first retry, in milliseconds. Default 250. */
  readonly initialDelayMs: number;
  /** Ceiling for a single backoff delay. Default 20 000. */
  readonly maxDelayMs: number;
  /** Multiplier per attempt. Default 2. */
  readonly backoffFactor: number;
  /**
   * `"full"` picks uniformly from `[0, delay]`; `"none"` is deterministic and
   * exists for tests. Full jitter, not "delay ± 10 %", because the thing jitter
   * is for is stopping a thousand clients that failed at the same instant from
   * retrying at the same instant.
   */
  readonly jitter: "full" | "none";
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  max502Attempts: 2,
  initialDelayMs: 250,
  maxDelayMs: 20_000,
  backoffFactor: 2,
  jitter: "full",
});

/** Statuses worth sending again. 502 is handled separately, by count. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, // request timeout
  429, // rate_limited — PF-R2 requires Retry-After, which is honoured below
  503, // capability_maintenance — the only 503 (P-020); Retry-After is required
  504, // gateway timeout
]);

const BAD_GATEWAY = 502;

export interface RetryDecision {
  readonly retry: boolean;
  /** Milliseconds to wait. Zero when `retry` is false. */
  readonly delayMs: number;
  /** Why, for the diagnostic hook. Never shown to an end user. */
  readonly reason: string;
}

export interface RetryContext {
  readonly policy: RetryPolicy;
  /** 1 for the first attempt. */
  readonly attempt: number;
  /** HTTP method, for the idempotency rule. */
  readonly method: string;
  /** Whether the request carried an `Idempotency-Key`. */
  readonly hasIdempotencyKey: boolean;
  /** Milliseconds left on the overall deadline, or `Infinity`. */
  readonly remainingMs: number;
  /** Injectable for tests. Defaults to `Math.random`. */
  readonly random?: () => number;
}

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Decides whether to send this request again, and how long to wait first. */
export function decideRetry(outcome: AttemptOutcome, context: RetryContext): RetryDecision {
  const { policy, attempt } = context;
  const no = (reason: string): RetryDecision => ({ retry: false, delayMs: 0, reason });

  if (attempt >= policy.maxAttempts) return no("retry ceiling reached");

  if (!IDEMPOTENT_METHODS.has(context.method.toUpperCase()) && !context.hasIdempotencyKey) {
    // SDK-C4. Replaying a write with no idempotency key is how a diary gets two
    // of the same breakfast.
    return no("non-idempotent request with no Idempotency-Key");
  }

  let retryAfterSeconds: number | null = null;

  switch (outcome.kind) {
    case "connection":
      break; // always worth one more go
    case "timeout":
      break; // ditto: the attempt clock, not the caller's deadline
    case "response": {
      const { status } = outcome;
      retryAfterSeconds = outcome.retryAfterSeconds;
      if (status === BAD_GATEWAY) {
        if (attempt >= policy.max502Attempts) {
          return no(
            "502 upstream_unavailable is capped: it is indistinguishable from a permanent " +
              "upstream rejection, which no number of retries will fix",
          );
        }
        break;
      }
      if (!RETRYABLE_STATUSES.has(status)) {
        return no(`status ${status} is not transient`);
      }
      break;
    }
  }

  const delayMs = backoffDelay(policy, attempt, retryAfterSeconds, context.random);

  // A delay that outruns the overall deadline is a sleep followed by a
  // certain failure. Fail now and give the caller the time back.
  if (delayMs >= context.remainingMs) {
    return no("the next backoff would exceed the overall deadline");
  }

  return { retry: true, delayMs, reason: describe(outcome) };
}

/**
 * `Retry-After` wins when the server sent one — PF-R2 and PF-X4 require it on
 * `rate_limited` and `capability_maintenance`, and the server knows when it
 * will be ready and we do not. Otherwise exponential backoff with full jitter.
 */
export function backoffDelay(
  policy: RetryPolicy,
  attempt: number,
  retryAfterSeconds: number | null,
  random: () => number = Math.random,
): number {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = policy.initialDelayMs * policy.backoffFactor ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return policy.jitter === "full" ? Math.floor(random() * capped) : capped;
}

/**
 * Parses a `Retry-After` header. RFC 9110 allows delta-seconds or an HTTP-date;
 * the gateway always writes delta-seconds, but a proxy in between may not.
 *
 * The date branch is gated on the header *looking* like an HTTP-date — all
 * three of RFC 9110's accepted date formats begin with a three-letter day name
 * — because `Date.parse` is extraordinarily lax. It reads `"-5"` as a date and
 * `"soon"` as `NaN`, and the first of those would otherwise be silently
 * accepted as "retry immediately" instead of being rejected as nonsense.
 */
const HTTP_DATE_SHAPE = /^[A-Za-z]{3,9},?\s/;

export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (!HTTP_DATE_SHAPE.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function describe(outcome: AttemptOutcome): string {
  switch (outcome.kind) {
    case "connection":
      return "the connection failed";
    case "timeout":
      return "the attempt timed out";
    case "response":
      return `status ${outcome.status}`;
  }
}
