/**
 * The closed error-code enumeration (PF-X2), mirrored from `libs/contract`.
 *
 * **This file is generated.** It is a transcription of the Go catalogue in
 * `libs/contract/codes.go`, produced by dumping `contract.All()` from the Go
 * package itself rather than by reading the source and typing it out. The dump
 * is checked in at `test/fixtures/contract_codes.json`, and
 * `test/codes.test.ts` re-derives this table from it, so a code added or
 * changed on the server fails a test here with the name of what moved.
 *
 * "Closed" is load-bearing: `libs/contract` makes a code outside the
 * enumeration literally unspellable in Go, and `TrackCoreErrorCode` below is
 * the same promise in TypeScript — a `switch` over it is exhaustive, and the
 * compiler will tell a customer when a new code appears in a later SDK version.
 *
 * Regenerate with `npm run codegen:codes` after re-dumping the Go catalogue.
 * T-107 replaces this file with output generated from the OpenAPI spec.
 */

/** What *kind* of failure a code is, independent of its HTTP status. */
export type TrackCoreErrorCategory =
  | "authentication"
  | "authorization"
  | "dependency"
  | "maintenance"
  | "rate"
  | "request"
  | "resource"
  | "server";

/** Whether `retry_after_seconds` may, must or must not appear on a code. */
export type RetryAfterPolicy = "forbidden" | "optional" | "required";

/** Every error code the API can return. Thirty-seven, and no others. */
export type TrackCoreErrorCode =
  | "ambiguous_credentials"
  | "image_fetch_failed"
  | "invalid_barcode"
  | "invalid_quantity"
  | "invalid_request"
  | "invalid_servings"
  | "query_too_long"
  | "query_too_short"
  | "text_required"
  | "text_too_long"
  | "timezone_required"
  | "too_many_ids"
  | "clock_skew"
  | "credential_malformed"
  | "credential_missing"
  | "credential_revoked"
  | "credential_unknown"
  | "key_revoked"
  | "session_expired"
  | "quota_exceeded"
  | "dpa_required"
  | "entitlement_required"
  | "user_scope_violation"
  | "resource_not_found"
  | "user_not_found"
  | "food_gone"
  | "image_too_large"
  | "unsupported_image_format"
  | "unsupported_media_type"
  | "food_unusable"
  | "recipe_cycle_detected"
  | "recipe_depth_exceeded"
  | "serving_not_found"
  | "rate_limited"
  | "internal_error"
  | "upstream_unavailable"
  | "capability_maintenance";

/** One row of the catalogue. */
export interface ErrorCodeSpec {
  readonly code: TrackCoreErrorCode;
  readonly status: number;
  readonly category: TrackCoreErrorCategory;
  readonly retryAfter: RetryAfterPolicy;
  readonly docsUrl: string;
}

/**
 * The catalogue, keyed by wire string.
 *
 * Used to classify a response into the right error subclass and to prove that a
 * `code` on the wire is one the SDK knows. A code that is *not* in here is a
 * protocol violation — the server promised a closed enumeration — and is
 * surfaced as a `ProtocolError` rather than guessed at.
 */
export const ERROR_CODES: Readonly<Record<TrackCoreErrorCode, ErrorCodeSpec>> = Object.freeze({
  ambiguous_credentials: Object.freeze({
    code: "ambiguous_credentials",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/ambiguous_credentials",
  }),
  image_fetch_failed: Object.freeze({
    code: "image_fetch_failed",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/image_fetch_failed",
  }),
  invalid_barcode: Object.freeze({
    code: "invalid_barcode",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/invalid_barcode",
  }),
  invalid_quantity: Object.freeze({
    code: "invalid_quantity",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/invalid_quantity",
  }),
  invalid_request: Object.freeze({
    code: "invalid_request",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/invalid_request",
  }),
  invalid_servings: Object.freeze({
    code: "invalid_servings",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/invalid_servings",
  }),
  query_too_long: Object.freeze({
    code: "query_too_long",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/query_too_long",
  }),
  query_too_short: Object.freeze({
    code: "query_too_short",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/query_too_short",
  }),
  text_required: Object.freeze({
    code: "text_required",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/text_required",
  }),
  text_too_long: Object.freeze({
    code: "text_too_long",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/text_too_long",
  }),
  timezone_required: Object.freeze({
    code: "timezone_required",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/timezone_required",
  }),
  too_many_ids: Object.freeze({
    code: "too_many_ids",
    status: 400,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/too_many_ids",
  }),
  clock_skew: Object.freeze({
    code: "clock_skew",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/clock_skew",
  }),
  credential_malformed: Object.freeze({
    code: "credential_malformed",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/credential_malformed",
  }),
  credential_missing: Object.freeze({
    code: "credential_missing",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/credential_missing",
  }),
  credential_revoked: Object.freeze({
    code: "credential_revoked",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/credential_revoked",
  }),
  credential_unknown: Object.freeze({
    code: "credential_unknown",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/credential_unknown",
  }),
  key_revoked: Object.freeze({
    code: "key_revoked",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/key_revoked",
  }),
  session_expired: Object.freeze({
    code: "session_expired",
    status: 401,
    category: "authentication",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/session_expired",
  }),
  quota_exceeded: Object.freeze({
    code: "quota_exceeded",
    status: 402,
    category: "rate",
    retryAfter: "optional",
    docsUrl: "https://docs.trackcore.dev/errors/quota_exceeded",
  }),
  dpa_required: Object.freeze({
    code: "dpa_required",
    status: 403,
    category: "authorization",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/dpa_required",
  }),
  entitlement_required: Object.freeze({
    code: "entitlement_required",
    status: 403,
    category: "authorization",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/entitlement_required",
  }),
  user_scope_violation: Object.freeze({
    code: "user_scope_violation",
    status: 403,
    category: "authorization",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/user_scope_violation",
  }),
  resource_not_found: Object.freeze({
    code: "resource_not_found",
    status: 404,
    category: "resource",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/resource_not_found",
  }),
  user_not_found: Object.freeze({
    code: "user_not_found",
    status: 404,
    category: "resource",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/user_not_found",
  }),
  food_gone: Object.freeze({
    code: "food_gone",
    status: 410,
    category: "resource",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/food_gone",
  }),
  image_too_large: Object.freeze({
    code: "image_too_large",
    status: 413,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/image_too_large",
  }),
  unsupported_image_format: Object.freeze({
    code: "unsupported_image_format",
    status: 415,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/unsupported_image_format",
  }),
  unsupported_media_type: Object.freeze({
    code: "unsupported_media_type",
    status: 415,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/unsupported_media_type",
  }),
  food_unusable: Object.freeze({
    code: "food_unusable",
    status: 422,
    category: "resource",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/food_unusable",
  }),
  recipe_cycle_detected: Object.freeze({
    code: "recipe_cycle_detected",
    status: 422,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/recipe_cycle_detected",
  }),
  recipe_depth_exceeded: Object.freeze({
    code: "recipe_depth_exceeded",
    status: 422,
    category: "request",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/recipe_depth_exceeded",
  }),
  serving_not_found: Object.freeze({
    code: "serving_not_found",
    status: 422,
    category: "resource",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/serving_not_found",
  }),
  rate_limited: Object.freeze({
    code: "rate_limited",
    status: 429,
    category: "rate",
    retryAfter: "required",
    docsUrl: "https://docs.trackcore.dev/errors/rate_limited",
  }),
  internal_error: Object.freeze({
    code: "internal_error",
    status: 500,
    category: "server",
    retryAfter: "forbidden",
    docsUrl: "https://docs.trackcore.dev/errors/internal_error",
  }),
  upstream_unavailable: Object.freeze({
    code: "upstream_unavailable",
    status: 502,
    category: "dependency",
    retryAfter: "optional",
    docsUrl: "https://docs.trackcore.dev/errors/upstream_unavailable",
  }),
  capability_maintenance: Object.freeze({
    code: "capability_maintenance",
    status: 503,
    category: "maintenance",
    retryAfter: "required",
    docsUrl: "https://docs.trackcore.dev/errors/capability_maintenance",
  }),
});

/** The documented extra fields an envelope may carry beside the base five. */
export type TrackCoreErrorField =
  | "accepted"
  | "capability"
  | "limit"
  | "limit_bytes"
  | "measured_bytes"
  | "parameter"
  | "upstream";

/** Narrows an arbitrary string to a member of the enumeration. */
export function isErrorCode(value: unknown): value is TrackCoreErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** The catalogue row for a code. */
export function errorCodeSpec(code: TrackCoreErrorCode): ErrorCodeSpec {
  return ERROR_CODES[code];
}

/** Every code, in status then alphabetical order — the order `contract.All()` uses. */
export const ALL_ERROR_CODES: readonly TrackCoreErrorCode[] = Object.freeze(
  Object.keys(ERROR_CODES) as TrackCoreErrorCode[],
);
