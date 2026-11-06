/**
 * The boundary between "parsed JSON" and "a typed model".
 *
 * The parser (`src/json.ts`) hands back every number as a {@link Decimal},
 * uniformly, because deciding *per field* at parse time would mean a table of
 * JSON paths inside the parser, which would drift the moment the API grew a
 * field. The decision about which fields are genuinely integral belongs here
 * instead, next to the types.
 *
 * So this module does exactly one job: it converts the handful of **counter**
 * fields back to `number`. Everything else — every nutrient value, every
 * serving quantity, every reconciliation figure — stays a `Decimal` and is
 * handed to the caller untouched.
 *
 * There is deliberately **no validation** beyond that, and no defensive
 * re-shaping. DM-F6 says every key is present on every food and the server
 * proves it; a client re-checking would be the defensive parsing SDK-C2 bans,
 * and a client *coercing* would be the thing that hides a real API change until
 * it surfaces as a wrong number. If the body is not the documented shape, the
 * right outcome is a loud `TypeError` from the `Decimal` conversion below, not
 * a quiet `?? 0`.
 *
 * **T-107 replaces this file along with `models.ts`.** The integer list is the
 * one piece of knowledge the generator needs to carry over.
 */

import type { Decimal } from "./decimal.js";
import type { JsonValue } from "./json.js";
import type {
  BarcodeLookup,
  BatchReadResult,
  CapabilityCatalogue,
  CardList,
  CopyResult,
  DailyNutrition,
  DeletionReceipt,
  DiaryMeal,
  DiaryMeals,
  DiaryRange,
  Food,
  LoggedFood,
  ProbeOk,
  ReorderResult,
  SearchResults,
  SessionToken,
  ErasureReceipt,
} from "./models.js";

/**
 * The only fields in the whole API that become `number` rather than `Decimal`.
 *
 * Each is a count or an index: a value for which binary64 is exact by
 * construction and for which a `Decimal` would be ceremony. **Nothing
 * nutritional is on this list, and nothing nutritional may ever be added to
 * it** — that is what `test/decimal-roundtrip.test.ts` guards.
 */
const INTEGER_FIELDS: ReadonlySet<string> = new Set([
  "page",
  "page_size",
  "total_results",
  "serving_id_version",
  "retry_after_seconds",
  "limit",
  "limit_bytes",
  "measured_bytes",
  // Diary counters (T-096 … T-105). Each is a count or an index.
  //
  // `entries` is a count on a day and a *array* on a meal; the walker checks
  // arrays before it checks for a Decimal, so the array form is untouched and
  // only the scalar one is converted.
  "entries",
  "entries_removed",
  "position",
  "use_count",
  // Session TTL (T-126): whole seconds.
  "ttl_seconds",
]);

/**
 * Objects whose **values** are all counters, keyed by something that is not a
 * fixed field name. `ErasureReceipt.deleted` is table name to rows removed, and
 * the key set is the server's registry, so no per-field list can name them.
 * (`deleted` is also a boolean on `DeletionReceipt`; only the object form is
 * walked here.)
 */
const INTEGER_MAPS: ReadonlySet<string> = new Set(["deleted"]);

function isDecimalLike(value: unknown): value is Decimal {
  return typeof value === "object" && value !== null && "source" in value && "toInt" in value;
}

/**
 * Walks the tree and converts counters to `number` in place of `Decimal`.
 *
 * Returns a structurally identical plain object — the parser builds objects
 * with a null prototype, and this rebuild also gives them `Object.prototype`
 * back, so `food.hasOwnProperty`, spreads and `util.inspect` behave the way a
 * customer expects of an object that came out of an SDK.
 */
function shape(value: JsonValue, key: string | null): unknown {
  if (Array.isArray(value)) return value.map((item) => shape(item, key));
  if (isDecimalLike(value)) {
    return key !== null && INTEGER_FIELDS.has(key) ? value.toInt() : value;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const counters = key !== null && INTEGER_MAPS.has(key);
    for (const [name, child] of Object.entries(value)) {
      out[name] = counters && isDecimalLike(child) ? child.toInt() : shape(child, name);
    }
    return out;
  }
  return value;
}

/**
 * The one cast in the SDK.
 *
 * It is a cast and not a validation on purpose: the server guarantees the shape
 * (DM-F6, PF-X1) and the OpenAPI spec will make that machine-checkable in CI
 * (SDK-C8), which is a far stronger guarantee than a runtime check the SDK
 * could write — and one that does not cost every caller a tree walk.
 */
function decode<T>(body: JsonValue): T {
  return shape(body, null) as T;
}

export const decodeFood = (body: JsonValue): Food => decode<Food>(body);
export const decodeBarcodeLookup = (body: JsonValue): BarcodeLookup => decode<BarcodeLookup>(body);
export const decodeSearchResults = (body: JsonValue): SearchResults => decode<SearchResults>(body);
export const decodeBatchReadResult = (body: JsonValue): BatchReadResult => decode<BatchReadResult>(body);
export const decodeCapabilityCatalogue = (body: JsonValue): CapabilityCatalogue =>
  decode<CapabilityCatalogue>(body);
export const decodeProbeOk = (body: JsonValue): ProbeOk => decode<ProbeOk>(body);

export const decodeDailyNutrition = (body: JsonValue): DailyNutrition => decode<DailyNutrition>(body);
export const decodeDiaryMeals = (body: JsonValue): DiaryMeals => decode<DiaryMeals>(body);
export const decodeDiaryRange = (body: JsonValue): DiaryRange => decode<DiaryRange>(body);
export const decodeDiaryMeal = (body: JsonValue): DiaryMeal => decode<DiaryMeal>(body);
export const decodeLoggedFood = (body: JsonValue): LoggedFood => decode<LoggedFood>(body);
export const decodeCardList = (body: JsonValue): CardList => decode<CardList>(body);
export const decodeDeletionReceipt = (body: JsonValue): DeletionReceipt => decode<DeletionReceipt>(body);
export const decodeReorderResult = (body: JsonValue): ReorderResult => decode<ReorderResult>(body);
export const decodeCopyResult = (body: JsonValue): CopyResult => decode<CopyResult>(body);
export const decodeSessionToken = (body: JsonValue): SessionToken => decode<SessionToken>(body);
export const decodeErasureReceipt = (body: JsonValue): ErasureReceipt => decode<ErasureReceipt>(body);
