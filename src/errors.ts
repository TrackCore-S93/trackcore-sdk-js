/**
 * The typed error surface (SDK-C3, PF-X1).
 *
 * Two families, and the split matters:
 *
 *   `TrackCoreAPIError`    the server answered, in the contract envelope. It
 *                          carries a `code` from the closed enumeration, a
 *                          `request_id` you can quote in a support ticket, and
 *                          a `docs_url`.
 *   `TrackCoreClientError` nothing came back, or what came back was not a
 *                          TrackCore envelope: a DNS failure, a timeout, a
 *                          corporate proxy's HTML, a secret key in a browser.
 *
 * A customer branching on `err.code` wants the first family. A customer
 * deciding whether to retry wants to know it is the second.
 *
 * # The rule that governs every message in this file
 *
 * **No byte of an unrecognised response body ever reaches an error message.**
 *
 * The backend works hard at this: `libs/contract` has no exported way to put
 * free text into an envelope's `message`, so no provider body, SQL fragment,
 * stack frame or internal URL can leak through it (PF-X1, PF-X3, PF-B7). It
 * would be absurd for the SDK to undo that by helpfully splicing a failed
 * response body into `new Error(...)` — where it lands in the customer's log
 * aggregator, their error tracker, and quite possibly their own API's error
 * response. So when the body is not a valid envelope, the SDK says so in fixed
 * words and keeps the body out of the message entirely.
 *
 * The raw text is not silently dropped, because a developer debugging a
 * middlebox genuinely needs it. It is parked on `ProtocolError.bodySample`,
 * which is a non-enumerable property: it is there when you look for it, and it
 * does not travel through `JSON.stringify`, structured logging or an
 * `{ ...err }` spread.
 */

import {
  ERROR_CODES,
  isErrorCode,
  type TrackCoreErrorCategory,
  type TrackCoreErrorCode,
  type TrackCoreErrorField,
} from "./codes.js";
import { Decimal } from "./decimal.js";
import type { JsonObject, JsonValue } from "./json.js";

/** The documented extra fields an envelope may carry, already unwrapped. */
export type ErrorFields = Partial<Record<TrackCoreErrorField, string | number>>;

/** Everything the SDK throws descends from this. */
export abstract class TrackCoreError extends Error {
  /** `true` for every error this SDK raises. Survives a bundler renaming classes. */
  readonly isTrackCoreError = true as const;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    // Class extends Error needs this for `instanceof` to survive the ES5
    // downlevel some bundlers still emit.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// The server answered in the envelope
// ---------------------------------------------------------------------------

export interface APIErrorInit {
  code: TrackCoreErrorCode;
  status: number;
  message: string;
  requestId: string | null;
  docsUrl: string;
  retryAfterSeconds: number | null;
  fields: ErrorFields;
}

/**
 * A non-2xx response that arrived as the PF-X1 envelope.
 *
 * `message` is the server's own rendered prose. That is safe to surface
 * verbatim precisely because of how `libs/contract` builds it: from a catalogue
 * template plus validated field values, with no path for free text.
 */
export class TrackCoreAPIError extends TrackCoreError {
  /** A member of the closed enumeration. `switch` on it exhaustively. */
  readonly code: TrackCoreErrorCode;
  readonly status: number;
  /** What kind of failure this is, independent of the status. */
  readonly category: TrackCoreErrorCategory;
  /** `X-Request-Id`. Quote this in a support ticket. */
  readonly requestId: string | null;
  readonly docsUrl: string;
  /** Present on `rate_limited` and `capability_maintenance`; sometimes elsewhere. */
  readonly retryAfterSeconds: number | null;
  /** The documented extra fields: `capability`, `upstream`, `limit`, … */
  readonly fields: Readonly<ErrorFields>;

  constructor(init: APIErrorInit) {
    super(init.message);
    this.code = init.code;
    this.status = init.status;
    this.category = ERROR_CODES[init.code].category;
    this.requestId = init.requestId;
    this.docsUrl = init.docsUrl;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.fields = Object.freeze({ ...init.fields });
  }

  /** `true` when a later identical request could plausibly succeed. */
  get isTransient(): boolean {
    return this.category === "rate" || this.category === "dependency" || this.category === "maintenance";
  }

  override toString(): string {
    const id = this.requestId ? ` (request ${this.requestId})` : "";
    return `${this.name} [${this.code}]: ${this.message}${id}`;
  }
}

/** 400 and the other request-shape rejections. Retrying unchanged will not help. */
export class RequestError extends TrackCoreAPIError {}

/** 401. The credential was missing, malformed, revoked, unknown or expired. */
export class AuthenticationError extends TrackCoreAPIError {}

/** 402 / 403. The credential was good; it may not do this. */
export class AuthorizationError extends TrackCoreAPIError {}

/** 404 / 410 / 422. The thing addressed is absent, gone or unusable. */
export class ResourceError extends TrackCoreAPIError {}

/** 429, and 402 `quota_exceeded`. Honour {@link TrackCoreAPIError.retryAfterSeconds}. */
export class RateLimitError extends TrackCoreAPIError {}

/** 500. TrackCore's own defect, never the caller's. */
export class ServerError extends TrackCoreAPIError {}

/**
 * 502 `upstream_unavailable`. Something TrackCore depends on broke — unplanned,
 * by definition (P-020). `fields.upstream` names it, and names *only* a service
 * or provider: never a status, a URL or a provider's own message.
 */
export class DependencyError extends TrackCoreAPIError {}

/**
 * 503 `capability_maintenance` — **the only 503 in the API** (P-020).
 *
 * The split from 502 is load-bearing and is why this is its own class:
 * 503 means TrackCore turned a capability off on purpose, 502 means it broke.
 * SDK-O5 asks for this to be catchable on its own so a customer can show a
 * maintenance banner instead of an error toast.
 */
export class MaintenanceError extends TrackCoreAPIError {}

const BY_CATEGORY: Record<TrackCoreErrorCategory, new (init: APIErrorInit) => TrackCoreAPIError> = {
  request: RequestError,
  authentication: AuthenticationError,
  authorization: AuthorizationError,
  resource: ResourceError,
  rate: RateLimitError,
  server: ServerError,
  dependency: DependencyError,
  maintenance: MaintenanceError,
};

// ---------------------------------------------------------------------------
// The request never produced an envelope
// ---------------------------------------------------------------------------

/** A failure the SDK detected itself. There is no `code` and no `request_id`. */
export abstract class TrackCoreClientError extends TrackCoreError {}

/**
 * The SDK was configured in a way that cannot work. Thrown before anything is
 * sent — most importantly for a secret key in a browser (SDK-W3).
 */
export class ConfigurationError extends TrackCoreClientError {
  /** A stable identifier for the specific misconfiguration, for branching on. */
  readonly reason: ConfigurationErrorReason;

  constructor(reason: ConfigurationErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type ConfigurationErrorReason =
  | "secret_key_in_browser"
  | "api_key_missing"
  | "api_key_malformed"
  | "base_url_invalid"
  | "fetch_unavailable"
  // `setUser` (`src/identity.ts`). Each names one broken rule, so a caller can
  // branch — a too-long id is a bug in their code, a non-ASCII one is a
  // decision about how they key their users.
  // `setSessionToken`: a token that is not one. Distinct from the API-key
  // reasons because the fix is different — the caller has put a key where a
  // session token goes, or the reverse.
  | "session_token_malformed"
  // `TrackCore.instance`: a namespace was used before `configure`, or a
  // user-scoped call before `initialize`.
  | "not_configured"
  | "not_initialized"
  | "external_id_not_a_string"
  | "external_id_untrimmed"
  | "external_id_empty"
  | "external_id_too_long"
  | "external_id_not_ascii";

/**
 * An argument the SDK refused before sending it.
 *
 * Only for limits the server publishes and that a caller can trip in a loop —
 * the batch ceiling of 100, chiefly — so that the failure lands at the call
 * site instead of after a round trip. The server's own `400` remains the
 * authority; this never *replaces* a server check, it only arrives sooner.
 */
export class ValidationError extends TrackCoreClientError {
  /** The parameter at fault. */
  readonly parameter: string;

  constructor(parameter: string, message: string) {
    super(message);
    this.parameter = parameter;
  }
}

/** The request could not be delivered: DNS, TLS, connection refused, offline. */
export class ConnectionError extends TrackCoreClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** A per-attempt timeout or the overall deadline elapsed. */
export class TimeoutError extends TrackCoreClientError {
  /** Which clock ran out: one attempt's, or the whole call's. */
  readonly scope: "attempt" | "deadline";
  readonly timeoutMs: number;

  constructor(scope: "attempt" | "deadline", timeoutMs: number) {
    super(
      scope === "attempt"
        ? `the request timed out after ${timeoutMs} ms`
        : `the overall deadline of ${timeoutMs} ms elapsed before the request completed`,
    );
    this.scope = scope;
    this.timeoutMs = timeoutMs;
  }
}

/** The caller's own `AbortSignal` fired. Never retried. */
export class AbortError extends TrackCoreClientError {
  constructor() {
    super("the request was aborted by the caller");
  }
}

/**
 * The server answered, but not in a shape the contract allows: a body that is
 * not JSON, a non-2xx without an envelope, an unknown `code`, or a 2xx whose
 * body is not the documented object.
 *
 * In practice this nearly always means something between the SDK and TrackCore
 * answered instead of TrackCore — a proxy, a captive portal, a load balancer
 * with its own error page.
 *
 * `message` is fixed text. The body is on {@link bodySample}, non-enumerable.
 */
export class ProtocolError extends TrackCoreClientError {
  readonly status: number;
  readonly requestId: string | null;
  /**
   * Up to 2 KiB of the response body, for debugging.
   *
   * Non-enumerable **on purpose**: it does not appear in `JSON.stringify(err)`,
   * in an `{ ...err }` spread, or in most structured loggers' default
   * serialisation. You get it by asking for it by name.
   */
  readonly bodySample!: string;

  constructor(message: string, init: { status: number; requestId: string | null; body?: string }) {
    super(message);
    this.status = init.status;
    this.requestId = init.requestId;
    Object.defineProperty(this, "bodySample", {
      value: (init.body ?? "").slice(0, 2048),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Envelope -> typed error
// ---------------------------------------------------------------------------

/**
 * Turns a decoded non-2xx body into the right error class.
 *
 * Returns `null` when the body is not a conforming envelope, so the caller can
 * raise a {@link ProtocolError} that carries the body sample rather than this
 * function having to decide what to do with it.
 */
export function errorFromEnvelope(
  body: JsonValue | undefined,
  status: number,
  requestIdHeader: string | null,
): TrackCoreAPIError | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const inner = (body as JsonObject)["error"];
  if (inner === null || inner === undefined || typeof inner !== "object" || Array.isArray(inner)) {
    return null;
  }
  const envelope = inner as JsonObject;

  const code = envelope["code"];
  // The enumeration is closed, so a code we do not recognise is not a new error
  // to pass through — it is evidence this response did not come from TrackCore.
  if (!isErrorCode(code)) return null;

  const message = envelope["message"];
  if (typeof message !== "string") return null;

  const spec = ERROR_CODES[code];
  const Constructor = BY_CATEGORY[spec.category];

  const requestId = typeof envelope["request_id"] === "string" ? envelope["request_id"] : requestIdHeader;
  const docsUrl = typeof envelope["docs_url"] === "string" ? envelope["docs_url"] : spec.docsUrl;

  const retry = envelope["retry_after_seconds"];
  const retryAfterSeconds = retry instanceof Decimal ? retry.toInt() : null;

  const fields: ErrorFields = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (BASE_FIELDS.has(key)) continue;
    if (typeof value === "string") {
      fields[key as TrackCoreErrorField] = value;
    } else if (value instanceof Decimal) {
      fields[key as TrackCoreErrorField] = value.toInt();
    }
  }

  return new Constructor({
    code,
    // The catalogue's status, not the response's. They agree in every
    // conforming response; where they do not, the code is the authority,
    // because a proxy can rewrite a status and cannot invent a valid code.
    status: status || spec.status,
    message,
    requestId,
    docsUrl,
    retryAfterSeconds,
    fields,
  });
}

const BASE_FIELDS = new Set(["code", "message", "request_id", "docs_url", "retry_after_seconds"]);

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

/** Did this come from the TrackCore SDK at all? */
export function isTrackCoreError(value: unknown): value is TrackCoreError {
  return value instanceof TrackCoreError;
}

/** Did the server answer in the contract envelope? Narrows `err.code`. */
export function isAPIError(value: unknown): value is TrackCoreAPIError {
  return value instanceof TrackCoreAPIError;
}

/** Is this a specific code? `if (isErrorOfCode(err, "food_gone")) { … }` */
export function isErrorOfCode<C extends TrackCoreErrorCode>(
  value: unknown,
  code: C,
): value is TrackCoreAPIError & { code: C } {
  return isAPIError(value) && value.code === code;
}
