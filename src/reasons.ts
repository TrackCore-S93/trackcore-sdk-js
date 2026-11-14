/**
 * The per-feature detail inside the error envelope: domains and reasons,
 * mirrored from `libs/contract/reasons.go`.
 *
 * **This file is generated** from `test/fixtures/contract_reasons.json`, a
 * dump of `contract.AllDomains()` and `contract.AllReasons()` from the Go
 * package; `test/reasons.test.ts` re-derives it, so a reason added on the
 * server fails a test here with its name.
 *
 * `code` says what kind of failure it is and what to do; `domain` says which
 * feature it came from (set by the gateway from the route, so every error
 * carries one); `reason` says the exact rule, with its own sentence in
 * `message`. Branch on `code` for what to do and on `reason` for what to
 * tell the user. A reason belongs to exactly one code.
 */

import type { TrackCoreErrorCode } from "./codes.js";

/** The feature an error belongs to. */
export type TrackCoreErrorDomain =
  | "auth"
  | "console"
  | "diary"
  | "foods"
  | "health"
  | "image"
  | "label"
  | "nlp"
  | "platform"
  | "profile";

/** The exact rule an error broke, one level below the code. */
export type TrackCoreErrorReason =
  | "image_fetch_failed"
  | "image_fetch_status"
  | "image_url_not_fetchable"
  | "base_quantity_not_positive"
  | "nutrition_not_representable"
  | "quantity_not_a_number"
  | "quantity_not_positive"
  | "quantity_too_large"
  | "quantity_too_precise"
  | "scale_quantity_invalid"
  | "already_exists"
  | "audio_rejected"
  | "audio_required"
  | "body_not_json"
  | "body_required"
  | "capability_unknown"
  | "date_invalid"
  | "date_required"
  | "edit_empty"
  | "entry_ids_duplicate"
  | "external_id_invalid"
  | "external_id_mismatch"
  | "food_id_required"
  | "goal_calories_invalid"
  | "goal_counter_invalid"
  | "goal_empty"
  | "goal_target_invalid"
  | "goal_targets_unreadable"
  | "health_type_unknown"
  | "idempotency_key_reused"
  | "image_rejected"
  | "image_required"
  | "image_url_invalid"
  | "ingredient_invalid"
  | "ingredient_not_found"
  | "language_invalid"
  | "limit_out_of_range"
  | "meal_edit_empty"
  | "meal_minute_taken"
  | "meal_name_too_long"
  | "meal_retime_incomplete"
  | "modified_serving_conflict"
  | "modified_serving_invalid"
  | "name_required"
  | "nutrient_not_live"
  | "parameter_invalid"
  | "parameter_required"
  | "partial_serving_list_refused"
  | "range_end_before_start"
  | "range_too_long"
  | "records_empty"
  | "region_invalid"
  | "serving_nutrition_invalid"
  | "serving_nutrition_unreadable"
  | "servings_count_out_of_range"
  | "session_ttl_too_long"
  | "text_required"
  | "timestamp_invalid"
  | "timezone_not_iana"
  | "too_many_items"
  | "too_many_records"
  | "too_many_target_dates"
  | "value_not_accepted"
  | "value_out_of_range"
  | "role_not_permitted"
  | "secret_key_required"
  | "session_user_mismatch"
  | "custom_food_not_found"
  | "customer_not_found"
  | "entry_not_found"
  | "favourite_not_found"
  | "food_not_found"
  | "goal_not_found"
  | "key_not_found"
  | "meal_not_found"
  | "reveal_gone"
  | "food_withdrawn"
  | "snapshot_unavailable"
  | "food_has_no_default_serving"
  | "food_has_no_servings"
  | "serving_unusable"
  | "serving_not_on_food"
  | "request_in_flight";

/** One row of the reason catalogue. */
export interface ErrorReasonSpec {
  /** The one code this reason is raised under. */
  readonly code: TrackCoreErrorCode;
  readonly status: number;
  /** The feature it is documented under. It may be raised from any route. */
  readonly domain: TrackCoreErrorDomain;
  /** The sentence `message` carries, placeholders unfilled. */
  readonly messageTemplate: string;
}

export const ERROR_REASONS: Readonly<Record<TrackCoreErrorReason, ErrorReasonSpec>> = Object.freeze({
  image_fetch_failed: Object.freeze({ code: "image_fetch_failed", status: 400, domain: "image", messageTemplate: "The image at image_url could not be downloaded." }),
  image_fetch_status: Object.freeze({ code: "image_fetch_failed", status: 400, domain: "image", messageTemplate: "image_url answered with a status other than 200." }),
  image_url_not_fetchable: Object.freeze({ code: "image_fetch_failed", status: 400, domain: "image", messageTemplate: "image_url must be an http or https URL that carries no credentials." }),
  base_quantity_not_positive: Object.freeze({ code: "invalid_quantity", status: 400, domain: "foods", messageTemplate: "A serving's base_quantity must be a positive number." }),
  nutrition_not_representable: Object.freeze({ code: "invalid_quantity", status: 400, domain: "foods", messageTemplate: "The scaled nutrition is not representable at that quantity." }),
  quantity_not_a_number: Object.freeze({ code: "invalid_quantity", status: 400, domain: "diary", messageTemplate: "consumed_quantity must be a JSON number, not a string." }),
  quantity_not_positive: Object.freeze({ code: "invalid_quantity", status: 400, domain: "diary", messageTemplate: "consumed_quantity must be greater than zero." }),
  quantity_too_large: Object.freeze({ code: "invalid_quantity", status: 400, domain: "diary", messageTemplate: "consumed_quantity is too large to store." }),
  quantity_too_precise: Object.freeze({ code: "invalid_quantity", status: 400, domain: "diary", messageTemplate: "consumed_quantity may have at most four decimal places; it is refused rather than rounded." }),
  scale_quantity_invalid: Object.freeze({ code: "invalid_quantity", status: 400, domain: "foods", messageTemplate: "quantity must be a positive JSON number." }),
  already_exists: Object.freeze({ code: "invalid_request", status: 400, domain: "console", messageTemplate: "{parameter} already exists." }),
  audio_rejected: Object.freeze({ code: "invalid_request", status: 400, domain: "nlp", messageTemplate: "The recording could not be transcribed; send WAV, MP3, M4A, OGG or FLAC." }),
  audio_required: Object.freeze({ code: "invalid_request", status: 400, domain: "nlp", messageTemplate: "A recording is required, in the multipart field `audio`." }),
  body_not_json: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "The body is not readable JSON." }),
  body_required: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "A JSON body is required." }),
  capability_unknown: Object.freeze({ code: "invalid_request", status: 400, domain: "console", messageTemplate: "capabilities names a code that is unknown or not yet available." }),
  date_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} must be a calendar date as YYYY-MM-DD." }),
  date_required: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} is required, as YYYY-MM-DD." }),
  edit_empty: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "The edit changes nothing: send consumed_quantity, selected_serving_id, modified_serving or cooking_method." }),
  entry_ids_duplicate: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "entry_ids names the same entry twice." }),
  external_id_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "external_id must be 1 to 255 printable characters with no surrounding whitespace." }),
  external_id_mismatch: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "The body's external_id does not match the X-External-Id header; the header is authoritative." }),
  food_id_required: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "food_id is required." }),
  goal_calories_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "calories must be a JSON number of kcal, zero or more, or null to clear it." }),
  goal_counter_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "{parameter} must be a whole number between 0 and {limit}, or null to clear it." }),
  goal_empty: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "Send at least one of calories, targets, water_ml or steps." }),
  goal_target_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "{parameter} is not a valid target." }),
  goal_targets_unreadable: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "targets is not a readable nutrition document." }),
  health_type_unknown: Object.freeze({ code: "invalid_request", status: 400, domain: "health", messageTemplate: "types names a type the catalogue does not have; accepted: {accepted}." }),
  idempotency_key_reused: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "This idempotency key was already used with a different request body." }),
  image_rejected: Object.freeze({ code: "invalid_request", status: 400, domain: "image", messageTemplate: "The photo could not be read; send a JPEG or PNG." }),
  image_required: Object.freeze({ code: "invalid_request", status: 400, domain: "image", messageTemplate: "A photo is required: the multipart field `image`, or JSON `image_url`." }),
  image_url_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "image", messageTemplate: "image_url must be an http or https URL." }),
  ingredient_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "An ingredient is not valid." }),
  ingredient_not_found: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "An ingredient names a food or serving that does not exist." }),
  language_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "image", messageTemplate: "language must be two to eight letters." }),
  limit_out_of_range: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "limit must be between 1 and {limit}." }),
  meal_edit_empty: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "The request changes nothing: send a name, a time or flags." }),
  meal_minute_taken: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "Another meal already occupies that minute on that day." }),
  meal_name_too_long: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "meal_name may be at most {limit} characters." }),
  meal_retime_incomplete: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "Re-timing a meal needs eaten_at, local_date and timezone together." }),
  modified_serving_conflict: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "modified_serving and selected_serving_id name different servings." }),
  modified_serving_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "modified_serving must name a serving in the snapshot by serving_id, or be null to clear the edit." }),
  name_required: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "name is required." }),
  nutrient_not_live: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "A serving's nutrition names a nutrient the catalogue does not carry." }),
  parameter_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} is not valid." }),
  parameter_required: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} is required." }),
  partial_serving_list_refused: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "include_servings=false is refused: every food read carries every serving." }),
  range_end_before_start: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "`to` is before `from`." }),
  range_too_long: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "The range may span at most {limit} days." }),
  records_empty: Object.freeze({ code: "invalid_request", status: 400, domain: "health", messageTemplate: "records must hold at least one record." }),
  region_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "image", messageTemplate: "region must be two letters." }),
  serving_nutrition_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "A serving's nutrition carries a value that is not valid." }),
  serving_nutrition_unreadable: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "A serving's nutrition is not a readable nutrition document." }),
  servings_count_out_of_range: Object.freeze({ code: "invalid_request", status: 400, domain: "foods", messageTemplate: "Between 1 and {limit} servings are required." }),
  session_ttl_too_long: Object.freeze({ code: "invalid_request", status: 400, domain: "auth", messageTemplate: "ttl_seconds may be at most {limit}." }),
  text_required: Object.freeze({ code: "invalid_request", status: 400, domain: "nlp", messageTemplate: "text is required, as a JSON string." }),
  timestamp_invalid: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} must be an RFC 3339 timestamp." }),
  timezone_not_iana: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "timezone must be an IANA zone name, such as Europe/London." }),
  too_many_items: Object.freeze({ code: "invalid_request", status: 400, domain: "nlp", messageTemplate: "At most {limit} items may be resolved in one call." }),
  too_many_records: Object.freeze({ code: "invalid_request", status: 400, domain: "health", messageTemplate: "records may hold at most {limit} records in one upload." }),
  too_many_target_dates: Object.freeze({ code: "invalid_request", status: 400, domain: "diary", messageTemplate: "At most {limit} target dates may be copied to in one call." }),
  value_not_accepted: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} must be one of: {accepted}." }),
  value_out_of_range: Object.freeze({ code: "invalid_request", status: 400, domain: "platform", messageTemplate: "{parameter} is outside the accepted range." }),
  role_not_permitted: Object.freeze({ code: "user_scope_violation", status: 403, domain: "console", messageTemplate: "Your role does not allow this." }),
  secret_key_required: Object.freeze({ code: "user_scope_violation", status: 403, domain: "auth", messageTemplate: "This operation needs a secret key; a publishable key cannot perform it." }),
  session_user_mismatch: Object.freeze({ code: "user_scope_violation", status: 403, domain: "auth", messageTemplate: "The session token belongs to a different end user than the one named." }),
  custom_food_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "foods", messageTemplate: "No custom food with that id belongs to this end user." }),
  customer_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "console", messageTemplate: "No customer has that id." }),
  entry_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "diary", messageTemplate: "No diary entry with that id belongs to this end user." }),
  favourite_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "diary", messageTemplate: "That food is not among this end user's favourites." }),
  food_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "foods", messageTemplate: "No food has that id, or it is not available to this end user." }),
  goal_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "diary", messageTemplate: "This end user has no goal in force on that date." }),
  key_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "console", messageTemplate: "No API key has that id." }),
  meal_not_found: Object.freeze({ code: "resource_not_found", status: 404, domain: "diary", messageTemplate: "No meal with that id belongs to this end user." }),
  reveal_gone: Object.freeze({ code: "resource_not_found", status: 404, domain: "console", messageTemplate: "No secret is waiting to be revealed for this key; a secret is shown once." }),
  food_withdrawn: Object.freeze({ code: "food_gone", status: 410, domain: "foods", messageTemplate: "The provider no longer resolves this food id." }),
  snapshot_unavailable: Object.freeze({ code: "food_gone", status: 410, domain: "diary", messageTemplate: "The entry's stored food snapshot has been archived, so the portion cannot be recomputed." }),
  food_has_no_default_serving: Object.freeze({ code: "food_unusable", status: 422, domain: "foods", messageTemplate: "This food names no default serving; send selected_serving_id." }),
  food_has_no_servings: Object.freeze({ code: "food_unusable", status: 422, domain: "foods", messageTemplate: "This food publishes no serving, so it cannot be logged or scaled." }),
  serving_unusable: Object.freeze({ code: "food_unusable", status: 422, domain: "foods", messageTemplate: "The serving's nutrition cannot be scaled." }),
  serving_not_on_food: Object.freeze({ code: "serving_not_found", status: 422, domain: "foods", messageTemplate: "The serving named is not one of this food's servings." }),
  request_in_flight: Object.freeze({ code: "rate_limited", status: 429, domain: "diary", messageTemplate: "An identical request with this idempotency key is still being processed; retry shortly." }),
});

/** Every domain, in name order. */
export const ALL_ERROR_DOMAINS: readonly TrackCoreErrorDomain[] = Object.freeze([
  "auth",
  "console",
  "diary",
  "foods",
  "health",
  "image",
  "label",
  "nlp",
  "platform",
  "profile",
]);

/** Every reason, in the order `contract.AllReasons()` uses: by status, code, then name. */
export const ALL_ERROR_REASONS: readonly TrackCoreErrorReason[] = Object.freeze(
  Object.keys(ERROR_REASONS) as TrackCoreErrorReason[],
);

/** Narrows an arbitrary string to a known domain. */
export function isErrorDomain(value: unknown): value is TrackCoreErrorDomain {
  return typeof value === "string" && (ALL_ERROR_DOMAINS as readonly string[]).includes(value);
}

/** Narrows an arbitrary string to a known reason. A newer gateway may send one this build does not list. */
export function isErrorReason(value: unknown): value is TrackCoreErrorReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_REASONS, value);
}

/** The catalogue row for a reason. */
export function errorReasonSpec(reason: TrackCoreErrorReason): ErrorReasonSpec {
  return ERROR_REASONS[reason];
}
